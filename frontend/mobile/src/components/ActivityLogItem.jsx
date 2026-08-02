import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
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
 * Not tappable — no `onPress` (ADR 0008 §4's explicit scope note). That is
 * now structural as well as scoped: the four `related_*` ids on a server
 * entry are navigation *hints* that may each be `null`, and one of them (the
 * contact id on an individual split) can legitimately point at a contact the
 * reader does not own (`backend/README.md` §17.2), so a tap could resolve to
 * nothing.
 *
 * ---
 * **FIELD NAMES ARE THE API'S — `activityDate`/`activityTime`.**
 *
 * This row renders one §11.1 `ActivityResponse` as the server sends it
 * (docs/api/api-overview.md §11.1), which `useActivitiesStore` holds verbatim
 * — nothing in this app renames a contract field (constitution §15/§30).
 * They were `date`/`time` while the feed was a local mock.
 *
 * Three properties of that shape this component depends on, all of them
 * normal rather than edge cases:
 *
 * - **`descriptionSuffix: ''` is not missing data.** It is empty on every
 *   entry whose `entityName` is `null`, and `descriptionPrefix` is then the
 *   complete sentence (`backend/README.md` §17.1 point 4). Both are rendered
 *   unconditionally, so an empty one simply contributes nothing.
 * - **`descriptionPrefix` can also be `''`** — on a "they paid you" entry the
 *   counterpart's name opens the sentence.
 * - **`tone` is a server string from an extensible union with no vocabulary
 *   check** (§17.8 flag 7). It is passed straight to `IconBadge`, which falls
 *   back to its own default for a value it does not know; nothing here
 *   switches exhaustively on it.
 *
 * `activityTime` is the **server's** clock in UTC, not the device's (§17.8
 * flag 3), so the rendered time is not localized to the reader's zone.
 * `createdAt` is the only field that could be, and converting it is a product
 * decision that has not been made.
 *
 * @param {object} props
 * @param {object} props.activity - one §11.1 `ActivityResponse`
 * @param {boolean} props.isLast - true for the final row in whatever list is being rendered
 * @param {(() => void) | null} [props.onPress] - optional; see the body note
 */
function ActivityLogItem({ activity, isLast, onPress = null }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  const row = (
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
          {getDateDisplayLabel(activity.activityDate)} • {getTimeLabel(activity.activityTime)}
        </Text>
      </View>
    </View>
  );

  // Tappable only when the caller supplies `onPress` — the Activities feed
  // does so for entries with a `relatedChangeLogId`, which open Change Detail
  // (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §6.6).
  // The `related_*` ids stay non-navigable for the reasons above.
  if (!onPress) {
    return row;
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {row}
    </Pressable>
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
