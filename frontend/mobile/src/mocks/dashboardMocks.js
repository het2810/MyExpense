/**
 * MOCK DATA — locally defined placeholder data, not sourced from any API.
 *
 * `dashboardSummary` previously carried `monthlyBudget`/`spent`/`remaining`/
 * `dailyAverage`/`savings` as hand-typed, frozen figures. All five are gone
 * now: `monthlyBudget`/`spent`/`remaining`/`dailyAverage` are derived on
 * DashboardScreen from useBudgetStore's activePeriod and
 * useTransactionsStore (docs/decisions/0010-budget-settings.md §8), and
 * `savings` is removed from the live Dashboard entirely — reintroduced only
 * as a one-time retrospective figure on BudgetSummaryScreen (that ADR's
 * second same-day amendment, §A/§B). `currencySymbol` is the only field
 * this app has no derivation source for (no multi-currency support exists),
 * so it stays a plain static export.
 */

export const dashboardSummary = {
  currencySymbol: '₹',
};
