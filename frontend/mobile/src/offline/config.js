/**
 * Offline-first configuration — docs/decisions/0027-offline-first-local-cache-and-replay-sync.md
 * §8.2/§8.3.
 *
 * Flags, caps, backoff constants, schema versions and storage key builders.
 * Every other `src/offline/` module reads its numbers from here, so a tuning
 * change is a one-file change.
 *
 * Layer rule (ADR 0027 §8.1): imports nothing. Never React, never a store.
 */

/**
 * Phase gate (ADR 0027 §8.2/§11). **Turned ON 2026-11-11 by the Project
 * Owner's direction** ("unable to save the transaction" offline — offline
 * saving is the primary objective), ahead of the Phase B checklist. The queue
 * relies on the backend's `Idempotency-Key` + client-supplied-id de-duplication
 * (BE-2/BE-3), which compiles and is unit-tested but has not yet run against a
 * booted server: the backend MUST be the ADR 0027 build (with V18) before
 * queued writes flush, or a retry could record the same money twice. Set back
 * to `false` to restore the direct-call write actions.
 */
export const OFFLINE_WRITES_ENABLED = true;

/** Root of every key this app writes to AsyncStorage (§8.3). */
export const STORAGE_ROOT = '@myexpense/v1';

/**
 * Bump a store's number whenever the shape of what it persists changes. A
 * mismatched envelope is discarded on hydrate and the store reloads from the
 * network — a cache is disposable (§8.3).
 */
export const CACHE_SCHEMA_VERSIONS = {
  profile: 1,
  settings: 1,
  categories: 1,
  transactions: 1,
  budget: 1,
  contacts: 1,
  groups: 1,
  individualBalances: 1,
  splitExpenses: 1,
  // ADR 0028 §7.7: the group/pair feeds, `{ [targetKey]: { items, page,
  // totalPages, fetchStartedAt } }`.
  splitFeed: 1,
  activities: 1,
  notifications: 1,
  statistics: 1,
  changeLog: 1,
};

/**
 * Version stamped on every outbox op. **The outbox is never disposable**: a
 * bump ships a migrator in `outbox.js`, and an op carrying a version higher
 * than this (a downgraded app) is left untouched while the engine pauses.
 */
export const OUTBOX_SCHEMA_VERSION = 1;

/** Per-key caps (§8.3). Trimmed oldest-first; the outbox is never capped. */
export const CACHE_CAPS = {
  transactions: 1000,
  activities: 100,
  notifications: 100,
  splitExpenseTargets: 30,
  splitExpenseRowsPerTarget: 200,
  // ADR 0028 §7.7.
  splitFeedTargets: 30,
  splitFeedItemsPerTarget: 200,
  changeLogEntities: 100,
  changeLogEntriesPerEntity: 50,
  statisticsRanges: 6,
};

/** Debounce for writing a store's envelope after a change (§8.8). */
export const PERSIST_DEBOUNCE_MS = 500;

/** Backoff: `min(5 min, 2 s × 2^failures)` with full jitter (§8.6). */
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;
/** `429 RATE_LIMIT_EXCEEDED` never retries sooner than this (§8.6). */
export const RATE_LIMIT_BACKOFF_FLOOR_MS = 30 * 1000;

/** Above this many pending ops the banner adds "Connect to the internet to sync" (§8.3). */
export const LARGE_OUTBOX_THRESHOLD = 500;

/** The post-auth gate waits at most this long for the network (§8.4). */
export const GATE_ONLINE_TIMEOUT_MS = 5000;

/**
 * Storage key builders (§8.3). `userId` is the authenticated `UserResponse.id`;
 * per-account isolation is entirely by this prefix.
 */
export const storageKeys = {
  deviceId: () => `${STORAGE_ROOT}/device-id`,
  accountPrefix: (userId) => `${STORAGE_ROOT}/u/${userId}/`,
  cachePrefix: (userId) => `${STORAGE_ROOT}/u/${userId}/cache/`,
  cache: (userId, storeKey) => `${STORAGE_ROOT}/u/${userId}/cache/${storeKey}`,
  outboxIndex: (userId) => `${STORAGE_ROOT}/u/${userId}/outbox/index`,
  outboxOpPrefix: (userId) => `${STORAGE_ROOT}/u/${userId}/outbox/op/`,
  outboxOp: (userId, opId) => `${STORAGE_ROOT}/u/${userId}/outbox/op/${opId}`,
  notices: (userId) => `${STORAGE_ROOT}/u/${userId}/sync/notices`,
  syncMeta: (userId) => `${STORAGE_ROOT}/u/${userId}/sync/meta`,
};
