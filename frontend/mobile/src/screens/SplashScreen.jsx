import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import InlineMessage from '../components/InlineMessage';
import BrandLogo from '../components/BrandLogo';

/**
 * Splash screen — logo mark + app name + tagline, shown for a fixed
 * duration on cold start before RootNavigator gates to AuthStack/MainTabs
 * (docs/architecture/frontend-navigation.md Section 2.1). No theme toggle
 * here per design-system.md Section 5 — always renders in dark theme since
 * useThemeStore defaults to 'dark' and nothing toggles it before login.
 *
 * The mark is the Project Owner-supplied brand logo (BrandLogo).
 */
/**
 * `errorMessage`/`onRetry` are set only by RootNavigator's post-auth gate when
 * the active budget period could not be read: the splash stays up with a retry
 * rather than guessing a destination (a guess of "Budget Settings" was exactly
 * the reload bug).
 *
 * @param {{ errorMessage?: string | null, onRetry?: () => void }} props
 */
function SplashScreen({ errorMessage = null, onRetry } = {}) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      <View style={styles.logoGlow}>
        <BrandLogo size={120} />
      </View>
      <Text style={styles.appName}>MyExpense</Text>
      <Text style={styles.tagline}>Smart Money, Simplified.</Text>
      {errorMessage ? (
        <InlineMessage message={errorMessage} onRetry={onRetry} style={styles.error} />
      ) : null}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.background.base,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoGlow: {
      shadowColor: theme.color.overlay.glow,
      shadowOpacity: 1,
      shadowRadius: 32,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
      marginBottom: theme.space.xxl,
    },
    appName: {
      color: theme.color.text.primary,
      fontSize: theme.type.display.fontSize,
      lineHeight: theme.type.display.lineHeight,
      fontWeight: theme.type.display.fontWeight,
      marginBottom: theme.space.sm,
    },
    tagline: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    error: {
      marginTop: theme.space.xl,
      paddingHorizontal: theme.space.lg,
    },
  });
}

export default SplashScreen;
