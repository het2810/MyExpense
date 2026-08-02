import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { getDateDisplayLabel, getTimeLabel } from '../utils/dateDisplay';
import IconBadge from './IconBadge';

/**
 * Shared activity-log row — docs/decisions/0008-activity-log-system.md §4,
 * docs/ui/design-system.md §12.2. Used by both surfaces: Transaction
 * Detail's filtered ACTIVITY card and the global, unfiltered Activities
 * screen (constitution §25 — used from day one in two places, extraction is
 * justified).
 *
 * Deliberate deviation from this app's usual per-row Card list convention:
 * rows are NOT individually Card-wrapped with gaps between them — a
 * continuous connecting line cannot exist between separately-bordered,
 * gapped cards. This is a scoped, justified exception for a fundamentally
 * continuous "timeline" visual, not a new general-purpose list style.
 *
 * Connecting line: a plain View, no new library, no absolute positioning,
 * no measurement — the row is `flexDirection: 'row', alignItems: 'stretch'`
 * so `iconColumn`'s height matches `contentColumn`'s (taller, due to two
 * lines of text); the connector (`flex: 1`) fills that stretched height,
 * visually continuing down toward the next row's badge since rows stack
 * with no gap between them. `isLast` suppresses the trailing segment so the
 * line doesn't dangle past the final row.
 *
 * Not tappable in this round — no `onPress` (ADR 0008 §4's explicit,
 * flagged-as-future-follow-up scope note).
 *
 * @param {object} props
 * @param {object} props.activity - a useActivityLogStore entry
 * @param {boolean} props.isLast - true for the final row in whatever list is being rendered
 */
function ActivityLogItem({ activity, isLast }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={styles.row}>
      <View style={styles.iconColumn}>
        <IconBadge glyph={activity.glyph} tone={activity.tone} size="medium" />
        {!isLast ? <View style={styles.connectorLine} /> : null}
      </View>
      <View style={styles.contentColumn}>
        <Text style={styles.descriptionText}>
          {activity.descriptionPrefix}
          {activity.entityName ? (
            <Text style={styles.entityText}>{activity.entityName}</Text>
          ) : null}
          {activity.descriptionSuffix}
        </Text>
        <Text style={styles.timestampText}>
          {getDateDisplayLabel(activity.date)} • {getTimeLabel(activity.time)}
        </Text>
      </View>
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'stretch',
    },
    iconColumn: {
      alignItems: 'center',
      marginRight: theme.space.md,
    },
    connectorLine: {
      flex: 1,
      width: 2,
      marginTop: theme.space.xs,
      backgroundColor: theme.color.border.subtle,
      alignSelf: 'center',
    },
    contentColumn: {
      flex: 1,
      paddingBottom: theme.space.lg,
    },
    descriptionText: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    entityText: {
      color: theme.color.accent.text,
      fontWeight: '600',
    },
    timestampText: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.caption.lineHeight,
      marginTop: theme.space.xs,
    },
  });
}

export default ActivityLogItem;
