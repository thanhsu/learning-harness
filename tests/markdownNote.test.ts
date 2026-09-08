import { describe, expect, it } from 'vitest';
import {
  fallbackNoteData,
  normalizeNoteData,
  renderNote,
  slugify,
  type NoteData,
} from '../src/notes/markdownNote.js';

const fullNote: NoteData = {
  title: 'Photosynthesis Basics',
  executiveSummary: 'The lecture covered how plants convert light into energy.',
  keyConcepts: ['Chlorophyll', 'Light reactions'],
  timeline: [{ time: '00:05', event: 'Introduction to photosynthesis' }],
  definitions: [{ term: 'Chlorophyll', definition: 'Green pigment in chloroplasts.' }],
  reviewQuestions: ['What are the two stages of photosynthesis?'],
  quiz: [{ question: 'Where do light reactions occur?', answer: 'In the thylakoid membranes.' }],
  flashcards: [{ question: 'What gas do plants absorb?', answer: 'Carbon dioxide (CO2).' }],
  actionItems: ['Read chapter 8 before Friday.'],
};

describe('renderNote', () => {
  it('renders every required section with content', () => {
    const md = renderNote(fullNote, {
      date: '2026-09-08 09:00',
      source: 'samples/sample.vtt',
      generatedBy: 'gemini (gemini-2.5-flash)',
      transcript: '[00:05] Dr. Lam: Welcome.',
    });

    expect(md).toContain('# Photosynthesis Basics');
    expect(md).toContain('- **Date:** 2026-09-08 09:00');
    expect(md).toContain('- **Source:** samples/sample.vtt');
    expect(md).toContain('## Executive Summary');
    expect(md).toContain('## Key Concepts');
    expect(md).toContain('- Chlorophyll');
    expect(md).toContain('## Timeline');
    expect(md).toContain('- **00:05** — Introduction to photosynthesis');
    expect(md).toContain('## Important Definitions');
    expect(md).toContain('## Questions to Review');
    expect(md).toContain('1. What are the two stages of photosynthesis?');
    expect(md).toContain('## Quiz');
    expect(md).toContain('**Q1. Where do light reactions occur?**');
    expect(md).toContain('> **Answer:** In the thylakoid membranes.');
    expect(md).toContain('## Flashcards');
    expect(md).toContain('- **Q:** What gas do plants absorb?');
    expect(md).toContain('**A:** Carbon dioxide (CO2).');
    expect(md).toContain('## Action Items');
    expect(md).toContain('- [ ] Read chapter 8 before Friday.');
    expect(md).toContain('## Raw Transcript');
    expect(md).toContain('[00:05] Dr. Lam: Welcome.');
  });

  it('links to the transcript file when transcriptRef is given', () => {
    const md = renderNote(fullNote, {
      date: 'today',
      source: 'live session bio-101',
      generatedBy: 'gemini (gemini-2.5-flash)',
      transcriptRef: '/tmp/sessions/bio-101.txt',
    });
    expect(md).toContain('Raw transcript file: `/tmp/sessions/bio-101.txt`');
    expect(md).not.toContain('```text');
  });

  it('marks empty sections instead of omitting them', () => {
    const md = renderNote(
      { ...fullNote, quiz: [], flashcards: [], actionItems: [] },
      { date: 'today', source: 'x', generatedBy: 'offline fallback' }
    );
    expect(md).toContain('## Quiz');
    expect(md).toContain('_None captured._');
  });
});

describe('normalizeNoteData', () => {
  it('coerces a sloppy model response into a valid NoteData', () => {
    const data = normalizeNoteData(
      {
        title: '  Trimmed  ',
        keyConcepts: ['ok', 42, ''],
        quiz: [{ question: 'q', answer: 'a' }, { question: 'incomplete' }],
        unexpected: true,
      },
      'Fallback Title'
    );
    expect(data.title).toBe('Trimmed');
    expect(data.keyConcepts).toEqual(['ok']);
    expect(data.quiz).toEqual([{ question: 'q', answer: 'a' }]);
    expect(data.flashcards).toEqual([]);
  });

  it('uses the fallback title when missing', () => {
    expect(normalizeNoteData({}, 'My Lecture').title).toBe('My Lecture');
  });
});

describe('fallbackNoteData', () => {
  it('builds an extractive note without any AI', () => {
    const data = fallbackNoteData(
      [
        { start: 0, speaker: 'Dr. Lam', text: 'Photosynthesis converts light into chemical energy.' },
        { start: 60, text: 'Chlorophyll absorbs photons. Photosynthesis needs chlorophyll.' },
      ],
      'bio-101'
    );
    expect(data.title).toBe('bio-101');
    expect(data.executiveSummary).toContain('Photosynthesis');
    expect(data.reviewQuestions.length).toBeGreaterThan(0);
    expect(data.timeline[0].time).toBe('00:00');
  });
});

describe('slugify', () => {
  it('produces safe file names, including from Vietnamese titles', () => {
    expect(slugify('Photosynthesis: Basics!')).toBe('photosynthesis-basics');
    expect(slugify('Hô hấp tế bào')).toBe('ho-hap-te-bao');
    expect(slugify('***')).toBe('note');
  });
});
