import { describe, expect, it } from 'vitest';
import {
  formatClock,
  parseSrt,
  parseTranscript,
  parseTxt,
  parseVtt,
  segmentsToText,
} from '../src/parsers/index.js';

describe('parseVtt', () => {
  const vtt = `WEBVTT

NOTE this is a comment
that spans two lines

1
00:00:01.000 --> 00:00:04.500
<v Dr. Lam>Welcome to the lecture.

2
00:00:05.000 --> 00:00:09.000
Alice Nguyen: Can you hear me okay?

00:01:00.000 --> 00:01:05.000
This cue has no id
and spans two lines.
`;

  it('parses cues with <v> voice tags', () => {
    const segments = parseVtt(vtt);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      start: 1,
      end: 4.5,
      speaker: 'Dr. Lam',
      text: 'Welcome to the lecture.',
    });
  });

  it('parses "Name: text" speakers inside cue text', () => {
    const segments = parseVtt(vtt);
    expect(segments[1].speaker).toBe('Alice Nguyen');
    expect(segments[1].text).toBe('Can you hear me okay?');
  });

  it('handles id-less multi-line cues and skips NOTE blocks', () => {
    const segments = parseVtt(vtt);
    expect(segments[2].start).toBe(60);
    expect(segments[2].text).toBe('This cue has no id and spans two lines.');
  });
});

describe('parseSrt', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000
John: Hello everyone.

2
00:00:04,000 --> 00:00:06,500
<i>Second line here.</i>
`;

  it('parses blocks with comma milliseconds and strips tags', () => {
    const segments = parseSrt(srt);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      start: 1,
      end: 3,
      speaker: 'John',
      text: 'Hello everyone.',
    });
    expect(segments[1].text).toBe('Second line here.');
    expect(segments[1].end).toBe(6.5);
  });
});

describe('parseTxt', () => {
  it('parses Zoom-style tab-separated lines', () => {
    const segments = parseTxt('00:00:05\tDr. Lam:\tPhotosynthesis basics.\n');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      start: 5,
      speaker: 'Dr. Lam',
      text: 'Photosynthesis basics.',
    });
  });

  it('parses bracketed timestamps and plain lines', () => {
    const segments = parseTxt(
      '[05:12] Alice: hello there\njust a plain line of prose\n\n'
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ start: 312, speaker: 'Alice' });
    expect(segments[1]).toMatchObject({ text: 'just a plain line of prose' });
    expect(segments[1].start).toBeUndefined();
  });
});

describe('parseTranscript dispatch', () => {
  it('routes by extension', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n';
    expect(parseTranscript('a.vtt', vtt)[0].start).toBe(1);
    expect(parseTranscript('a.srt', '1\n00:00:01,000 --> 00:00:02,000\nhi\n')).toHaveLength(1);
    // .md and .txt fall back to the plain-text parser
    expect(parseTranscript('a.md', 'Speaker One: hello')[0].speaker).toBe('Speaker One');
  });
});

describe('segmentsToText / formatClock', () => {
  it('formats clocks with and without hours', () => {
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3725)).toBe('1:02:05');
  });

  it('renders time and speaker prefixes', () => {
    const text = segmentsToText([
      { start: 5, speaker: 'A', text: 'hi' },
      { text: 'no metadata' },
    ]);
    expect(text).toBe('[00:05] A: hi\nno metadata');
  });
});
