import fs from 'node:fs';
import path from 'node:path';
import type { AiClient } from '../geminiClient.js';
import { segmentsToText, type TranscriptSegment } from '../parsers/index.js';
import {
  fallbackNoteData,
  normalizeNoteData,
  renderNote,
  slugify,
  type NoteData,
} from './markdownNote.js';
import { notePrompt } from './prompts.js';

export interface GenerateNoteOptions {
  segments: TranscriptSegment[];
  /** Human-readable source label (file path or "live session <id>"). */
  source: string;
  titleHint: string;
  vaultDir: string;
  ai?: AiClient | null;
  date?: Date;
  /** When set, the note links to this transcript file instead of inlining it. */
  transcriptRef?: string;
  /** Language for the generated note (e.g. "vi"); default: transcript's own. */
  outputLanguage?: string;
}

export interface GenerateNoteResult {
  notePath: string;
  data: NoteData;
  usedAi: boolean;
  aiError?: string;
}

/**
 * Turns parsed transcript segments into a Markdown note in the vault.
 * Uses Gemini when available; degrades gracefully to an offline extractive
 * note when the key is missing, the quota is exhausted, or the API fails.
 */
export async function generateNote(
  opts: GenerateNoteOptions
): Promise<GenerateNoteResult> {
  const date = opts.date ?? new Date();
  const transcript = segmentsToText(opts.segments);

  let data: NoteData;
  let usedAi = false;
  let aiError: string | undefined;
  let generatedBy = 'offline fallback (no AI configured)';

  if (opts.ai?.available) {
    try {
      const raw = await opts.ai.generateJson<unknown>(
        notePrompt(
          transcript,
          { source: opts.source, date: date.toISOString() },
          opts.outputLanguage
        )
      );
      data = normalizeNoteData(raw, opts.titleHint);
      usedAi = true;
      generatedBy = `gemini (${opts.ai.model})`;
    } catch (err) {
      aiError = err instanceof Error ? err.message : String(err);
      console.warn(`[notes] AI generation failed, using offline fallback: ${aiError}`);
      data = fallbackNoteData(opts.segments, opts.titleHint);
      generatedBy = `offline fallback — ${aiError}`;
    }
  } else {
    data = fallbackNoteData(opts.segments, opts.titleHint);
  }

  const md = renderNote(data, {
    date: date.toLocaleString(),
    source: opts.source,
    generatedBy,
    transcript: opts.transcriptRef ? undefined : transcript,
    transcriptRef: opts.transcriptRef,
  });

  fs.mkdirSync(opts.vaultDir, { recursive: true });
  const base = `${date.toISOString().slice(0, 10)}-${slugify(data.title || opts.titleHint)}`;
  let notePath = path.join(opts.vaultDir, `${base}.md`);
  let n = 2;
  while (fs.existsSync(notePath)) {
    notePath = path.join(opts.vaultDir, `${base}-${n++}.md`);
  }
  fs.writeFileSync(notePath, md, 'utf8');

  return { notePath, data, usedAi, aiError };
}
