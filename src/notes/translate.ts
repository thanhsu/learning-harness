import fs from 'node:fs';
import path from 'node:path';
import type { AiClient } from '../geminiClient.js';
import { clipTranscript, displayLanguage } from './prompts.js';

const TRANSCRIPT_HEADING = '\n## Raw Transcript';

/**
 * Splits a note into the translatable body and the raw-transcript appendix.
 * The transcript is never translated — it is re-attached verbatim, which keeps
 * the source of truth intact and saves a lot of tokens.
 */
export function splitNoteForTranslation(markdown: string): {
  body: string;
  transcriptSection: string;
} {
  const idx = markdown.indexOf(TRANSCRIPT_HEADING);
  if (idx === -1) return { body: markdown, transcriptSection: '' };
  return {
    body: markdown.slice(0, idx),
    transcriptSection: markdown.slice(idx),
  };
}

export function translateNotePrompt(body: string, language: string): string {
  return `Translate the following Markdown study note into ${displayLanguage(language)}.

Rules:
- Preserve the Markdown structure EXACTLY: headings, bullet lists, numbered lists, checkboxes (- [ ]), bold markers, blockquotes (>).
- Keep technical/domain terms in their original language, adding a ${displayLanguage(language)} explanation in parentheses the first time each appears.
- Do not add, remove, or reorder content. Do not add commentary.
- Return ONLY the translated Markdown, no code fences around it.

Note:
"""
${clipTranscript(body)}
"""`;
}

/** Sanitizes a language value into a short file-name suffix ("vi", "japanese"). */
export function languageSlug(language: string): string {
  return (
    language
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 12) || 'translated'
  );
}

export interface TranslateNoteResult {
  notePath: string;
  noteName: string;
}

/**
 * Translates a vault note with Gemini and writes it next to the original as
 * `<name>.<lang>.md` (overwriting a previous translation of the same note).
 */
export async function translateNote(opts: {
  vaultDir: string;
  name: string;
  language: string;
  ai: AiClient;
}): Promise<TranslateNoteResult> {
  const sourcePath = path.join(opts.vaultDir, opts.name);
  const markdown = fs.readFileSync(sourcePath, 'utf8');
  const { body, transcriptSection } = splitNoteForTranslation(markdown);

  let translated = (
    await opts.ai.generate(translateNotePrompt(body, opts.language))
  ).trim();
  // Strip a wrapping code fence if the model added one despite instructions.
  const fence = translated.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  if (fence) translated = fence[1].trim();

  const slug = languageSlug(opts.language);
  const noteName = opts.name.replace(/(\.[a-z0-9]{1,12})?\.md$/i, `.${slug}.md`);
  const notePath = path.join(opts.vaultDir, noteName);
  const output = transcriptSection
    ? `${translated}\n\n${transcriptSection.trimStart()}`
    : `${translated}\n`;
  fs.writeFileSync(notePath, output.endsWith('\n') ? output : `${output}\n`, 'utf8');
  return { notePath, noteName };
}
