import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../src/db/sqlite.js';
import { QuotaExceededError, QuotaGuard } from '../src/quotaGuard.js';

describe('QuotaGuard', () => {
  let db: Db;
  let now: Date;
  let guard: QuotaGuard;

  beforeEach(() => {
    db = openMemoryDb();
    now = new Date('2026-01-05T10:00:00');
    guard = new QuotaGuard(db, 3, () => now);
  });

  it('allows calls up to the daily limit', () => {
    guard.consume();
    guard.consume();
    guard.consume();
    expect(guard.callsToday()).toBe(3);
    expect(guard.remaining()).toBe(0);
  });

  it('throws a clear QuotaExceededError once the limit is reached', () => {
    for (let i = 0; i < 3; i++) guard.consume();
    expect(() => guard.consume()).toThrow(QuotaExceededError);
    try {
      guard.assertCanCall();
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as QuotaExceededError;
      expect(e.message).toContain('3/3');
      expect(e.message).toContain('MAX_DAILY_CALLS');
      expect(e.used).toBe(3);
      expect(e.limit).toBe(3);
    }
  });

  it('assertCanCall does not consume a call', () => {
    guard.assertCanCall();
    guard.assertCanCall();
    expect(guard.callsToday()).toBe(0);
  });

  it('resets the counter on the next day', () => {
    for (let i = 0; i < 3; i++) guard.consume();
    expect(() => guard.assertCanCall()).toThrow(QuotaExceededError);

    now = new Date('2026-01-06T00:05:00');
    expect(guard.callsToday()).toBe(0);
    guard.consume();
    expect(guard.callsToday()).toBe(1);
  });

  it('persists counts per day in the database', () => {
    guard.consume();
    const other = new QuotaGuard(db, 3, () => now);
    expect(other.callsToday()).toBe(1);
  });
});
