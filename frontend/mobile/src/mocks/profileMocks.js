/**
 * MOCK DATA — locally defined placeholder data, not sourced from any API.
 * There is no backend user-profile endpoint yet; this feeds the Profile
 * screen only. Replace with React Query-backed data once the Backend
 * Engineer publishes the relevant endpoints.
 */

export const profileUser = {
  name: 'Jane Doe',
  email: 'jane.doe@example.com',
  initials: 'JD',
  // Mock UPI id — docs/decisions/0007-transaction-detail-screen.md §3.3.
  // Deliberately an "@examplebank" handle (mirroring the same "obviously
  // fake" convention already established by `email` above) rather than a
  // real-looking UPI suffix (@okhdfcbank/@paytm/@ybl), so it reads
  // unambiguously as placeholder data. Read by TransactionDetailScreen's
  // premium Payment Method card for 'online'/'both' payment modes.
  mockUpiId: 'jane.doe@examplebank',
};

export const profileStats = [
  { id: 'stat-1', label: 'Total Spent', value: '₹27,650' },
  { id: 'stat-2', label: 'Groups', value: '3' },
  { id: 'stat-3', label: 'Transactions', value: '48' },
];

// `type` distinguishes navigation-style rows (tap → `action`, e.g. 'logout'
// → useAuthStore.logout()) from 'toggle' rows, which render a ToggleSwitch
// in the trailing slot instead and are bound directly to a Zustand store in
// ProfileScreen (no `onPress`/`action`). "Budget Settings" (docs/decisions/
// 0010-budget-settings.md / 0011-post-auth-budget-gate.md's second same-day
// amendment, Part D) is no longer inert as of this round — its target
// screens (BudgetSettings, BudgetSummary) exist and are registered in
// ProfileStack.jsx. ProfileScreen.jsx's handlePreferencePress routes this
// row by `item.id` (not `action`, since which screen it opens depends on
// whether the current budget period has already ended), mirroring how
// "Activities" (docs/decisions/0008-activity-log-system.md §5) already
// routes by its own real 'activities' `action` branch.
//
// "Notifications" (docs/decisions/0012-notifications-system.md §1/§5.6) —
// removed entirely, not left inert. The new header bell (NotificationBell.jsx,
// ScreenHeader's rightSlot on Dashboard/Split/Profile) is now the sole entry
// point to the Notifications screen — leaving a second, still-separate row
// pointing at the same destination would be a confusing, redundant
// affordance now that the destination actually exists.
//
// "Currency" (docs/decisions/0013-confirmation-dialog-and-free-tier-polish.md
// §3, docs/ui/design-system.md §17) — added 2026-08-14. Did not exist in
// this file before that round. Positioned directly after "Activities",
// grouped with the other navigate/inspect rows, before the two `type:
// 'toggle'` rows — same grouping rationale ADR 0008 §5 already used for
// "Activities" itself. `action: null` deliberately: this row's `onPress` is
// ALWAYS omitted by ProfileScreen.jsx (both free and premium tiers) — no
// currency-switching screen exists this round, so there is nothing for an
// `action` to navigate to; the free-tier "PREMIUM" lock badge and dimming
// are rendered by ProfileScreen.jsx directly, keyed off this row's `id`,
// not through this generic navigation mechanism.
export const preferenceItems = [
  {
    id: 'pref-budget',
    label: 'Budget Settings',
    subtitle: 'Manage monthly limits',
    type: 'navigation',
    action: null,
  },
  {
    id: 'pref-activities',
    label: 'Activities',
    subtitle: 'Recent actions across MyExpense',
    type: 'navigation',
    action: 'activities',
  },
  {
    id: 'pref-currency',
    label: 'Currency',
    subtitle: 'INR (₹)',
    type: 'navigation',
    action: null,
  },
  {
    id: 'pref-payment-mode',
    label: 'Payment Mode',
    subtitle: 'Track cash vs online spending',
    type: 'toggle',
  },
  {
    id: 'pref-overspending-alerts',
    label: 'Overspending Alerts',
    subtitle: 'Warn me when nearing my budget',
    type: 'toggle',
  },
  {
    id: 'pref-logout',
    label: 'Log Out',
    subtitle: 'Sign out of your account',
    type: 'navigation',
    action: 'logout',
  },
];
