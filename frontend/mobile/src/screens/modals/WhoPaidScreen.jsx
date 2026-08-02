import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import ScreenHeader from '../../components/ScreenHeader';
import HeaderCheckmark from '../../components/HeaderCheckmark';
import InlineNumberField from '../../components/InlineNumberField';
import Avatar from '../../components/Avatar';
import ListItem from '../../components/ListItem';
import { validatePayerAmounts, toPayerSelection } from '../../utils/splitCalculations';
import { formatSplitAmount } from '../../utils/currency';

// ADR 0025 §8.4's helper-line tones: neutral while under, positive when
// exact, negative when over.
const HELPER_TONE_STYLE = {
  under: 'helperTextUnder',
  exact: 'helperTextExact',
  over: 'helperTextOver',
};

/**
 * Who Paid? — root-level modal pushed from Adjust Split's "Multiple people"
 * row (docs/decisions/0025-multiple-payers-per-split-expense.md §8.4). Free
 * tier, no premium gate (§0).
 *
 * One `₹` amount input per participant, in roster order (you first),
 * prefilled from `currentPayers`; blank means 0. A live helper line shows how
 * much is assigned against the total. The checkmark is enabled only when
 * `validatePayerAmounts` says the amounts are well-formed, sum to the total to
 * the paise, and at least one is above 0 — all of that rule lives in
 * `utils/splitCalculations.js`, not here (constitution §8).
 *
 * Confirm drops blank/zero entries and returns to its caller via
 * `popTo(returnTo, { payersSelection }, { merge: true })`. Exactly one
 * remaining payer collapses to single-payer mode (`toPayerSelection`).
 *
 * **`returnTo`** (optional, default `'AdjustSplit'`): the route to pop back to.
 * Adjust Split's "Multiple people" row omits it; How Was This Split?'s "Paid by
 * multiple people" row passes `'SplitAddExpense'`. Both callers consume the
 * same `payersSelection` param — the same `returnTo` convention
 * CategoryPicker and NewGroup already use, rather than a second copy of this
 * screen.
 *
 * route.params: `{ totalAmount, participants, currentPayers, returnTo? }`.
 */
function WhoPaidScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme, insets);

  const totalAmount = route.params?.totalAmount ?? 0;
  const participants = useMemo(() => route.params?.participants ?? [], [route.params?.participants]);

  const [amountTextMap, setAmountTextMap] = useState(() => {
    const initial = {};
    (route.params?.currentPayers ?? []).forEach((payer) => {
      if (payer?.participantId && Number.isFinite(payer.amount) && payer.amount > 0) {
        initial[payer.participantId] = String(payer.amount);
      }
    });
    return initial;
  });

  const result = useMemo(
    () => validatePayerAmounts(participants, totalAmount, amountTextMap),
    [participants, totalAmount, amountTextMap],
  );

  function handleChangeAmount(participantId, value) {
    setAmountTextMap((prev) => ({ ...prev, [participantId]: value }));
  }

  function handleConfirm() {
    if (!result.isValid) {
      return;
    }
    // `{ merge: true }` so the destination keeps its own params (Adjust
    // Split's totalAmount/participants/currentSplitConfig, Split Add Expense's
    // initialSplitMode) — the same reason every other popTo in this flow
    // passes it (see AdjustSplitScreen's handleConfirm note).
    navigation.popTo(
      route.params?.returnTo ?? 'AdjustSplit',
      { payersSelection: toPayerSelection(result.payers) },
      { merge: true },
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Who paid?"
        onBack={() => navigation.goBack()}
        rightSlot={<HeaderCheckmark onPress={handleConfirm} disabled={!result.isValid} />}
      />

      <View style={styles.copyBlock}>
        <Text style={styles.subtext}>Enter how much each person paid.</Text>
      </View>

      <ScrollView contentContainerStyle={styles.listContainer}>
        {participants.map((participant) => (
          <ListItem
            key={participant.participantId}
            leading={<Avatar initials={participant.initials} size="small" />}
            title={participant.name}
            trailing={
              <InlineNumberField
                prefix="₹"
                value={amountTextMap[participant.participantId] ?? ''}
                onChangeText={(value) => handleChangeAmount(participant.participantId, value)}
                placeholder="0.00"
              />
            }
          />
        ))}
      </ScrollView>

      <View style={styles.bottomBar}>
        <Text style={[styles.helperText, styles[HELPER_TONE_STYLE[result.status]]]}>
          {getAssignedHelperText(result, totalAmount)}
        </Text>
        {result.hasInvalidEntry ? (
          <Text style={styles.invalidText}>
            Enter amounts as numbers with at most 2 decimal places.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The live helper line — ADR 0025 §8.4's three states, exact copy.
 *
 * @param {{ status: 'under' | 'exact' | 'over', assignedAmount: number,
 *   remainingAmount: number }} result From `validatePayerAmounts`.
 * @param {number} totalAmount
 * @returns {string}
 */
function getAssignedHelperText(result, totalAmount) {
  const total = formatSplitAmount(totalAmount);
  const assigned = formatSplitAmount(result.assignedAmount);
  if (result.status === 'exact') {
    return `₹${total} of ₹${total} assigned`;
  }
  const difference = formatSplitAmount(Math.abs(result.remainingAmount));
  const suffix = result.status === 'under' ? 'left' : 'over';
  return `₹${assigned} of ₹${total} assigned · ₹${difference} ${suffix}`;
}

function createStyles(theme, insets) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    copyBlock: {
      alignItems: 'center',
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.lg,
      paddingBottom: theme.space.md,
    },
    subtext: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
    },
    listContainer: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingBottom: theme.space.lg,
    },
    // Last thing above the bottom system bar, so its bottom padding is
    // measured from the top of that bar — same as Adjust Split's bottom bars.
    bottomBar: {
      alignItems: 'center',
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      paddingBottom: theme.space.md + insets.bottom,
      borderTopWidth: 1,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.background.surface,
    },
    helperText: {
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
      textAlign: 'center',
    },
    helperTextUnder: {
      color: theme.color.text.primary,
    },
    helperTextExact: {
      color: theme.color.status.positive,
    },
    helperTextOver: {
      color: theme.color.status.negative,
    },
    invalidText: {
      color: theme.color.status.negative,
      fontSize: theme.type.caption.fontSize,
      textAlign: 'center',
      marginTop: theme.space.xs,
    },
  });
}

export default WhoPaidScreen;
