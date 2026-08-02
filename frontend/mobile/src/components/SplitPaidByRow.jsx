import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import Avatar from './Avatar';
import ListItem from './ListItem';
import { joinPayerLabels, labelDraftPayers } from '../utils/splitParticipants';
import { formatSplitAmount } from '../utils/currency';

/**
 * Adjust Split's "Paid by" row plus its inline payer list —
 * docs/decisions/0005-split-add-expense-flow.md §5 and
 * docs/decisions/0025-multiple-payers-per-split-expense.md §8.3.
 *
 * Moved out of AdjustSplitScreen.jsx (already about double constitution §26's
 * component guideline) when the row gained a second mode, so the screen keeps
 * only the split-method UI and this owns only "who paid".
 *
 * - **Single mode** (`paidById` set): `Paid by {name}`, unchanged.
 * - **Multi mode** (`payers` set, 2+): `Paid by {joined labels}` (§8.6) with a
 *   one-line `{label} ₹{amount} · …` subtitle in the same roster order, which
 *   may truncate.
 *
 * The pencil toggles the inline list: every participant (tap = single payer,
 * closes the list), then a final **"Multiple people"** row that hands off to
 * the Who Paid? modal through `onChooseMultiple`. Navigation stays with the
 * screen; this component only reports the choice.
 *
 * @param {{
 *   participants: object[],
 *   paidById: string | null,
 *   payers: Array<{ participantId: string, amount: number }> | null,
 *   onSelectPayer: (participant: object) => void,
 *   onChooseMultiple: () => void,
 * }} props
 */
function SplitPaidByRow({ participants, paidById, payers, onSelectPayer, onChooseMultiple }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [isListOpen, setIsListOpen] = useState(false);

  const labelledPayers = labelDraftPayers(payers, participants);
  const isMultiple = labelledPayers.length >= 2;

  const singlePayer =
    participants.find((participant) => participant.participantId === paidById) ??
    participants[0];
  const leadParticipant = isMultiple
    ? participants.find(
        (participant) => participant.participantId === labelledPayers[0].participantId,
      ) ?? participants[0]
    : singlePayer;

  if (!leadParticipant) {
    return null;
  }

  const title = isMultiple
    ? `Paid by ${joinPayerLabels(labelledPayers.map((payer) => payer.label))}`
    : `Paid by ${singlePayer.name}`;
  const subtitle = isMultiple
    ? labelledPayers
        .map((payer) => `${payer.label} ₹${formatSplitAmount(payer.amount)}`)
        .join(' · ')
    : undefined;

  function handleSelectPayer(participant) {
    setIsListOpen(false);
    onSelectPayer(participant);
  }

  function handleChooseMultiple() {
    setIsListOpen(false);
    onChooseMultiple();
  }

  return (
    <View style={styles.section}>
      <ListItem
        leading={<Avatar initials={leadParticipant.initials} size="small" />}
        title={title}
        subtitle={subtitle}
        trailing={
          <Pressable
            onPress={() => setIsListOpen((prev) => !prev)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Change who paid"
          >
            {/* Placeholder Text glyph standing in for Ionicons
                `create-outline` (design-system.md §6/§9) — same
                glyph-fallback convention as the rest of this codebase. */}
            <Text style={styles.pencilIcon}>✎</Text>
          </Pressable>
        }
      />
      {isListOpen ? (
        <View style={styles.inlineList}>
          {participants.map((participant) => (
            <ListItem
              key={participant.participantId}
              leading={<Avatar initials={participant.initials} size="small" />}
              title={participant.name}
              onPress={() => handleSelectPayer(participant)}
            />
          ))}
          <ListItem
            leading={<Avatar initials="+" size="small" />}
            title="Multiple people"
            onPress={handleChooseMultiple}
          />
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    section: {
      paddingHorizontal: theme.space.xl,
    },
    pencilIcon: {
      color: theme.color.text.primary,
      fontSize: 18,
    },
    inlineList: {
      marginTop: theme.space.sm,
      marginBottom: theme.space.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
      paddingBottom: theme.space.sm,
    },
  });
}

export default SplitPaidByRow;
