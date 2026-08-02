import React from 'react';
import { Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Horizontally-scrollable row of underlined text tabs — Adjust Split's
 * five-method tab strip (docs/decisions/0005-split-add-expense-flow.md
 * §5.2). Genuinely new interaction pattern, not a restyling of
 * `SegmentedControl` (a fixed-width, non-scrolling pill group) — nothing
 * existing fits a horizontally-scrollable underlined-tab row.
 *
 * Active tab: `text.primary`, bold, `accent.primary` 2px bottom border.
 * Inactive tab: `text.secondary`, no border.
 * See docs/decisions/0001-shared-component-library.md.
 *
 * @param {{ label: string, value: string }[]} tabs
 */
function TabStrip({ tabs, value, onChange, style }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={styles.container}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => onChange(tab.value)}
            style={[styles.tab, isActive && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
    },
    tab: {
      paddingVertical: theme.space.sm,
      marginRight: theme.space.xl,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive: {
      borderBottomColor: theme.color.accent.primary,
    },
    label: {
      color: theme.color.text.secondary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: '600',
    },
    labelActive: {
      color: theme.color.text.primary,
      fontWeight: '700',
    },
  });
}

export default TabStrip;
