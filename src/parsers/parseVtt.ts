import { parseClock, splitSpeaker, stripTags } from './common.js';
import type { TranscriptSegment } from './types.js';

const ARROW = '-->';
const VOICE_RE = /^<v(?:\.[^\s>]*)?\s+([^>]+)>\s*/i;

/** Parses WebVTT subtitle/caption files, including Zoom-exported VTT. */
export function parseVtt(content: string): TranscriptSegment[] {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  let i = 0;

  // Skip the WEBVTT header block (up to the first blank line).
  if (lines[0]?.trim().startsWith('WEBVTT')) {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '') i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === '') {
      i++;
      continue;
    }
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
      while (i < lines.length && lines[i].trim() !== '') i++;
      continue;
    }

    let timingLine = line;
    if (!line.includes(ARROW)) {
      // Cue identifier line — the timing must be on the next line.
      const next = lines[i + 1]?.trim() ?? '';
      if (!next.includes(ARROW)) {
        i++;
        continue;
      }
      i++;
      timingLine = next;
    }

    const [startRaw, endRaw] = timingLine.split(ARROW);
    const start = parseClock(startRaw);
    const end = parseClock(endRaw);

    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i].trim());
      i++;
    }

    const rawText = textLines.join(' ');
    const voice = rawText.match(VOICE_RE);
    let speaker = voice?.[1]?.trim();
    let text = stripTags(rawText.replace(VOICE_RE, ''));

    if (!speaker) {
      const split = splitSpeaker(text);
      speaker = split.speaker;
      text = split.text;
    }

    if (text) segments.push({ start, end, speaker, text });
  }

  return segments;
}
