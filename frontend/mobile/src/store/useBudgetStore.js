import { create } from 'zustand';

/**
 * Zustand store holding the single active budget period — docs/decisions/
 * 0010-budget-settings.md §4. Given the single-mock-user scope, there is
 * exactly one budget period slot, not a list/history array.
 *
 * activePeriod shape (ADR 0010 §3 — a snapshot, not a live reference):
 * {
 *   id: string,                 // `budget-period-${Date.now()}`
 *   periodType: 'automatic' | 'custom',
 *   startDate: string,          // YYYY-MM-DD
 *   endDate: string,            // YYYY-MM-DD
 *   amount: number,              // Monthly Budget
 *   categoryCaps: [
 *     { categoryId: string, categoryName: string, monthlyCap: number },
 *     // only categories with a non-null cap at save time are included.
 *   ],
 * }
 *
 * In-memory only, no persistence, same pattern as every other store in this
 * phase. Starts `null` — a brand-new mock account has never had a period,
 * which is also exactly what getPostAuthDestination's `!activeBudgetPeriod`
 * branch (docs/decisions/0011-post-auth-budget-gate.md) expects.
 */
export const useBudgetStore = create((set) => ({
  activePeriod: null,

  /**
   * Replaces activePeriod wholesale — used for both the very first period
   * (Sign Up / mandatory gate) and every subsequent edit/next-period save
   * from Budget Settings. Editing the still-current period keeps the same
   * `id` (in-place edit); setting up the next period after the current one
   * has ended creates a genuinely new record with a new `id` — both cases
   * are just a full replace from this store's point of view (ADR 0010 §5).
   * @param {object} period
   */
  setPeriod: (period) => set({ activePeriod: period }),

  /**
   * Sets activePeriod back to null — used only by Sign Up (docs/decisions/
   * 0011-post-auth-budget-gate.md §6) to defensively discard any stale
   * period left over from a prior session, since this app has no real
   * per-account data isolation yet (a single, global, in-memory store
   * shared by whichever mock account is "signed in" at a given moment).
   *
   * Deliberately a small, dedicated action rather than a generic
   * updatePeriod(partial) merge action — mirrors docs/decisions/
   * 0009-split-detail-and-settle-up.md §6.3's own reasoning for why Settle
   * Up got a dedicated settleBalance action instead of a manufactured-delta
   * call: a small, obviously-named action stating exactly what it does is
   * more maintainable/readable than a generic merge action whose caller has
   * to remember which fields to touch (constitution §29).
   *
   * NOTE: this store deliberately does NOT implement a `resetPeriodAmount`
   * action — an earlier design considered zeroing an ended period's
   * `amount` at Sign In, but this was removed (ADR 0010's second same-day
   * amendment, Part D) because Budget Summary needs that exact, intact
   * `amount` to compute "Savings for this period." The ended period is left
   * fully untouched until the user actually saves its replacement.
   */
  clearPeriod: () => set({ activePeriod: null }),
}));
