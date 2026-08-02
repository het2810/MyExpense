import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Splash screen — logo mark + app name + tagline, shown for a fixed
 * duration on cold start before RootNavigator gates to AuthStack/MainTabs
 * (docs/architecture/frontend-navigation.md Section 2.1). No theme toggle
 * here per design-system.md Section 5 — always renders in dark theme since
 * useThemeStore defaults to 'dark' and nothing toggles it before login.
 *
 * [ASSUMPTION] No brand logo asset was supplied, so the mark is a simple
 * lettered glyph in a glowing circle echoing the cyan brand color, rather
 * than an image. Swap in a real logo asset here once the Project Owner
 * supplies one.
 */
function SplashScreen() {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      <View style={styles.logoGlow}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>M</Text>
        </View>
      </View>
      <Text style={styles.appName}>MyExpense</Text>
      <Text style={styles.tagline}>Smart Money, Simplified.</Text>
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
    logoCircle: {
      width: 88,
      height: 88,
      borderRadius: theme.radius.circle,
      backgroundColor: theme.color.accent.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoText: {
      color: theme.color.accent.onPrimary,
      fontSize: 40,
      fontWeight: '700',
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
  });
}

export default SplashScreen;
