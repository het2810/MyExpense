import { create } from 'zustand';

/**
 * Zustand store holding user-configurable app preferences that aren't theme
 * or auth related (Dashboard overspending alerts, Payment Mode tracking).
 * Plain in-memory store, no disk persistence in this phase — same pattern as
 * useThemeStore.
 */
export const useSettingsStore = create((set) => ({
  overspendingAlertsEnabled: true,
  toggleOverspendingAlerts: () =>
    set((state) => ({ overspendingAlertsEnabled: !state.overspendingAlertsEnabled })),

  // Opt-in cash-vs-online spend tracking (docs/decisions/0003-payment-mode-and-date-tracking.md
  // Section 1). Defaults to off, unlike Overspending Alerts — this is a
  // net-new tracking concept the user should consciously enable, not a
  // safety-net default-on preference.
  paymentModeEnabled: false,
  togglePaymentMode: () => set((state) => ({ paymentModeEnabled: !state.paymentModeEnabled })),
}));
