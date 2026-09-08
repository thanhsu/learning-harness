import path from 'node:path';
import { parseSrt } from './parseSrt.js';
import { parseTxt } from './parseTxt.js';
import { parseVtt } from './parseVtt.js';
import type { TranscriptSegment } from './types.js';

export const SUPPORTED_EXTENSIONS = ['.txt', '.vtt', '.srt', '.md'];

/** Picks the right parser based on the file extension (.md falls back to txt). */
export function parseTranscript(
  filename: string,
  content: string
): TranscriptSegment[] {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.vtt') return parseVtt(content);
  if (ext === '.srt') return parseSrt(content);
  return parseTxt(content);
}

/** Formats seconds as "mm:ss" or "h:mm:ss". */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Renders segments back into a readable plain-text transcript. */
export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments
    .map((seg) => {
      const time = seg.start !== undefined ? `[${formatClock(seg.start)}] ` : '';
      const speaker = seg.speaker ? `${seg.speaker}: ` : '';
      return `${time}${speaker}${seg.text}`;
    })
    .join('\n');
}

export { parseSrt, parseTxt, parseVtt };
export type { TranscriptSegment };
