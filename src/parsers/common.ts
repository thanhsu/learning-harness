/** Parses "hh:mm:ss.mmm" / "mm:ss,mmm" cue clocks into seconds. */
export function parseClock(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.trim().match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  if (!m) return undefined;
  const [, h, min, s, ms] = m;
  return (
    (h ? Number(h) * 3600 : 0) +
    Number(min) * 60 +
    Number(s) +
    Number(ms.padEnd(3, '0')) / 1000
  );
}

/** Parses loose clocks like "1:02:03", "12:34" or "12:34.5" into seconds. */
export function parseLooseClock(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw
    .trim()
    .match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return undefined;
  const [, h, min, s, ms] = m;
  return (
    (h ? Number(h) * 3600 : 0) +
    Number(min) * 60 +
    Number(s) +
    (ms ? Number(ms.padEnd(3, '0')) / 1000 : 0)
  );
}

// Letters (including Vietnamese/latin-extended), then the usual name characters.
const SPEAKER_RE =
  /^([A-Za-zÀ-ɏḀ-ỿ][\w .'’\-À-ɏḀ-ỿ]{0,58}?)\s*:\s+(.+)$/u;

/** Splits a leading "Speaker Name: text" prefix off a line, if present. */
export function splitSpeaker(text: string): { speaker?: string; text: string } {
  const m = text.match(SPEAKER_RE);
  if (m) return { speaker: m[1].trim(), text: m[2].trim() };
  return { text: text.trim() };
}

/** Removes markup tags like <v Name>, <i>, <b> from cue text. */
export function stripTags(text: string): string {
  return text.replace(/<\/?[^>]+>/g, '').trim();
}
