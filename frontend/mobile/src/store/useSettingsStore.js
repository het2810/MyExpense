import { create } from 'zustand';

/**
 * Zustand store holding user-configurable app preferences that aren't theme
 * or auth related (currently just Dashboard overspending alerts). Plain
 * in-memory store, no disk persistence in this phase — same pattern as
 * useThemeStore.
 */
export const useSettingsStore = create((set) => ({
  overspendingAlertsEnabled: true,
  toggleOverspendingAlerts: () =>
    set((state) => ({ overspendingAlertsEnabled: !state.overspendingAlertsEnabled })),
}));
