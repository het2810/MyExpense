import { DefaultTheme, DarkTheme } from '@react-navigation/native';

/**
 * Maps our design tokens (src/theme/tokens.js) to React Navigation's theme
 * shape, so native headers/tab bars for any screen (including stub
 * PlaceholderScreens using the default header) stay visually consistent
 * with the active app theme instead of React Navigation's own defaults.
 */
export function getNavigationTheme(theme) {
  const base = theme.mode === 'dark' ? DarkTheme : DefaultTheme;

  return {
    ...base,
    dark: theme.mode === 'dark',
    colors: {
      ...base.colors,
      primary: theme.color.accent.primary,
      background: theme.color.background.base,
      card: theme.color.background.surface,
      text: theme.color.text.primary,
      border: theme.color.border.subtle,
      notification: theme.color.status.negative,
    },
  };
}
