/** Shared persistence constants (lock leases, schema version). */

/** Current 2.x schema version applied by the baseline migration. */
export const SCHEMA_VERSION = 1 as const;

/** Publication lock lease duration in seconds (07-security). */
export const PUBLISH_LOCK_LEASE_SECONDS = 120 as const;

/** Renew when this many seconds or fewer remain on the lease. */
export const PUBLISH_LOCK_RENEW_THRESHOLD_SECONDS = 60 as const;

/** Hard lifetime from publish_lock_acquired_at (10 minutes). */
export const PUBLISH_LOCK_HARD_LIFETIME_SECONDS = 600 as const;

/** Best-effort last_used_at throttle window. */
export const TOKEN_LAST_USED_MIN_INTERVAL_SECONDS = 900 as const;
