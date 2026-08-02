import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

const SIZE_MAP = {
  small: 32,
  medium: 44,
  large: 72,
};

/**
 * Circular avatar — image source or initials fallback, size variants
 * (header-small / contact-list-medium / profile-large).
 * See docs/decisions/0001-shared-component-library.md.
 */
function Avatar({ source, initials = '', size = 'medium', onPress, style }) {
  const theme = useTheme();
  const dimension = SIZE_MAP[size] ?? SIZE_MAP.medium;
  const styles = createStyles(theme, dimension);

  const content = source ? (
    <Image source={source} style={styles.image} />
  ) : (
    <View style={styles.initialsWrapper}>
      <Text style={styles.initialsText}>{initials.slice(0, 2).toUpperCase()}</Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={style} hitSlop={8}>
        {content}
      </Pressable>
    );
  }

  return <View style={style}>{content}</View>;
}

function createStyles(theme, dimension) {
  return StyleSheet.create({
    image: {
      width: dimension,
      height: dimension,
      borderRadius: dimension / 2,
    },
    initialsWrapper: {
      width: dimension,
      height: dimension,
      borderRadius: dimension / 2,
      backgroundColor: theme.color.background.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
    },
    initialsText: {
      color: theme.color.accent.text,
      fontSize: dimension / 2.4,
      fontWeight: '700',
    },
  });
}

export default Avatar;
