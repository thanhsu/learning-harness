import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CaptureManager } from './capture/captureManager.js';
import { createCaptureRouter } from './capture/captureRoutes.js';
import {
  FREE_TIER_MODELS,
  isFreeTierModel,
  loadConfig,
  updateEnvFile,
  type Config,
} from './config.js';
import { openDb, type Db } from './db/sqlite.js';
import { AiUnavailableError, GeminiClient } from './geminiClient.js';
import { createLiveRouter } from './live/liveRoutes.js';
import {
  InvalidChunkError,
  LiveSessionStore,
  parseLiveTranscript,
} from './live/liveSessionStore.js';
import { generateNote } from './notes/generateNote.js';
import { rollingSummaryPrompt } from './notes/prompts.js';
import { translateNote } from './notes/translate.js';
import { parseTranscript } from './parsers/index.js';
import { QuotaExceededError, QuotaGuard } from './quotaGuard.js';
import { startWatcher } from './watcher/watchTranscripts.js';

const NOTE_NAME_RE = /^[\w][\w .()'\-]*\.md$/;

export function createApp(cfg: Config, db: Db) {
  const quota = new QuotaGuard(db, cfg.maxDailyCalls);
  // Always constructed: it reads cfg at call time, so a key added later via
  // the Settings UI takes effect without a restart.
  const gemini = new GeminiClient(cfg, quota);

  const store = new LiveSessionStore({
    dir: path.join(cfg.dataDir, 'sessions'),
    summaryEveryChunks: cfg.summaryEveryChunks,
    summaryEveryMinutes: cfg.summaryEveryMinutes,
    summarize: (newText, prev) =>
      gemini.generate(
        rollingSummaryPrompt(prev, newText, cfg.outputLanguage || undefined),
        { model: cfg.summaryModel || undefined }
      ),
  });

  async function finalizeSession(sessionId: string): Promise<{ notePath: string }> {
    const transcriptPath = store.transcriptPathFor(sessionId);
    const raw = fs.existsSync(transcriptPath)
      ? fs.readFileSync(transcriptPath, 'utf8')
      : '';
    const segments = parseLiveTranscript(raw);
    const result = await generateNote({
      segments,
      source: `live session ${sessionId}`,
      titleHint: sessionId,
      vaultDir: cfg.vaultDir,
      ai: gemini,
      transcriptRef: transcriptPath,
      outputLanguage: cfg.outputLanguage || undefined,
    });

    const info = store.get(sessionId);
    db.prepare(
      `INSERT INTO sessions (id, started_at, ended_at, chunk_count, note_path)
       VALUES (@id, @startedAt, @endedAt, @chunkCount, @notePath)
       ON CONFLICT(id) DO UPDATE SET
         ended_at = @endedAt, chunk_count = @chunkCount, note_path = @notePath`
    ).run({
      id: sessionId,
      startedAt: info?.startedAt ?? new Date().toISOString(),
      endedAt: info?.endedAt ?? new Date().toISOString(),
      chunkCount: info?.chunkCount ?? 0,
      notePath: result.notePath,
    });

    console.log(`[live] session ${sessionId} -> ${result.notePath}`);
    return { notePath: result.notePath };
  }

  async function processTranscriptFile(filePath: string) {
    const stat = fs.statSync(filePath);
    const mtimeMs = Math.floor(stat.mtimeMs);
    const existing = db
      .prepare('SELECT mtime_ms FROM processed_files WHERE path = ?')
      .get(filePath) as { mtime_ms: number } | undefined;
    if (existing && existing.mtime_ms === mtimeMs) return null; // already processed

    const content = fs.readFileSync(filePath, 'utf8');
    const segments = parseTranscript(filePath, content);
    if (segments.length === 0) {
      console.warn(`[watcher] ${filePath}: no transcript segments found, skipping.`);
      return null;
    }

    const titleHint = path.basename(filePath).replace(/\.[^.]+$/, '');
    const result = await generateNote({
      segments,
      source: filePath,
      titleHint,
      vaultDir: cfg.vaultDir,
      ai: gemini,
      outputLanguage: cfg.outputLanguage || undefined,
    });

    db.prepare(
      `INSERT INTO processed_files (path, mtime_ms, note_path, processed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         mtime_ms = excluded.mtime_ms,
         note_path = excluded.note_path,
         processed_at = excluded.processed_at`
    ).run(filePath, mtimeMs, result.notePath, new Date().toISOString());

    console.log(
      `[watcher] ${filePath} -> ${result.notePath}` +
        (result.usedAi ? '' : ' (offline fallback)')
    );
    return result;
  }

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Static dashboard UI.
  const uiDir = fileURLToPath(new URL('./ui/', import.meta.url));
  app.use(express.static(uiDir));

  app.get('/api/status', (_req, res) => {
    res.json({
      aiEnabled: gemini.available,
      model: cfg.geminiModel,
      summaryModel: cfg.summaryModel || cfg.geminiModel,
      paidAiDisabled: cfg.paidAiDisabled,
      aiLastError: gemini.lastError,
      quota: {
        used: quota.callsToday(),
        limit: quota.limit,
        remaining: quota.remaining(),
      },
      watchDir: cfg.watchDir,
      vaultDir: cfg.vaultDir,
    });
  });

  // ── Settings (editable from the dashboard) ─────────────────────────
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));

  app.get('/api/settings', (_req, res) => {
    res.json({
      keySet: Boolean(cfg.geminiApiKey),
      keyHint: cfg.geminiApiKey ? `…${cfg.geminiApiKey.slice(-4)}` : null,
      model: cfg.geminiModel,
      summaryModel: cfg.summaryModel,
      maxDailyCalls: quota.limit,
      outputLanguage: cfg.outputLanguage,
      freeTierModels: FREE_TIER_MODELS,
    });
  });

  app.post('/api/settings', (req, res) => {
    const { apiKey, model, summaryModel, maxDailyCalls, outputLanguage } =
      req.body ?? {};
    const envUpdates: Record<string, string> = {};

    if (typeof apiKey === 'string' && apiKey.trim()) {
      cfg.geminiApiKey = apiKey.trim();
      envUpdates.GEMINI_API_KEY = cfg.geminiApiKey;
    }
    if (typeof model === 'string' && model.trim()) {
      const m = model.trim();
      if (cfg.paidAiDisabled && !isFreeTierModel(m)) {
        res.status(400).json({
          error: `"${m}" is not on the free-tier list (PAID_AI_DISABLED=true).`,
        });
        return;
      }
      cfg.geminiModel = m;
      envUpdates.GEMINI_MODEL = m;
    }
    if (typeof summaryModel === 'string') {
      const m = summaryModel.trim();
      if (m && cfg.paidAiDisabled && !isFreeTierModel(m)) {
        res.status(400).json({
          error: `"${m}" is not on the free-tier list (PAID_AI_DISABLED=true).`,
        });
        return;
      }
      cfg.summaryModel = m;
      envUpdates.GEMINI_SUMMARY_MODEL = m;
    }
    if (maxDailyCalls !== undefined) {
      const n = Number(maxDailyCalls);
      if (!Number.isFinite(n) || n < 0) {
        res.status(400).json({ error: 'maxDailyCalls must be a number >= 0.' });
        return;
      }
      cfg.maxDailyCalls = Math.floor(n);
      quota.setLimit(cfg.maxDailyCalls);
      envUpdates.MAX_DAILY_CALLS = String(cfg.maxDailyCalls);
    }
    if (typeof outputLanguage === 'string') {
      cfg.outputLanguage = outputLanguage.trim();
      envUpdates.OUTPUT_LANGUAGE = cfg.outputLanguage;
    }

    if (Object.keys(envUpdates).length > 0) updateEnvFile(envPath, envUpdates);
    res.json({ ok: true });
  });

  app.get('/api/notes', (_req, res) => {
    fs.mkdirSync(cfg.vaultDir, { recursive: true });
    const notes = fs
      .readdirSync(cfg.vaultDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const st = fs.statSync(path.join(cfg.vaultDir, f));
        return { name: f, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ notes });
  });

  app.get('/api/notes/:name', (req, res) => {
    const name = req.params.name;
    if (!NOTE_NAME_RE.test(name) || name.includes('..')) {
      res.status(400).json({ error: 'Invalid note name.' });
      return;
    }
    const notePath = path.join(cfg.vaultDir, name);
    if (!fs.existsSync(notePath)) {
      res.status(404).json({ error: 'Note not found.' });
      return;
    }
    res.type('text/markdown').send(fs.readFileSync(notePath, 'utf8'));
  });

  // Translates an existing note (default: Vietnamese) into <name>.<lang>.md.
  app.post('/api/notes/:name/translate', async (req, res, next) => {
    try {
      const name = req.params.name;
      if (!NOTE_NAME_RE.test(name) || name.includes('..')) {
        res.status(400).json({ error: 'Invalid note name.' });
        return;
      }
      if (!fs.existsSync(path.join(cfg.vaultDir, name))) {
        res.status(404).json({ error: 'Note not found.' });
        return;
      }
      if (!gemini.available) {
        res.status(503).json({
          error:
            'Translation needs AI. Set GEMINI_API_KEY in Settings to enable it.',
          code: 'AI_UNAVAILABLE',
        });
        return;
      }
      const language =
        typeof req.body?.language === 'string' && req.body.language.trim()
          ? req.body.language.trim()
          : 'vi';
      const result = await translateNote({
        vaultDir: cfg.vaultDir,
        name,
        language,
        ai: gemini,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  // Manual paste/upload from the dashboard.
  app.post('/api/ingest', async (req, res, next) => {
    try {
      const { filename, text } = req.body ?? {};
      if (typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'text is required.' });
        return;
      }
      const name =
        typeof filename === 'string' && filename.trim()
          ? path.basename(filename.trim())
          : 'pasted-transcript.txt';
      const segments = parseTranscript(name, text);
      if (segments.length === 0) {
        res.status(400).json({ error: 'Could not extract any transcript segments.' });
        return;
      }
      const result = await generateNote({
        segments,
        source: `manual upload (${name})`,
        titleHint: name.replace(/\.[^.]+$/, ''),
        vaultDir: cfg.vaultDir,
        ai: gemini,
        outputLanguage: cfg.outputLanguage || undefined,
      });
      res.json({
        ok: true,
        notePath: result.notePath,
        usedAi: result.usedAi,
        aiError: result.aiError,
      });
    } catch (err) {
      next(err);
    }
  });

  app.use(createLiveRouter({ store, finalize: finalizeSession }));

  // Optional local audio-capture bridge (Zoom system audio -> Whisper -> chunks).
  const capture = new CaptureManager(`http://localhost:${cfg.port}`);
  app.use(createCaptureRouter(capture));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof QuotaExceededError) {
      res.status(429).json({ error: err.message, code: 'QUOTA_EXCEEDED' });
      return;
    }
    if (err instanceof AiUnavailableError) {
      res.status(503).json({ error: err.message, code: 'AI_UNAVAILABLE' });
      return;
    }
    if (err instanceof InvalidChunkError) {
      res.status(400).json({ error: err.message, code: 'INVALID_REQUEST' });
      return;
    }
    console.error('[server]', err);
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Internal error' });
  });

  return { app, store, quota, gemini, processTranscriptFile };
}

function main(): void {
  const cfg = loadConfig();
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.mkdirSync(cfg.vaultDir, { recursive: true });

  const db = openDb(cfg.dataDir);
  const { app, processTranscriptFile } = createApp(cfg, db);

  if (!cfg.watchDisabled) {
    startWatcher({ watchDir: cfg.watchDir, onFile: processTranscriptFile });
    console.log(`Watching for transcripts in ${cfg.watchDir}`);
  }

  app.listen(cfg.port, () => {
    console.log('');
    console.log('  learning-harness is running');
    console.log(`  Dashboard:   http://localhost:${cfg.port}`);
    console.log(`  Vault:       ${cfg.vaultDir}`);
    console.log(
      `  AI:          ${
        cfg.geminiApiKey
          ? `${cfg.geminiModel} (max ${cfg.maxDailyCalls} calls/day)`
          : 'disabled — set GEMINI_API_KEY in .env to enable'
      }`
    );
    console.log('');
  });
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) main();
