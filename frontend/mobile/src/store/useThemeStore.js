import { create } from 'zustand';

/**
 * Zustand store holding the active theme mode.
 *
 * Per docs/ui/design-system.md Section 5: plain in-memory store, no disk
 * persistence in this phase — it naturally persists across screen
 * navigations within a session because the store instance lives for the
 * lifetime of the JS runtime, not the component tree.
 */
export const useThemeStore = create((set) => ({
  mode: 'dark',
  toggleTheme: () =>
    set((state) => ({ mode: state.mode === 'dark' ? 'light' : 'dark' })),
}));
