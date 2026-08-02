import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import ScreenHeader from '../../components/ScreenHeader';
import HeaderCheckmark from '../../components/HeaderCheckmark';
import InlineNumberField from '../../components/InlineNumberField';
import SplitPaidByRow from '../../components/SplitPaidByRow';
import Avatar from '../../components/Avatar';
import ListItem from '../../components/ListItem';
import Checkbox from '../../components/Checkbox';
import TabStrip from '../../components/TabStrip';
import {
  calculateEquallySplit,
  calculateUnequallySplit,
  calculatePercentageSplit,
  calculateSharesSplit,
  calculateAdjustmentSplit,
} from '../../utils/splitCalculations';
import { formatSplitAmount as formatAmount } from '../../utils/currency';

const TAB_OPTIONS = [
  { label: 'Equally', value: 'equally' },
  { label: 'Unequally', value: 'unequally' },
  { label: 'By percentages', value: 'percentage' },
  { label: 'By shares', value: 'shares' },
  { label: 'By adjustment', value: 'adjustment' },
];

const TAB_VALUES = TAB_OPTIONS.map((tab) => tab.value);

// docs/ui/design-system.md §9.4 — copy taken directly from the reference,
// with the By Adjustment subtext's one deliberate edit (app-neutral wording
// that never names the reference app this flow was modeled on).
const TAB_COPY = {
  equally: { heading: 'Split equally', subtext: 'Select which people owe an equal share.' },
  unequally: {
    heading: 'Split by exact amounts',
    subtext: 'Specify exactly how much each person owes.',
  },
  percentage: {
    heading: 'Split by percentages',
    subtext: "Enter the percentage split that's fair for your situation.",
  },
  shares: {
    heading: 'Split by shares',
    subtext:
      'Great for time-based splitting (2 nights → 2 shares) and splitting across families (family of 3 → 3 shares).',
  },
  adjustment: {
    heading: 'Split by adjustment',
    subtext: "Enter adjustments to reflect who owes extra; the remainder will be distributed equally.",
  },
};

/**
 * Adjust Split — root-level modal, pushed on top of "How Was This Expense
 * Split?" (docs/decisions/0005-split-add-expense-flow.md §5,
 * docs/ui/design-system.md §9.4). Five split methods, each with its own
 * validation/computation (src/utils/splitCalculations.js) — this component
 * owns only tab/field UI state and wires the active tab's result to the
 * header checkmark's confirm action.
 *
 * Confirming returns DIRECTLY to Split Add Expense (skipping back over "How
 * Was This Expense Split?"), via the same popTo/splitConfig shape that
 * screen's own preset rows already use (§5.9) — one code path on the
 * receiving end handles both return paths.
 *
 * route.params: `{ totalAmount, participants, currentSplitConfig }`, plus
 * `payersSelection` on return from Who Paid? (consumed and cleared).
 *
 * "Paid by" (docs/decisions/0025-multiple-payers-per-split-expense.md §8.3)
 * holds `{ paidById, payers }` with exactly one set: a single payer, or 2+
 * payers with per-person amounts chosen on the Who Paid? modal. The row and
 * its inline list live in `components/SplitPaidByRow.jsx`.
 */
function AdjustSplitScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme, insets);

  const totalAmount = route.params?.totalAmount ?? 0;
  const participants = route.params?.participants ?? [];
  const currentSplitConfig = route.params?.currentSplitConfig ?? null;

  const [activeTab, setActiveTab] = useState(
    currentSplitConfig && TAB_VALUES.includes(currentSplitConfig.method)
      ? currentSplitConfig.method
      : 'equally',
  );
  // Payer state — exactly one of paidById / payers is set (ADR 0025 §8.1). A
  // config with no `payers` key (every pre-ADR-0025 producer) is single mode.
  const initialPayers =
    Array.isArray(currentSplitConfig?.payers) && currentSplitConfig.payers.length >= 2
      ? currentSplitConfig.payers
      : null;
  const [payerState, setPayerState] = useState({
    paidById: initialPayers ? null : currentSplitConfig?.paidById ?? 'self',
    payers: initialPayers,
  });
  const payersSelection = route.params?.payersSelection;

  const [checkedMap, setCheckedMap] = useState({});
  const [amountTextMap, setAmountTextMap] = useState({});
  const [percentTextMap, setPercentTextMap] = useState({});
  const [shareTextMap, setShareTextMap] = useState({});
  const [adjustmentTextMap, setAdjustmentTextMap] = useState({});

  // Consumes the result of Who Paid? (navigation.popTo('AdjustSplit',
  // { payersSelection })) and clears it — the same consume-and-clear pattern
  // SplitAddExpenseScreen uses for `selectedCategory` (ADR 0025 §8.3).
  useEffect(() => {
    if (payersSelection) {
      setPayerState({
        paidById: payersSelection.paidById ?? null,
        payers: payersSelection.payers ?? null,
      });
      navigation.setParams({ payersSelection: undefined });
    }
  }, [payersSelection, navigation]);

  const activeResult = useMemo(() => {
    switch (activeTab) {
      case 'equally':
        return calculateEquallySplit(participants, totalAmount, checkedMap);
      case 'unequally':
        return calculateUnequallySplit(participants, totalAmount, amountTextMap);
      case 'percentage':
        return calculatePercentageSplit(participants, totalAmount, percentTextMap);
      case 'shares':
        return calculateSharesSplit(participants, totalAmount, shareTextMap);
      case 'adjustment':
        return calculateAdjustmentSplit(participants, totalAmount, adjustmentTextMap);
      default:
        return { isValid: false, participantAmounts: [] };
    }
  }, [
    activeTab,
    participants,
    totalAmount,
    checkedMap,
    amountTextMap,
    percentTextMap,
    shareTextMap,
    adjustmentTextMap,
  ]);

  function toggleChecked(participantId) {
    setCheckedMap((prev) => {
      const currentlyChecked = prev[participantId] !== false;
      return { ...prev, [participantId]: !currentlyChecked };
    });
  }

  function toggleAllChecked() {
    const allChecked = participants.every(
      (participant) => checkedMap[participant.participantId] !== false,
    );
    const next = {};
    participants.forEach((participant) => {
      next[participant.participantId] = !allChecked;
    });
    setCheckedMap(next);
  }

  function updateTextMap(setter, participantId, value) {
    setter((prev) => ({ ...prev, [participantId]: value }));
  }

  function handleSelectPayer(participant) {
    setPayerState({ paidById: participant.participantId, payers: null });
  }

  // "Multiple people" — ADR 0025 §8.3. Coming from single mode the current
  // payer is prefilled with the whole amount, so the user only redistributes.
  function handleChooseMultiplePayers() {
    navigation.navigate('WhoPaid', {
      totalAmount,
      participants,
      currentPayers:
        payerState.payers ?? [{ participantId: payerState.paidById, amount: totalAmount }],
    });
  }

  function handleConfirm() {
    if (!activeResult.isValid) {
      return;
    }
    // `{ merge: true }` for the reason CategoryPickerScreen's own `popTo` note
    // documents in full: without it the router takes `createParamsFromAction`,
    // which **replaces** the destination's params instead of layering onto them
    // (@react-navigation/routers' StackRouter, the `POP_TO` case). Split Add
    // Expense's own params are all consumed at mount or cleared by their
    // effects, so nothing is visibly lost today — this closes the same trap
    // that silently reverted Add Expense's edit mode to create mode, before a
    // future param on that screen walks into it.
    navigation.popTo(
      'SplitAddExpense',
      {
        splitConfig: {
          method: activeTab,
          paidById: payerState.paidById,
          payers: payerState.payers,
          participantAmounts: activeResult.participantAmounts,
        },
      },
      { merge: true },
    );
  }

  const tabCopy = TAB_COPY[activeTab];
  const allChecked =
    participants.length > 0 &&
    participants.every((participant) => checkedMap[participant.participantId] !== false);

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Adjust Split"
        onBack={() => navigation.goBack()}
        rightSlot={<HeaderCheckmark onPress={handleConfirm} />}
      />

      <SplitPaidByRow
        participants={participants}
        paidById={payerState.paidById}
        payers={payerState.payers}
        onSelectPayer={handleSelectPayer}
        onChooseMultiple={handleChooseMultiplePayers}
      />

      <TabStrip
        tabs={TAB_OPTIONS}
        value={activeTab}
        onChange={setActiveTab}
        style={styles.tabStrip}
      />

      <View style={styles.copyBlock}>
        <Text style={styles.heading}>{tabCopy.heading}</Text>
        <Text style={styles.subtext}>{tabCopy.subtext}</Text>
        {activeTab === 'adjustment' && activeResult.errorMessage ? (
          <Text style={styles.blockMessage}>{activeResult.errorMessage}</Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.listContainer}>
        {activeTab === 'equally'
          ? participants.map((participant) => (
              <ListItem
                key={participant.participantId}
                leading={<Avatar initials={participant.initials} size="small" />}
                title={participant.name}
                onPress={() => toggleChecked(participant.participantId)}
                trailing={
                  <Checkbox checked={checkedMap[participant.participantId] !== false} />
                }
              />
            ))
          : null}

        {activeTab === 'unequally'
          ? participants.map((participant) => (
              <ListItem
                key={participant.participantId}
                leading={<Avatar initials={participant.initials} size="small" />}
                title={participant.name}
                trailing={
                  <InlineNumberField
                    prefix="₹"
                    value={amountTextMap[participant.participantId] ?? ''}
                    onChangeText={(value) =>
                      updateTextMap(setAmountTextMap, participant.participantId, value)
                    }
                    placeholder="0.00"
                  />
                }
              />
            ))
          : null}

        {activeTab === 'percentage'
          ? participants.map((participant, index) => (
              <ListItem
                key={participant.participantId}
                leading={<Avatar initials={participant.initials} size="small" />}
                title={participant.name}
                subtitle={`₹${formatAmount(activeResult.displayAmounts?.[index] ?? 0)}`}
                trailing={
                  <InlineNumberField
                    suffix="%"
                    value={percentTextMap[participant.participantId] ?? ''}
                    onChangeText={(value) =>
                      updateTextMap(setPercentTextMap, participant.participantId, value)
                    }
                    placeholder="0"
                  />
                }
              />
            ))
          : null}

        {activeTab === 'shares'
          ? participants.map((participant, index) => (
              <ListItem
                key={participant.participantId}
                leading={<Avatar initials={participant.initials} size="small" />}
                title={participant.name}
                subtitle={`₹${formatAmount(activeResult.participantAmounts?.[index]?.amount ?? 0)}`}
                trailing={
                  <InlineNumberField
                    suffix="shares"
                    keyboardType="number-pad"
                    value={shareTextMap[participant.participantId] ?? ''}
                    onChangeText={(value) =>
                      updateTextMap(setShareTextMap, participant.participantId, value)
                    }
                    placeholder="0"
                  />
                }
              />
            ))
          : null}

        {activeTab === 'adjustment'
          ? participants.map((participant, index) => (
              <ListItem
                key={participant.participantId}
                leading={<Avatar initials={participant.initials} size="small" />}
                title={participant.name}
                subtitle={`₹${formatAmount(activeResult.participantAmounts?.[index]?.amount ?? 0)}`}
                trailing={
                  <InlineNumberField
                    prefix="+"
                    value={adjustmentTextMap[participant.participantId] ?? ''}
                    onChangeText={(value) =>
                      updateTextMap(setAdjustmentTextMap, participant.participantId, value)
                    }
                    placeholder="0"
                  />
                }
              />
            ))
          : null}
      </ScrollView>

      {activeTab === 'equally' ? (
        <View style={styles.bottomBar}>
          <Text
            style={[
              styles.bottomBarText,
              activeResult.checkedCount === 0 && styles.bottomBarTextNegative,
            ]}
          >
            {activeResult.checkedCount === 0
              ? activeResult.errorMessage
              : `₹${formatAmount(activeResult.perPersonAmount)}/person (${activeResult.checkedCount} people)`}
          </Text>
          <Pressable
            style={styles.allToggle}
            onPress={toggleAllChecked}
            accessibilityRole="button"
          >
            <Text style={styles.allLabel}>All</Text>
            <Checkbox checked={allChecked} />
          </Pressable>
        </View>
      ) : null}

      {activeTab === 'unequally' ? (
        <View style={styles.bottomBarColumn}>
          <Text style={styles.bottomBarText}>
            ₹{formatAmount(activeResult.sumEntered)} of ₹{formatAmount(totalAmount)}
          </Text>
          <Text
            style={[
              styles.bottomBarSubtext,
              activeResult.remaining < 0 && styles.bottomBarTextNegative,
            ]}
          >
            {activeResult.remaining >= 0
              ? `₹${formatAmount(activeResult.remaining)} left`
              : `₹${formatAmount(Math.abs(activeResult.remaining))} over`}
          </Text>
        </View>
      ) : null}

      {activeTab === 'percentage' ? (
        <View style={styles.bottomBarColumn}>
          <Text style={styles.bottomBarText}>{formatAmount(activeResult.sumPercent)}% of 100%</Text>
          <Text
            style={[
              styles.bottomBarSubtext,
              activeResult.sumPercent > 100 && styles.bottomBarTextNegative,
            ]}
          >
            {activeResult.sumPercent <= 100
              ? `${formatAmount(100 - activeResult.sumPercent)}% left`
              : `${formatAmount(activeResult.sumPercent - 100)}% over`}
          </Text>
        </View>
      ) : null}

      {activeTab === 'shares' ? (
        <View style={styles.bottomBar}>
          <Text
            style={
              activeResult.totalShares === 0
                ? styles.sharesBarTextZero
                : styles.sharesBarTextNormal
            }
          >
            {activeResult.totalShares} total shares
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// InlineNumberField (the compact underline per-row input) and HeaderCheckmark
// now live in `src/components/` — promoted when Who Paid? (ADR 0025 §8.4)
// became their next call site (constitution §25). The "Paid by" row moved to
// `components/SplitPaidByRow.jsx`.

function createStyles(theme, insets) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    tabStrip: {
      paddingHorizontal: theme.space.xl,
      marginTop: theme.space.sm,
      flexGrow: 0,
    },
    copyBlock: {
      alignItems: 'center',
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.lg,
      paddingBottom: theme.space.md,
    },
    heading: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      textAlign: 'center',
      marginBottom: theme.space.xs,
    },
    subtext: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
    },
    blockMessage: {
      color: theme.color.status.negative,
      fontSize: theme.type.caption.fontSize,
      textAlign: 'center',
      marginTop: theme.space.sm,
    },
    listContainer: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      // The "By adjustment" tab is the one tab that renders no bottom bar
      // below this list, so the list itself is what must clear the bottom
      // system bar there. On the other four tabs the bar below already
      // clears it and this is just a little extra scroll runout.
      paddingBottom: theme.space.lg + insets.bottom,
    },
    // Both bottom bars are the last thing above the bottom system bar, so
    // their bottom padding is measured from the top of that bar. The bar's
    // own surface fill still extends to the physical screen edge (this is
    // padding, not a margin), so nothing draws a visible gap beneath it.
    bottomBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      paddingBottom: theme.space.md + insets.bottom,
      borderTopWidth: 1,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.background.surface,
    },
    bottomBarColumn: {
      alignItems: 'center',
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      paddingBottom: theme.space.md + insets.bottom,
      borderTopWidth: 1,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.background.surface,
    },
    bottomBarText: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: '600',
    },
    bottomBarSubtext: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginTop: 2,
    },
    bottomBarTextNegative: {
      color: theme.color.status.negative,
    },
    // By shares' bottom bar (design-system.md §9.4): status.negative "0
    // total shares" warning state, reverting to normal text.secondary once
    // totalShares > 0 — distinct from the other three tabs' bold
    // text.primary bottomBarText, per this tab's own explicit color spec.
    sharesBarTextZero: {
      color: theme.color.status.negative,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: '600',
    },
    sharesBarTextNormal: {
      color: theme.color.text.secondary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: '600',
    },
    allToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
    },
    allLabel: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
  });
}

export default AdjustSplitScreen;
