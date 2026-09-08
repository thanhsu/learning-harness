import { describe, expect, it } from 'vitest';
import { notePrompt, rollingSummaryPrompt } from '../src/notes/prompts.js';
import {
  languageSlug,
  splitNoteForTranslation,
  translateNotePrompt,
} from '../src/notes/translate.js';

describe('splitNoteForTranslation', () => {
  const note = [
    '# Title',
    '',
    '## Executive Summary',
    'Some summary.',
    '',
    '## Raw Transcript',
    '```text',
    '[00:05] hello',
    '```',
  ].join('\n');

  it('separates the body from the raw-transcript appendix', () => {
    const { body, transcriptSection } = splitNoteForTranslation(note);
    expect(body).toContain('## Executive Summary');
    expect(body).not.toContain('## Raw Transcript');
    expect(transcriptSection).toContain('## Raw Transcript');
    expect(transcriptSection).toContain('[00:05] hello');
  });

  it('returns the whole note as body when there is no transcript section', () => {
    const { body, transcriptSection } = splitNoteForTranslation('# Only body');
    expect(body).toBe('# Only body');
    expect(transcriptSection).toBe('');
  });
});

describe('translateNotePrompt', () => {
  it('names the target language and embeds the note body', () => {
    const p = translateNotePrompt('# Hello', 'vi');
    expect(p).toContain('Vietnamese (vi)');
    expect(p).toContain('# Hello');
    expect(p).toContain('Preserve the Markdown structure');
  });
});

describe('languageSlug', () => {
  it('produces safe file-name suffixes', () => {
    expect(languageSlug('vi')).toBe('vi');
    expect(languageSlug('Vietnamese')).toBe('vietnamese');
    expect(languageSlug('!!')).toBe('translated');
  });
});

describe('outputLanguage in generation prompts', () => {
  it('defaults to the transcript language', () => {
    expect(notePrompt('hi', { source: 's', date: 'd' })).toContain(
      'same language as the transcript'
    );
  });

  it('switches note and rolling-summary prompts to the requested language', () => {
    expect(notePrompt('hi', { source: 's', date: 'd' }, 'vi')).toContain(
      'Write ALL output in Vietnamese (vi)'
    );
    expect(rollingSummaryPrompt('', 'new text', 'vi')).toContain(
      'Vietnamese (vi)'
    );
  });
});
