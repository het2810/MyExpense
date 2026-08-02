import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { allocateByWeights } from '../../utils/currency';
import Card from '../../components/Card';
import ScreenHeader from '../../components/ScreenHeader';
import Avatar from '../../components/Avatar';

/**
 * How Was This Expense Split? — root-level modal, pushed on top of Split
 * Add Expense (docs/decisions/0005-split-add-expense-flow.md §4,
 * docs/ui/design-system.md §9.3).
 *
 * Every row is a complete, atomic, single-tap selection — tapping one
 * immediately applies it and returns to Split Add Expense via
 * `navigation.popTo('SplitAddExpense', { splitConfig })`, matching the
 * existing popTo/tap-to-select-and-return precedent already used for
 * CategoryPicker and this screen's own in-place lists. No header checkmark
 * (§4's explicit "one concept, one control" reasoning).
 *
 * route.params: `{ totalAmount, participants, currentSplitConfig }`, all
 * passed by SplitAddExpenseScreen's split-summary chip.
 */
function HowWasThisSplitScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme);

  const { totalAmount, participants, currentSplitConfig } = route.params ?? {};

  function handleSelectPreset(config) {
    navigation.popTo('SplitAddExpense', { splitConfig: config });
  }

  function handleOpenAdjustSplit() {
    navigation.navigate('AdjustSplit', { totalAmount, participants, currentSplitConfig });
  }

  const isTwoParticipant = participants && participants.length === 2;

  return (
    <View style={styles.flex}>
      <ScreenHeader title="How Was This Expense Split?" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.container}>
        {isTwoParticipant
          ? buildTwoParticipantPresets(totalAmount, participants[0], participants[1]).map(
              (preset) => (
                <PresetRow
                  key={preset.key}
                  preset={preset}
                  leadingParticipants={[participants[0], participants[1]]}
                  isSelected={isPresetSelected(preset.config, currentSplitConfig)}
                  onPress={() => handleSelectPreset(preset.config)}
                />
              ),
            )
          : participants && participants.length > 2
            ? (() => {
                const preset = buildGroupPreset(totalAmount, participants);
                return (
                  <PresetRow
                    preset={preset}
                    leadingParticipants={[participants[0], participants[1]]}
                    isSelected={isPresetSelected(preset.config, currentSplitConfig)}
                    onPress={() => handleSelectPreset(preset.config)}
                  />
                );
              })()
            : null}

        <Pressable
          style={styles.moreOptionsButton}
          onPress={handleOpenAdjustSplit}
          accessibilityRole="button"
        >
          <Text style={styles.moreOptionsText}>More options</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// Rounds to whole paise before formatting, so no stray floating-point
// artifact (e.g. 249.99999999998) ever reaches the display string.
function formatAmount(value) {
  return (Math.round(value * 100) / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });
}

// Exactly 2 participants — ADR 0005 §4.1's four fixed presets, computed
// live from totalAmount and the other participant. `equalAmounts` uses the
// §5.3 paise-exact allocation rule for N=2; `equalAmounts[0]`/`[1]` are
// used as each participant's own stored amount (they can differ by at most
// one paisa from each other for an odd totalAmount — the same
// display-vs-storage divergence §5.3 already sanctions for the Equally
// tab), while the single `equalShare` figure (`equalAmounts[0]`) is reused
// for both rows' display copy for readability.
function buildTwoParticipantPresets(totalAmount, self, other) {
  const equalAmounts = allocateByWeights(totalAmount, [1, 1]);
  const equalShare = equalAmounts[0];

  return [
    {
      key: 'you-paid-equally',
      title: 'You paid, split equally.',
      amountLine: `${other.name} owes you ₹${formatAmount(equalShare)}`,
      amountTone: 'positive',
      config: {
        method: 'equally',
        paidById: 'self',
        participantAmounts: [
          { participantId: 'self', name: self.name, amount: equalAmounts[0] },
          { participantId: other.participantId, name: other.name, amount: equalAmounts[1] },
        ],
      },
    },
    {
      key: 'you-owed-full',
      title: 'You are owed the full amount.',
      amountLine: `${other.name} owes you ₹${formatAmount(totalAmount)}`,
      amountTone: 'positive',
      config: {
        method: 'unequally',
        paidById: 'self',
        participantAmounts: [
          { participantId: 'self', name: self.name, amount: 0 },
          { participantId: other.participantId, name: other.name, amount: totalAmount },
        ],
      },
    },
    {
      key: 'other-paid-equally',
      title: `${other.name} paid, split equally.`,
      amountLine: `You owe ${other.name} ₹${formatAmount(equalShare)}`,
      amountTone: 'negative',
      config: {
        method: 'equally',
        paidById: other.participantId,
        participantAmounts: [
          { participantId: 'self', name: self.name, amount: equalAmounts[0] },
          { participantId: other.participantId, name: other.name, amount: equalAmounts[1] },
        ],
      },
    },
    {
      key: 'other-owed-full',
      title: `${other.name} is owed the full amount.`,
      amountLine: `You owe ${other.name} ₹${formatAmount(totalAmount)}`,
      amountTone: 'negative',
      config: {
        method: 'unequally',
        paidById: other.participantId,
        participantAmounts: [
          { participantId: 'self', name: self.name, amount: totalAmount },
          { participantId: other.participantId, name: other.name, amount: 0 },
        ],
      },
    },
  ];
}

// 3+ participants (Group mode only) — ADR 0005 §4.2's single generalizable
// preset: equal split among everyone, including you.
function buildGroupPreset(totalAmount, participants) {
  const amounts = allocateByWeights(
    totalAmount,
    participants.map(() => 1),
  );
  const equalShare = amounts[0];

  return {
    key: 'everyone-equally',
    title: 'You paid, split equally.',
    amountLine: `Each person owes you ₹${formatAmount(equalShare)}`,
    amountTone: 'positive',
    config: {
      method: 'equally',
      paidById: 'self',
      participantAmounts: participants.map((participant, index) => ({
        participantId: participant.participantId,
        name: participant.name,
        amount: amounts[index],
      })),
    },
  };
}

// A preset row is "selected" iff its method + paidById match the current
// splitConfig exactly — ADR 0005 §4.1: these two fields alone uniquely
// identify one of the four rows, no need to also compare amounts.
function isPresetSelected(presetConfig, currentSplitConfig) {
  if (!currentSplitConfig) {
    return false;
  }
  return (
    presetConfig.method === currentSplitConfig.method &&
    presetConfig.paidById === currentSplitConfig.paidById
  );
}

function PresetRow({ preset, leadingParticipants, isSelected, onPress }) {
  const theme = useTheme();
  const styles = createRowStyles(theme, preset.amountTone);

  return (
    <Card style={styles.card}>
      <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
        <View style={styles.avatars}>
          <Avatar
            initials={leadingParticipants[0].initials}
            size="small"
            style={styles.avatarFirst}
          />
          <Avatar
            initials={leadingParticipants[1].initials}
            size="small"
            style={styles.avatarSecond}
          />
        </View>
        <View style={styles.textColumn}>
          <Text style={styles.title}>{preset.title}</Text>
          <Text style={styles.amountLine}>{preset.amountLine}</Text>
        </View>
        <View style={styles.checkmarkSlot}>
          {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
      </Pressable>
    </Card>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.xxl,
    },
    moreOptionsButton: {
      alignSelf: 'center',
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.space.sm,
      paddingHorizontal: theme.space.xxl,
      marginTop: theme.space.md,
    },
    moreOptionsText: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
  });
}

function createRowStyles(theme, amountTone) {
  return StyleSheet.create({
    card: {
      marginBottom: theme.space.md,
      padding: theme.space.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    avatars: {
      flexDirection: 'row',
      marginRight: theme.space.lg,
    },
    avatarFirst: {
      zIndex: 1,
    },
    avatarSecond: {
      marginLeft: -14,
      borderWidth: 2,
      borderColor: theme.color.background.surface,
      borderRadius: theme.radius.circle,
    },
    textColumn: {
      flex: 1,
    },
    title: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
      marginBottom: 2,
    },
    amountLine: {
      color: amountTone === 'positive' ? theme.color.status.positive : theme.color.status.negative,
      fontSize: theme.type.body.fontSize,
    },
    checkmarkSlot: {
      width: 24,
      alignItems: 'flex-end',
    },
    checkmark: {
      color: theme.color.accent.primary,
      fontSize: 20,
      fontWeight: '700',
    },
  });
}

export default HowWasThisSplitScreen;
