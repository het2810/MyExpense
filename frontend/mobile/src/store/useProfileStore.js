import { create } from 'zustand';

/**
 * Zustand store holding the user's premium/free entitlement flag —
 * docs/decisions/0007-transaction-detail-screen.md §3.1.
 *
 * A deliberately separate store from useSettingsStore: useSettingsStore
 * holds behavioral toggles the user consciously turns on/off
 * (overspendingAlertsEnabled, paymentModeEnabled) — "how the app behaves for
 * me." `isPremiumUser` is a different kind of fact — "what tier of account
 * do I have," an identity/entitlement concept, not a preference. Folding it
 * into useSettingsStore would be a conceptual mismatch even though it would
 * work mechanically.
 *
 * Mirrors useThemeStore's exact shape precedent — one piece of
 * identity-adjacent state, one toggle action, in-memory only, no `persist`
 * middleware (consistent with every other store at this phase). Wired to
 * ProfileScreen.jsx's "Upgrade to Premium" banner (tap to toggle) and gates
 * TransactionDetailScreen.jsx's Payment Method card (ADR 0007 §3.4).
 *
 * This is explicitly a local, mock, tap-to-toggle testing affordance — no
 * real premium purchase/billing flow is designed or implied here (ADR 0007
 * "Out of scope / deferred").
 */
export const useProfileStore = create((set) => ({
  isPremiumUser: false,
  toggleIsPremiumUser: () => set((state) => ({ isPremiumUser: !state.isPremiumUser })),
}));
