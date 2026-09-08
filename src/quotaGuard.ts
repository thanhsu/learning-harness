import type { Db } from './db/sqlite.js';

export class QuotaExceededError extends Error {
  readonly used: number;
  readonly limit: number;

  constructor(used: number, limit: number) {
    super(
      `Daily AI call limit reached (${used}/${limit}). ` +
        `learning-harness has stopped calling Gemini to keep you inside the free tier. ` +
        `Notes will still be generated in offline fallback mode. ` +
        `Raise MAX_DAILY_CALLS in .env if you need more calls, or wait until tomorrow.`
    );
    this.name = 'QuotaExceededError';
    this.used = used;
    this.limit = limit;
  }
}

/**
 * Persistent per-day counter of AI calls, backed by SQLite so the limit
 * survives restarts. The day boundary uses the machine's local timezone.
 */
export class QuotaGuard {
  constructor(
    private readonly db: Db,
    private maxDailyCalls: number,
    private readonly now: () => Date = () => new Date()
  ) {}

  get limit(): number {
    return this.maxDailyCalls;
  }

  /** Updates the daily limit at runtime (Settings UI). */
  setLimit(maxDailyCalls: number): void {
    this.maxDailyCalls = Math.max(0, Math.floor(maxDailyCalls));
  }

  private today(): string {
    const d = this.now();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  callsToday(): number {
    const row = this.db
      .prepare('SELECT calls FROM ai_calls WHERE day = ?')
      .get(this.today()) as { calls: number } | undefined;
    return row?.calls ?? 0;
  }

  remaining(): number {
    return Math.max(0, this.maxDailyCalls - this.callsToday());
  }

  /** Throws QuotaExceededError if no calls remain. Does not consume a call. */
  assertCanCall(): void {
    const used = this.callsToday();
    if (used >= this.maxDailyCalls) {
      throw new QuotaExceededError(used, this.maxDailyCalls);
    }
  }

  /** Records one successful AI call for today. */
  recordCall(): void {
    this.db
      .prepare(
        `INSERT INTO ai_calls (day, calls) VALUES (?, 1)
         ON CONFLICT(day) DO UPDATE SET calls = calls + 1`
      )
      .run(this.today());
  }

  /** Convenience: assertCanCall + recordCall in one step. */
  consume(): void {
    this.assertCanCall();
    this.recordCall();
  }
}
