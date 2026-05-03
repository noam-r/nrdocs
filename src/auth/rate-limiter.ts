/** Result of a rate-limit check. */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Tracks failed login attempts per repo using the D1 `rate_limit_entries` table.
 *
 * Keys by repo_id only (not per-IP).
 *
 * @see Requirement 5.10
 */
export class RateLimiter {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Check whether a login attempt is allowed and, if so, increment the counter.
   *
   * Logic:
   * 1. Read the current entry for the project.
   * 2. If no entry exists or the window has expired, reset with attempt_count=1
   *    and return allowed.
   * 3. If the window is active and attempts >= maxAttempts, deny with
   *    retryAfterSeconds.
   * 4. Otherwise increment attempt_count and allow.
   */
  async checkAndIncrement(
    repoId: string,
    maxAttempts: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const row = await this.db
      .prepare('SELECT attempt_count, window_start FROM rate_limit_entries WHERE repo_id = ?')
      .bind(repoId)
      .first<{ attempt_count: number; window_start: string }>();

    // No existing entry or window expired → reset
    if (!row || this.isWindowExpired(row.window_start, windowSeconds, now)) {
      await this.db
        .prepare(
          'INSERT OR REPLACE INTO rate_limit_entries (repo_id, attempt_count, window_start) VALUES (?, 1, ?)',
        )
        .bind(repoId, nowIso)
        .run();
      return { allowed: true };
    }

    // Window is active — check threshold
    if (row.attempt_count >= maxAttempts) {
      const windowStartMs = new Date(row.window_start).getTime();
      const windowEndMs = windowStartMs + windowSeconds * 1000;
      const retryAfterSeconds = Math.ceil((windowEndMs - now) / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
    }

    // Under threshold — increment and allow
    await this.db
      .prepare(
        'UPDATE rate_limit_entries SET attempt_count = attempt_count + 1 WHERE repo_id = ?',
      )
      .bind(repoId)
      .run();

    return { allowed: true };
  }

  private isWindowExpired(windowStart: string, windowSeconds: number, nowMs: number): boolean {
    const windowStartMs = new Date(windowStart).getTime();
    return nowMs >= windowStartMs + windowSeconds * 1000;
  }
}
