import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Leading icon/avatar + title/subtitle + optional trailing value row.
 * Highest-reuse component in the app (transactions, notifications, category
 * caps, group members, contacts). Trailing amount can be tinted
 * positive/negative/neutral. See docs/decisions/0001-shared-component-library.md.
 *
 * `trailing` renders an arbitrary node (e.g. a ToggleSwitch) in the trailing
 * slot instead of text, for rows like preference toggles. It takes priority
 * over `trailingText`/`trailingSubtext` when provided.
 */
function ListItem({
  leading,
  title,
  subtitle,
  trailingText,
  trailingSubtext,
  trailingTone = 'neutral',
  trailing,
  onPress,
  style,
}) {
  const theme = useTheme();
  const styles = createStyles(theme, trailingTone);

  const content = (
    <View style={[styles.row, style]}>
      {leading ? <View style={styles.leadingSlot}>{leading}</View> : null}
      <View style={styles.textSlot}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <View style={styles.trailingSlot}>{trailing}</View>
      ) : trailingText ? (
        <View style={styles.trailingSlot}>
          <Text style={styles.trailingText} numberOfLines={1}>
            {trailingText}
          </Text>
          {trailingSubtext ? (
            <Text style={styles.trailingSubtext} numberOfLines={1}>
              {trailingSubtext}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
        {content}
      </Pressable>
    );
  }

  return content;
}

function resolveTrailingColor(theme, tone) {
  switch (tone) {
    case 'positive':
      return theme.color.status.positive;
    case 'negative':
      return theme.color.status.negative;
    default:
      return theme.color.text.primary;
  }
}

function createStyles(theme, trailingTone) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.space.sm,
    },
    pressed: {
      opacity: 0.7,
    },
    leadingSlot: {
      marginRight: theme.space.md,
    },
    textSlot: {
      flex: 1,
      marginRight: theme.space.sm,
    },
    title: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      lineHeight: theme.type.bodyLg.lineHeight,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    subtitle: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginTop: 2,
    },
    trailingSlot: {
      alignItems: 'flex-end',
    },
    trailingText: {
      color: resolveTrailingColor(theme, trailingTone),
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: '600',
    },
    trailingSubtext: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      marginTop: 2,
    },
  });
}

export default ListItem;
