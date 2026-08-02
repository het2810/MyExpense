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
};

export const profileStats = [
  { id: 'stat-1', label: 'Total Spent', value: '₹27,650' },
  { id: 'stat-2', label: 'Groups', value: '3' },
  { id: 'stat-3', label: 'Transactions', value: '48' },
];

// `type` distinguishes navigation-style rows (tap → `action`, e.g. 'logout'
// → useAuthStore.logout()) from 'toggle' rows, which render a ToggleSwitch
// in the trailing slot instead and are bound directly to a Zustand store in
// ProfileScreen (no `onPress`/`action`). "Budget Settings" and
// "Notifications" are intentionally inert — those screens are out of scope
// for this phase (see docs/architecture/frontend-navigation.md); wiring
// navigation to them now would throw at runtime since no such routes are
// registered yet.
export const preferenceItems = [
  {
    id: 'pref-budget',
    label: 'Budget Settings',
    subtitle: 'Manage monthly limits',
    type: 'navigation',
    action: null,
  },
  {
    id: 'pref-notifications',
    label: 'Notifications',
    subtitle: 'Alerts & reminders',
    type: 'navigation',
    action: null,
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
