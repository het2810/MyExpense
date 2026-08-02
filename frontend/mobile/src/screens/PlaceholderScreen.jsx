import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * STUB SCREEN — used only so root-level modal routes (AddExpense, NewGroup,
 * CategoryPicker) exist and the navigator compiles/is reachable, per this
 * phase's scope discipline (docs/architecture/frontend-navigation.md lists
 * their full UI as future work). Do not add real form UI here — build a
 * dedicated screen file when that screen is actually scoped for
 * implementation.
 */
function PlaceholderScreen({ route }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const title = route?.name ?? 'Coming soon';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>This screen isn't built yet — coming in a future iteration.</Text>
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
      padding: theme.space.xxl,
    },
    title: {
      color: theme.color.text.primary,
      fontSize: theme.type.h1.fontSize,
      fontWeight: theme.type.h1.fontWeight,
      marginBottom: theme.space.sm,
    },
    body: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      textAlign: 'center',
    },
  });
}

export default PlaceholderScreen;
