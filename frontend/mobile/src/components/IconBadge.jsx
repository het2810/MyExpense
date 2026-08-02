import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

const SIZE_MAP = {
  small: 32,
  medium: 40,
  large: 48,
};

/**
 * Colored circular container around a small icon/glyph — category icons,
 * notification-type icons, tab icons. `tone` maps to status.* tokens for
 * the background tint (falls back to accent for neutral).
 * See docs/decisions/0001-shared-component-library.md.
 */
function IconBadge({ glyph, tone = 'neutral', size = 'medium', style }) {
  const theme = useTheme();
  const dimension = SIZE_MAP[size] ?? SIZE_MAP.medium;
  const styles = createStyles(theme, dimension, tone);

  return (
    <View style={[styles.badge, style]}>
      <Text style={styles.glyph}>{glyph}</Text>
    </View>
  );
}

function resolveTone(theme, tone) {
  switch (tone) {
    case 'warning':
      return theme.color.status.warning;
    case 'success':
      return theme.color.status.success;
    case 'negative':
      return theme.color.status.negative;
    case 'positive':
      return theme.color.status.positive;
    case 'accent':
      return theme.color.accent.primary;
    case 'neutral':
      return theme.color.text.tertiary;
    default:
      return theme.color.accent.primary;
  }
}

function createStyles(theme, dimension, tone) {
  const tint = resolveTone(theme, tone);

  return StyleSheet.create({
    badge: {
      width: dimension,
      height: dimension,
      borderRadius: dimension / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${tint}26`, // ~15% opacity tint of the tone color
    },
    glyph: {
      color: tint,
      fontSize: dimension / 2.2,
      fontWeight: '700',
    },
  });
}

export default IconBadge;
