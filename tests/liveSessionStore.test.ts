import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidChunkError,
  LiveSessionStore,
  parseLiveTranscript,
} from '../src/live/liveSessionStore.js';

describe('LiveSessionStore', () => {
  let dir: string;
  let calls: Array<{ newText: string; prev: string }>;
  let store: LiveSessionStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-live-'));
    calls = [];
    store = new LiveSessionStore({
      dir,
      summaryEveryChunks: 3,
      summaryEveryMinutes: 9999,
      summarize: async (newText, prev) => {
        calls.push({ newText, prev });
        return `summary ${calls.length}`;
      },
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends chunks to the session transcript file', async () => {
    await store.appendChunk({
      sessionId: 's1',
      timestamp: '2026-09-08T09:00:00Z',
      speaker: 'Dr. Lam',
      text: 'hello class',
    });
    await store.appendChunk({ sessionId: 's1', text: 'no speaker line' });

    const file = path.join(dir, 's1.txt');
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('[2026-09-08T09:00:00Z] Dr. Lam: hello class');
    expect(content).toContain('no speaker line');
    expect(store.get('s1')?.chunkCount).toBe(2);
    expect(store.readTranscript('s1')).toBe(content);
  });

  it('triggers a rolling summary every N chunks with the buffered text', async () => {
    const r1 = await store.appendChunk({ sessionId: 's1', text: 'one' });
    const r2 = await store.appendChunk({ sessionId: 's1', text: 'two' });
    expect(r1.summaryUpdated).toBe(false);
    expect(r2.summaryUpdated).toBe(false);

    const r3 = await store.appendChunk({ sessionId: 's1', text: 'three' });
    expect(r3.summaryUpdated).toBe(true);
    expect(r3.session.rollingSummary).toBe('summary 1');
    expect(calls[0].newText).toBe('one\ntwo\nthree');
    expect(calls[0].prev).toBe('');

    for (const text of ['four', 'five']) {
      await store.appendChunk({ sessionId: 's1', text });
    }
    const r6 = await store.appendChunk({ sessionId: 's1', text: 'six' });
    expect(r6.session.rollingSummary).toBe('summary 2');
    expect(calls[1].newText).toBe('four\nfive\nsix');
    expect(calls[1].prev).toBe('summary 1');
  });

  it('keeps the session alive when the summarizer fails', async () => {
    const failing = new LiveSessionStore({
      dir,
      summaryEveryChunks: 1,
      summarize: async () => {
        throw new Error('quota reached');
      },
    });
    const { session, summaryUpdated } = await failing.appendChunk({
      sessionId: 's2',
      text: 'hello',
    });
    expect(summaryUpdated).toBe(false);
    expect(session.summaryError).toBe('quota reached');
    expect(session.chunkCount).toBe(1);
  });

  it('rejects invalid session ids and empty text', async () => {
    await expect(
      store.appendChunk({ sessionId: '../evil', text: 'x' })
    ).rejects.toThrow(InvalidChunkError);
    await expect(
      store.appendChunk({ sessionId: 's1', text: '   ' })
    ).rejects.toThrow(InvalidChunkError);
  });

  it('ends a session and refuses further chunks', async () => {
    await store.appendChunk({ sessionId: 's1', text: 'hello' });
    const ended = store.end('s1');
    expect(ended.endedAt).toBeTruthy();
    await expect(
      store.appendChunk({ sessionId: 's1', text: 'more' })
    ).rejects.toThrow(/already ended/);
  });

  it('round-trips the transcript file back into clean segments', async () => {
    await store.appendChunk({
      sessionId: 's1',
      timestamp: '2026-09-08T09:00:00Z',
      speaker: 'Dr. Lam',
      text: 'hello class',
    });
    await store.appendChunk({ sessionId: 's1', text: 'plain chunk' });

    const segments = parseLiveTranscript(store.readTranscript('s1'));
    expect(segments).toEqual([
      { speaker: 'Dr. Lam', text: 'hello class' },
      { speaker: undefined, text: 'plain chunk' },
    ]);
  });

  it('lists sessions newest first', async () => {
    let t = 0;
    const clockStore = new LiveSessionStore({
      dir,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)),
    });
    await clockStore.appendChunk({ sessionId: 'a', text: 'x' });
    await clockStore.appendChunk({ sessionId: 'b', text: 'y' });
    expect(clockStore.list().map((s) => s.id)).toEqual(['b', 'a']);
  });
});
