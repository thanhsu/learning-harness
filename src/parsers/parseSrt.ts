import { parseClock, splitSpeaker, stripTags } from './common.js';
import type { TranscriptSegment } from './types.js';

/** Parses SubRip (.srt) subtitle files. */
export function parseSrt(content: string): TranscriptSegment[] {
  const blocks = content.replace(/^﻿/, '').split(/\r?\n\r?\n+/);
  const segments: TranscriptSegment[] = [];

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    let idx = 0;
    if (/^\d+$/.test(lines[0])) idx = 1; // numeric cue index

    const timing = lines[idx];
    if (!timing || !timing.includes('-->')) continue;
    const [startRaw, endRaw] = timing.split('-->');

    const raw = stripTags(lines.slice(idx + 1).join(' '));
    if (!raw) continue;

    const { speaker, text } = splitSpeaker(raw);
    if (text) {
      segments.push({
        start: parseClock(startRaw),
        end: parseClock(endRaw),
        speaker,
        text,
      });
    }
  }

  return segments;
}
