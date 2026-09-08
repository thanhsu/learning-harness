import { describe, expect, it } from 'vitest';
import { parseEventLines } from '../src/capture/captureManager.js';

describe('parseEventLines', () => {
  it('parses complete JSON lines and returns the leftover partial line', () => {
    const events: Record<string, unknown>[] = [];
    const leftover = parseEventLines(
      '{"event":"status","message":"loading"}\n{"event":"chunk","text":"hi"}\n{"event":"par',
      (ev) => events.push(ev)
    );
    expect(events).toEqual([
      { event: 'status', message: 'loading' },
      { event: 'chunk', text: 'hi' },
    ]);
    expect(leftover).toBe('{"event":"par');
  });

  it('continues across chunk boundaries', () => {
    const events: Record<string, unknown>[] = [];
    let buf = parseEventLines('{"event":"a"', (ev) => events.push(ev));
    buf = parseEventLines(buf + '}\n{"event":"b"}\n', (ev) => events.push(ev));
    expect(events.map((e) => e.event)).toEqual(['a', 'b']);
    expect(buf).toBe('');
  });

  it('wraps non-JSON lines as log events and skips blanks', () => {
    const events: Record<string, unknown>[] = [];
    parseEventLines('plain text warning\n\n{"event":"ok"}\n', (ev) =>
      events.push(ev)
    );
    expect(events).toEqual([
      { event: 'log', message: 'plain text warning' },
      { event: 'ok' },
    ]);
  });
});
