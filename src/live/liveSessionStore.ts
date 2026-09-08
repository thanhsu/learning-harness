import fs from 'node:fs';
import path from 'node:path';
import { splitSpeaker } from '../parsers/common.js';
import type { TranscriptSegment } from '../parsers/types.js';

export class InvalidChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidChunkError';
  }
}

export interface LiveChunk {
  sessionId: string;
  timestamp?: string;
  speaker?: string;
  text: string;
}

export interface LiveSessionInfo {
  id: string;
  startedAt: string;
  endedAt?: string;
  chunkCount: number;
  transcriptPath: string;
  rollingSummary: string;
  lastSummaryAt?: string;
  summaryError?: string;
}

export type Summarizer = (
  newText: string,
  previousSummary: string
) => Promise<string>;

interface SessionState extends LiveSessionInfo {
  pendingText: string[];
  chunksSinceSummary: number;
  summarizing: boolean;
  /** ms epoch of the last summary (or the session start). */
  lastSummaryTime: number;
}

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface LiveSessionStoreOptions {
  /** Directory where per-session transcript files are appended. */
  dir: string;
  summaryEveryChunks?: number;
  summaryEveryMinutes?: number;
  /** Rolling summarizer; omit to disable rolling summaries. */
  summarize?: Summarizer;
  now?: () => Date;
}

/**
 * In-memory registry of live sessions. Every chunk is appended to a plain-text
 * transcript file (the durable record); a rolling summary is refreshed every
 * N chunks or N minutes, whichever comes first.
 */
export class LiveSessionStore {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly opts: LiveSessionStoreOptions) {
    fs.mkdirSync(opts.dir, { recursive: true });
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  transcriptPathFor(sessionId: string): string {
    return path.join(this.opts.dir, `${sessionId}.txt`);
  }

  async appendChunk(
    chunk: LiveChunk
  ): Promise<{ session: LiveSessionInfo; summaryUpdated: boolean }> {
    if (
      !chunk ||
      typeof chunk.sessionId !== 'string' ||
      !SESSION_ID_RE.test(chunk.sessionId)
    ) {
      throw new InvalidChunkError(
        'sessionId is required and may only contain letters, digits, ".", "_" and "-" (max 100 chars).'
      );
    }
    if (typeof chunk.text !== 'string' || chunk.text.trim() === '') {
      throw new InvalidChunkError('text is required and must be a non-empty string.');
    }

    const session = this.getOrCreate(chunk.sessionId);
    if (session.endedAt) {
      throw new InvalidChunkError(`Session "${chunk.sessionId}" has already ended.`);
    }

    const ts =
      typeof chunk.timestamp === 'string' && chunk.timestamp.trim()
        ? chunk.timestamp.trim()
        : localTimestamp(this.now());
    const speaker =
      typeof chunk.speaker === 'string' && chunk.speaker.trim()
        ? chunk.speaker.trim()
        : undefined;
    const text = chunk.text.trim();

    const line = `[${ts}]${speaker ? ` ${speaker}:` : ''} ${text}\n`;
    fs.appendFileSync(session.transcriptPath, line, 'utf8');

    session.chunkCount++;
    session.chunksSinceSummary++;
    session.pendingText.push(speaker ? `${speaker}: ${text}` : text);

    const summaryUpdated = await this.maybeSummarize(session);
    return { session: toInfo(session), summaryUpdated };
  }

  private getOrCreate(id: string): SessionState {
    let session = this.sessions.get(id);
    if (!session) {
      const startedAt = this.now();
      session = {
        id,
        startedAt: startedAt.toISOString(),
        chunkCount: 0,
        transcriptPath: this.transcriptPathFor(id),
        rollingSummary: '',
        pendingText: [],
        chunksSinceSummary: 0,
        summarizing: false,
        lastSummaryTime: startedAt.getTime(),
      };
      this.sessions.set(id, session);
    }
    return session;
  }

  private shouldSummarize(s: SessionState): boolean {
    if (!this.opts.summarize || s.summarizing || s.chunksSinceSummary === 0) {
      return false;
    }
    if (s.chunksSinceSummary >= (this.opts.summaryEveryChunks ?? 10)) return true;
    const elapsedMin = (this.now().getTime() - s.lastSummaryTime) / 60_000;
    return elapsedMin >= (this.opts.summaryEveryMinutes ?? 5);
  }

  private async maybeSummarize(s: SessionState): Promise<boolean> {
    if (!this.shouldSummarize(s)) return false;

    const newText = s.pendingText.join('\n');
    s.pendingText = [];
    s.chunksSinceSummary = 0;
    s.lastSummaryTime = this.now().getTime();
    s.summarizing = true;
    try {
      s.rollingSummary = await this.opts.summarize!(newText, s.rollingSummary);
      s.lastSummaryAt = this.now().toISOString();
      s.summaryError = undefined;
      return true;
    } catch (err) {
      // Keep the session alive; surface the error (e.g. quota reached) in the UI.
      s.summaryError = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      s.summarizing = false;
    }
  }

  get(id: string): LiveSessionInfo | undefined {
    const s = this.sessions.get(id);
    return s ? toInfo(s) : undefined;
  }

  list(): LiveSessionInfo[] {
    return [...this.sessions.values()]
      .map(toInfo)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  readTranscript(id: string): string {
    const s = this.sessions.get(id);
    if (!s) throw new InvalidChunkError(`Unknown session "${id}".`);
    return fs.existsSync(s.transcriptPath)
      ? fs.readFileSync(s.transcriptPath, 'utf8')
      : '';
  }

  end(id: string): LiveSessionInfo {
    const s = this.sessions.get(id);
    if (!s) throw new InvalidChunkError(`Unknown session "${id}".`);
    if (!s.endedAt) s.endedAt = this.now().toISOString();
    return toInfo(s);
  }

  /** Removes a session and its transcript file so the id can be reused. */
  reset(id: string): void {
    const s = this.sessions.get(id);
    if (!s) throw new InvalidChunkError(`Unknown session "${id}".`);
    this.sessions.delete(id);
    if (fs.existsSync(s.transcriptPath)) fs.rmSync(s.transcriptPath);
  }
}

/** "YYYY-MM-DD HH:mm:ss" in the machine's local timezone. */
export function localTimestamp(d: Date): string {
  return d.toLocaleString('sv-SE');
}

// Live transcript lines look like "[<timestamp>] Speaker: text" — the
// timestamp is whatever the client sent (often ISO-8601), so it must be
// stripped structurally rather than parsed as a clock.
const LIVE_LINE_RE = /^\[([^\]]*)\]\s*(.*)$/;

/** Parses a session transcript file written by appendChunk back into segments. */
export function parseLiveTranscript(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(LIVE_LINE_RE);
    const rest = m ? m[2].trim() : line;
    const { speaker, text } = splitSpeaker(rest);
    if (text) segments.push({ speaker, text });
  }
  return segments;
}

function toInfo(s: SessionState): LiveSessionInfo {
  return {
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    chunkCount: s.chunkCount,
    transcriptPath: s.transcriptPath,
    rollingSummary: s.rollingSummary,
    lastSummaryAt: s.lastSummaryAt,
    summaryError: s.summaryError,
  };
}
