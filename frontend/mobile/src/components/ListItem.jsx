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
 *
 * `badges` renders an ordered list of small neutral chips, wrapping, on
 * their own line directly under `subtitle` (docs/ui/design-system.md
 * Section 7.4 — the transaction payment-mode badge, "CASH"/"ONLINE"/"BOTH";
 * Section 10.3 — the "SPLIT" tag, generalizing this from a single
 * `badgeText: string` prop to `badges: string[]` so more than one chip can
 * render on the same row at once, per docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §5). Purely additive: an
 * omitted or empty array renders nothing, so every existing call site
 * (notifications, contacts, groups, category caps) is unaffected.
 *
 * `titleTone` (optional, `'primary' | 'secondary'`, added docs/decisions/
 * 0012-notifications-system.md §7) — purely additive, defaults to
 * `'primary'` (the exact color every existing call site already renders,
 * `text.primary`), zero behavior change unless a caller explicitly opts in.
 * `'secondary'` renders the title in `text.secondary` instead — used by
 * NotificationsScreen to dim a read notification's message, the same
 * "read rows dim, unread rows stay full-strength" convention this app
 * doesn't have anywhere else yet but which needs a real slot to hook into
 * rather than a one-off inline Text duplicate of this component.
 */
function ListItem({
  leading,
  title,
  subtitle,
  badges,
  titleTone = 'primary',
  trailingText,
  trailingSubtext,
  trailingTone = 'neutral',
  trailing,
  onPress,
  style,
}) {
  const theme = useTheme();
  const styles = createStyles(theme, trailingTone, titleTone);

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
        {badges && badges.length > 0 ? (
          <View style={styles.badgeRow}>
            {badges.map((badge) => (
              <View key={badge} style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ))}
          </View>
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

function createStyles(theme, trailingTone, titleTone) {
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
      color: titleTone === 'secondary' ? theme.color.text.secondary : theme.color.text.primary,
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
    badgeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.space.xs,
      marginTop: theme.space.xs,
    },
    badge: {
      alignSelf: 'flex-start',
      borderRadius: theme.radius.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      paddingHorizontal: theme.space.sm,
      paddingVertical: theme.space.xs,
    },
    badgeText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
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
