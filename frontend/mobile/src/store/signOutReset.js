import { useAuthStore } from './useAuthStore';

/**
 * Per-account server data must not survive a sign-out.
 *
 * Every store that caches something fetched for the *current* account
 * (profile, settings, and later categories/transactions/budget/splits) holds
 * it in a module-level singleton that outlives the session. Without this, a
 * logout followed by a sign-in as a different account would render the
 * previous user's name, email and premium state — and because the loaders are
 * cache-first, a stale value could persist for the whole next session rather
 * than for a render. In a finance app that is a correctness and privacy
 * failure, not a cosmetic one.
 *
 * Direction of dependency, deliberately: the per-account caches depend on the
 * session, never the reverse. `useAuthStore` stays unaware of who caches what,
 * so a new domain store opts in here instead of being added to the auth
 * store's imports (and no cycle is possible — `useAuthStore` imports nothing
 * from `src/store/`).
 *
 * This fires on **every** transition out of an authenticated session — the
 * deliberate `logout()` and the forced `handleSessionExpired()` path
 * (ADR 0016 §6.4/§6.5) both flip `isAuthenticated` to false, which is the one
 * signal both share.
 */

/** @type {Set<() => void>} */
const resetHandlers = new Set();

/**
 * Incremented on every change of session identity — the same device as
 * `authSession.sessionEpoch` (ADR 0016 §6.6), for the same reason, one layer
 * up.
 *
 * Clearing a cache is not enough on its own: a `GET /users/me` that was
 * already in flight when the user tapped Log Out will still resolve, and its
 * `set()` would write the previous account's profile straight back into the
 * store it had just been cleared from. Because the loaders are cache-first,
 * that value would then be *skipped over* on the next sign-in rather than
 * refetched — so a different account could be shown someone else's name,
 * email and premium tier for an entire session.
 *
 * As in ADR 0016 §6.6, the request cannot be un-sent; the only thing the
 * client controls is whether it keeps the answer. A store reads the epoch
 * before awaiting and compares it after, discarding the result if it moved.
 * The compare-and-act sequence cannot be interleaved — React Native runs one
 * single-threaded JS context.
 */
let sessionEpoch = 0;

// Zustand v5's vanilla `subscribe` receives (state, previousState), so the
// edge can be detected without tracking the previous value by hand. Reset
// handlers fire for the `true -> false` edge only: a reset on a
// `false -> false` no-op write would clear a freshly-loaded cache for no
// reason. The epoch moves on either edge, since both change *which* account
// subsequent data belongs to.
useAuthStore.subscribe((state, previousState) => {
  if (previousState.isAuthenticated === state.isAuthenticated) {
    return;
  }
  sessionEpoch += 1;
  if (!state.isAuthenticated) {
    resetHandlers.forEach((handler) => handler(state, previousState));
  }
});

/**
 * Registers a store's reset action. Call once, at module scope, from the
 * store that owns the cached data.
 *
 * The handler receives the auth state after and before the sign-out
 * (additive; existing handlers ignore them). The offline layer needs both:
 * the outgoing `user.id`, captured before it was cleared, and
 * `sessionEndedReason` (`null` = deliberate logout), which decides whether the
 * outbox survives (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.10).
 *
 * @param {(state: object, previousState: object) => void} handler
 */
export function registerSignOutReset(handler) {
  resetHandlers.add(handler);
}

/**
 * Read before awaiting a request, and compared after it settles. A changed
 * value means "this answer is about a session that has since ended" — discard
 * it rather than writing it into state.
 *
 * @returns {number}
 */
export function getSessionEpoch() {
  return sessionEpoch;
}
