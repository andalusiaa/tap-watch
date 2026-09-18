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

  /** Photo reports per device per day. */
  reportsPerDay: 5,
  /** Photos in one report. */
  photosPerReport: 4,
  /** Photos from everyone per day (the photo store allows 1,000 writes a day). */
  photosPerDayTotal: 200,
  reportWriteCost: 8,
  photoWriteCost: 3,
  /** Largest photo accepted, after the browser has shrunk it. */
  maxPhotoBytes: 2_000_000,
  maxNoteLength: 280,

  /** Beer suggestions per device per day. */
  suggestionsPerDay: 10,
  suggestionWriteCost: 8,
  maxBeerNameLength: 80,
} as const;

export const SNAPSHOT = {
  /** When data has changed, rebuild the cached snapshot at most this often. */
  rebuildIntervalMs: MINUTE,
  /** Each Worker instance also keeps the snapshot in memory this long. */
  memoryTtlMs: 10_000,
} as const;

export const PHOTOS = {
  /** Unchecked photos are deleted after this long (the store also expires them a day later). */
  maxPendingMs: 30 * DAY,
  storeTtlSeconds: 31 * 24 * 60 * 60,
} as const;

export const ADMIN = {
  /** How long the admin stays signed in. */
  sessionMs: 30 * DAY,
  /** Wrong-password attempts allowed per device per hour, and in total per day. */
  attemptsPerHour: 10,
  failuresPerDay: 100,
  minPasswordLength: 12,
} as const;

export const PRIVACY = {
  /** Device hashes are cleared from votes after this long. */
  deviceHashMaxAgeMs: 30 * DAY,
  /** The device-hash salt is replaced after this long. */
  saltMaxAgeMs: 30 * DAY,
} as const;
