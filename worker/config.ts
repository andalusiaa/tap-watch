// Limits for the API, in one place (SPEC section 9).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIMITS = {
  /** A form submitted sooner than this after the page loaded is treated as a bot. */
  minFormAgeMs: 2_000,
  /** Older page tokens are refused; the page fetches a fresh one and retries. */
  maxFormAgeMs: 12 * HOUR,

  /** One vote per listing per device in this window. */
  voteRepeatWindowMs: DAY,
  /** Votes per device per clock hour. */
  votesPerHour: 30,

  /**
   * Daily budget of database rows written, kept well under the D1 free limit of 100,000.
   * Each accepted vote spends VOTE_WRITE_COST (table rows plus index rows).
   */
  dailyWriteBudget: 50_000,
  voteWriteCost: 10,
} as const;

export const SNAPSHOT = {
  /** When data has changed, rebuild the cached snapshot at most this often. */
  rebuildIntervalMs: MINUTE,
  /** Each Worker instance also keeps the snapshot in memory this long. */
  memoryTtlMs: 10_000,
} as const;

export const PRIVACY = {
  /** Device hashes are cleared from votes after this long. */
  deviceHashMaxAgeMs: 30 * DAY,
  /** The device-hash salt is replaced after this long. */
  saltMaxAgeMs: 30 * DAY,
} as const;
