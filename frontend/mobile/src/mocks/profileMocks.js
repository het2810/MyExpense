/**
 * MOCK DATA — locally defined placeholder data, not sourced from any API.
 *
 * **Identity is no longer mocked.** `profileUser`'s `name`, `email` and
 * `initials` were removed when Domain 2 was wired (docs/api/api-overview.md
 * §2.1): they are now real, reactive data from `GET /api/v1/users/me` with a
 * stored-session fallback, exposed by `src/hooks/useUserIdentity.js`. Every
 * self-identity surface (Profile, the Dashboard and Split header avatars, the
 * Split "you" participant) reads that hook. Do not reintroduce a static user
 * object here.
 *
 * What is still mock, and why, is noted per export below.
 */

export const profileUser = {
  // Mock UPI id — docs/decisions/0007-transaction-detail-screen.md §3.3.
  // Still mock: no API field backs a UPI handle (api-overview.md §2.1 carries
  // no payment-instrument data), so there is nothing to wire it to.
  // Deliberately an "@examplebank" handle rather than a real-looking UPI
  // suffix (@okhdfcbank/@paytm/@ybl), so it reads unambiguously as
  // placeholder data. Read by TransactionDetailScreen's premium Payment
  // Method card for 'online'/'both' payment modes.
  mockUpiId: 'jane.doe@examplebank',
};

// Still mock, deliberately: nothing backs Total Spent / Groups /
// Transactions until the Transactions and Splits domains exist — there is no
// aggregate endpoint in docs/api/api-overview.md §2 to read them from.
export const profileStats = [
  { id: 'stat-1', label: 'Total Spent', value: '₹27,650' },
  { id: 'stat-2', label: 'Groups', value: '3' },
  { id: 'stat-3', label: 'Transactions', value: '48' },
];

// `type` distinguishes navigation-style rows (tap → `action`, e.g. 'logout'
// → useAuthStore.logout()) from 'toggle' rows, which render a ToggleSwitch
// in the trailing slot instead and are bound in ProfileScreen to the
// server-backed settings in useSettingsStore, through useUserSettings (no
// `onPress`/`action`). "Budget Settings" (docs/decisions/
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
  // "Manage Categories" — Project Owner request, 2026-10-23. **This row
  // replaces the "Subcategories" `type: 'toggle'` row that shipped earlier the
  // same day** (docs/decisions/0019-subcategories-one-optional-level.md
  // §10.5): a lone switch here never showed what enabling subcategories
  // actually does, so the switch moved onto a screen that shows the category
  // list right underneath it (ManageCategoriesScreen.jsx), and this row became
  // the way in.
  //
  // Only the entry point changed. The setting is still the same
  // `subcategoriesEnabled` field on `GET`/`PATCH /users/me/settings`
  // (api-overview.md §2.3/§2.4), still held in useSettingsStore — no existing
  // user's preference is re-keyed or lost.
  //
  // Kept in the old row's exact position (directly after Overspending Alerts,
  // directly before Log Out) so it sits where the switch used to be. That does
  // leave one navigation row below the two toggles; "Log Out" already is one,
  // and the toggles stay grouped together. Moving it up beside "Budget
  // Settings" with the other management destinations is a one-line change here
  // if the Project Owner prefers that grouping.
  {
    id: 'pref-manage-categories',
    label: 'Manage Categories',
    subtitle: 'Categories, subcategories, and how they are shown',
    type: 'navigation',
    action: 'manage-categories',
  },
  {
    id: 'pref-logout',
    label: 'Log Out',
    subtitle: 'Sign out of your account',
    type: 'navigation',
    action: 'logout',
  },
];
