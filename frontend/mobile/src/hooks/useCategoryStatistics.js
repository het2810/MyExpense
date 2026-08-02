import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useStatisticsStore } from '../store/useStatisticsStore';
import { useBudgetStore } from '../store/useBudgetStore';
import { buildBreakdownRows, resolveStatisticsRange } from '../utils/statistics';
import { useWaitingOpCount } from './useActiveOps';

/**
 * The single entry point to the expense breakdown by parent category —
 * `GET /api/v1/statistics/categories` (docs/api/api-overview.md §14.1) — for
 * the Statistics tab.
 *
 * **This hook is the load trigger**, the same arrangement as
 * `useCategories`/`useTransactions`/`useUserSettings`. The loader is
 * cache-first per range and guards its own in-flight read, so mounting the tab
 * twice in a session is one request. **The trigger fires on focus, not on
 * mount** — see the effect below for why that is required rather than
 * incidental now that a transaction write invalidates this cache.
 *
 * It owns the two things a screen must not: **which range the tab opens on**
 * and **the derived numbers §14 deliberately omits** (constitution §8). Both
 * live in the pure `utils/statistics.js`; this hook is the thin seam that wires
 * them to the store and hands a screen one ready-to-render shape.
 *
 * ---
 * **THE RANGE: THE ACTIVE BUDGET PERIOD, FALLING BACK TO THIS CALENDAR MONTH.**
 *
 * §14 takes two optional inclusive dates and **no `budgetPeriodId`** — that is
 * a contract decision with three reasons behind it (ADR 0022 §2), and the
 * alignment with the user's budgeting model is preserved by the *client's
 * choice of range*. So this hook reads `useBudgetStore`'s `activePeriod` and
 * passes its `startDate`/`endDate`; with no period saved it passes the current
 * calendar month, because `GET /budget/active-period` answers `404
 * NO_ACTIVE_PERIOD` for a user who has never saved one and statistics must
 * still answer for them.
 *
 * `activePeriod` is still **local** state this phase (Domain 5 is unbuilt, so
 * §5.1 is not wired) — the range therefore comes from the same store Budget
 * Settings writes and the Dashboard already reads, so the two surfaces describe
 * the same period by construction.
 *
 * ---
 * **AND THE RANGE IS NOW STEPPABLE** (Project Owner, 2026-11-01 — "in the stats
 * tab I can't view the previous months transaction donut"). The tab shipped
 * with one reachable range, so every earlier month was unreachable rather than
 * merely un-defaulted. `monthsBack` is the whole of the picker:
 *
 * - **It lives here, not in the screen**, because which range the tab reads was
 *   already this hook's single responsibility (constitution §8) and the
 *   drill-down's `dateFrom`/`dateTo` come from the same `range` object the chart
 *   does — one source, so a tapped slice and the list it opens cannot describe
 *   different dates.
 * - **The future is unreachable by construction**, not by validation:
 *   `goToNextMonth` floors at `0` and `canGoToNextMonth` is false there, so the
 *   newest range is the one the tab opens on. An empty donut for a month that
 *   has not happened yet reads as a broken screen, which is the one thing the
 *   stepper must not produce.
 * - **The past is deliberately uncapped.** A month with no expenses is a
 *   successful `200` with an empty array (§14.1) and gets the screen's genuine
 *   empty state — an accurate statement, unlike a disabled button that cannot
 *   explain itself.
 * - **It re-reads through the store's own cache, never around it.** Changing it
 *   changes `dateFrom`/`dateTo`, which are already this hook's load-effect
 *   dependencies, so a step is one ordinary `loadCategoryStatistics({ dateFrom,
 *   dateTo })` call: the store answers from memory when that range is already
 *   held, and clears the old figures before fetching when it is not
 *   (`useStatisticsStore`'s "cached per range" note). Nothing passes `force`
 *   here — `force` stays what it was, the explicit Retry.
 *
 * `monthsBack` is **component state and resets with the tab**, which is correct
 * rather than incidental: the range a user stepped to is a transient view of
 * their data, not a preference, and re-entering Statistics should state the
 * current period again.
 *
 * ---
 * **EXPENSES ONLY.** There is no `type` here and nothing to toggle: §14
 * excludes income structurally (ADR 0022 §1). A screen reading this hook cannot
 * ask for an income breakdown because there is nothing to ask.
 *
 * @returns {{
 *   rows: object[],
 *   totalSpent: number,
 *   range: { dateFrom: string, dateTo: string,
 *     source: 'budget-period' | 'calendar-month' | 'past-month' },
 *   hasLoaded: boolean,
 *   isLoading: boolean,
 *   loadError: string | null,
 *   reload: () => void,
 *   canGoToPreviousMonth: boolean,
 *   canGoToNextMonth: boolean,
 *   goToPreviousMonth: () => void,
 *   goToNextMonth: () => void,
 * }}
 */
export function useCategoryStatistics() {
  const activePeriod = useBudgetStore((state) => state.activePeriod);
  const totalSpent = useStatisticsStore((state) => state.totalSpent);
  const categories = useStatisticsStore((state) => state.categories);
  const hasLoaded = useStatisticsStore((state) => state.hasLoaded);
  const isLoading = useStatisticsStore((state) => state.isLoading);
  const loadError = useStatisticsStore((state) => state.loadError);
  const loadCategoryStatistics = useStatisticsStore((state) => state.loadCategoryStatistics);
  const waitingTransactionOps = useWaitingOpCount('transactions');

  // How many whole calendar months back the user has stepped. `0` is the range
  // the tab opens on and the newest one reachable — see the stepper note above.
  const [monthsBack, setMonthsBack] = useState(0);

  const range = useMemo(
    () => resolveStatisticsRange(activePeriod, monthsBack),
    [activePeriod, monthsBack],
  );
  const { dateFrom, dateTo } = range;

  // A no-op once a read has succeeded for this range and nothing has
  // invalidated it; after a failure `hasLoaded` is still false, so re-entering
  // the tab retries. The range is in the dependency list, so saving a new budget
  // period (or stepping to another month) re-reads the breakdown for the new
  // dates instead of leaving the old range's figures on screen.
  //
  // **On focus rather than on mount** (2026-11-01, with the statistics
  // invalidation). `MainTabs` is a bottom-tab navigator with no `unmountOnBlur`,
  // so this tab stays mounted once visited and a plain mount effect runs exactly
  // once per session — which is precisely why a transaction saved on the
  // Dashboard could never reach this screen. Focus is also what makes
  // "invalidate, don't fetch" work: the write marks the cache, this call is the
  // ordinary cache-first read, and the request happens when the user actually
  // looks at the tab. It is still one request per range per session in the
  // common case, because nothing invalidated means nothing is fetched.
  useFocusEffect(
    useCallback(() => {
      loadCategoryStatistics({ dateFrom, dateTo });
    }, [loadCategoryStatistics, dateFrom, dateTo]),
  );

  /**
   * Whether a step may be taken at all right now.
   *
   * **A range change is a read, and the store serves one read at a time** by
   * design (`useStatisticsStore.loadCategoryStatistics`'s in-flight guard). A
   * second step taken mid-read would therefore be *dropped* by that guard, and
   * the first read would then land and set `hasLoaded` — leaving the previous
   * range's figures on screen under the new range's label, with no further
   * effect run to correct them. That is precisely the "a wrong number with a
   * confident caption" failure both that store and this screen are written to
   * make impossible, so the arrows go inert for the duration of a read instead
   * of queuing a step that cannot be served.
   *
   * It is not a spinner-lock on the screen: a failed read clears `isLoading`,
   * so the arrows come back and the user is never stranded on a range.
   */
  const canStepRange = !isLoading;

  const goToPreviousMonth = useCallback(() => {
    setMonthsBack((current) => current + 1);
  }, []);

  /**
   * One month newer, and never newer than the range the tab opened on — the
   * floor is here rather than in a guard at the call site, so there is no
   * ordering in which a press can produce a future range.
   */
  const goToNextMonth = useCallback(() => {
    setMonthsBack((current) => Math.max(0, current - 1));
  }, []);

  /**
   * The breakdown with each entry's share of `totalSpent` and each parent's own
   * direct spend attached, **in the server's order** (`amount` descending,
   * ties by name ascending — §14.1). Nothing re-sorts and nothing recomputes
   * `totalSpent`.
   */
  const rows = useMemo(() => buildBreakdownRows(categories, totalSpent), [categories, totalSpent]);

  const reload = useCallback(() => {
    loadCategoryStatistics({ dateFrom, dateTo, force: true });
  }, [loadCategoryStatistics, dateFrom, dateTo]);

  return {
    rows,
    totalSpent,
    range,
    hasLoaded,
    isLoading,
    loadError,
    // Server aggregates: offline they show the cached range, and say so when
    // queued transaction writes are not in them (ADR 0027 §8.8).
    unsyncedNote:
      waitingTransactionOps > 0 ? "Doesn't include changes waiting to sync." : null,
    reload,
    canGoToPreviousMonth: canStepRange,
    canGoToNextMonth: canStepRange && monthsBack > 0,
    goToPreviousMonth,
    goToNextMonth,
  };
}
