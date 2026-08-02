import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Pill toggle group with N options — Personal/Group, Automatic/Custom,
 * All/Unread/Alerts, etc. One reusable control rather than ad-hoc toggles
 * per screen. See docs/decisions/0001-shared-component-library.md.
 *
 * @param {{ label: string, value: string }[]} options
 */
function SegmentedControl({ options, value, onChange, style }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={[styles.track, style]}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, isActive && styles.segmentActive]}
          >
            <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    track: {
      flexDirection: 'row',
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.pill,
      padding: 4,
    },
    segment: {
      flex: 1,
      paddingVertical: theme.space.sm,
      borderRadius: theme.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentActive: {
      backgroundColor: theme.color.accent.primary,
    },
    label: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
    labelActive: {
      color: theme.color.accent.onPrimary,
    },
  });
}

export default SegmentedControl;
