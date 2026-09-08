import { parseLooseClock, splitSpeaker } from './common.js';
import type { TranscriptSegment } from './types.js';

// Optional leading timestamp: "00:00:03", "[05:12]", "1:02:03.500" followed by
// whitespace/tab/dash separators. Zoom's .txt exports use "HH:MM:SS<tab>Name:<tab>text".
const TIME_PREFIX =
  /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*(?:[-–>]\s*)?/;

/** Parses plain-text / Markdown transcripts (Zoom .txt export, pasted text). */
export function parseTxt(content: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let rest = line;
    let start: number | undefined;

    const t = rest.match(TIME_PREFIX);
    if (t) {
      start = parseLooseClock(t[1]);
      rest = rest.slice(t[0].length).trim();
    }

    const { speaker, text } = splitSpeaker(rest);
    if (text) segments.push({ start, speaker, text });
  }

  return segments;
}
