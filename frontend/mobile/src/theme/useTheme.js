import { useThemeStore } from '../store/useThemeStore';
import { darkTheme, lightTheme } from './tokens';

/**
 * Maps the active theme mode (from useThemeStore) to its token object.
 * Every themed component should call this instead of importing
 * darkTheme/lightTheme directly, so it always reflects the live toggle
 * state (docs/ui/design-system.md Section 5).
 */
export function useTheme() {
  const mode = useThemeStore((state) => state.mode);
  return mode === 'dark' ? darkTheme : lightTheme;
}
