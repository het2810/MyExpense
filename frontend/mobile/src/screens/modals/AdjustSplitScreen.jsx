import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput as RNTextInput, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import ScreenHeader from '../../components/ScreenHeader';
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

function formatAmount(value) {
  return (Math.round(value * 100) / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });
}

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
 * route.params: `{ totalAmount, participants, currentSplitConfig }`.
 */
function AdjustSplitScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme);

  const totalAmount = route.params?.totalAmount ?? 0;
  const participants = route.params?.participants ?? [];
  const currentSplitConfig = route.params?.currentSplitConfig ?? null;

  const [activeTab, setActiveTab] = useState(
    currentSplitConfig && TAB_VALUES.includes(currentSplitConfig.method)
      ? currentSplitConfig.method
      : 'equally',
  );
  const [paidById, setPaidById] = useState(currentSplitConfig?.paidById ?? 'self');
  const [isPayerListOpen, setIsPayerListOpen] = useState(false);

  const [checkedMap, setCheckedMap] = useState({});
  const [amountTextMap, setAmountTextMap] = useState({});
  const [percentTextMap, setPercentTextMap] = useState({});
  const [shareTextMap, setShareTextMap] = useState({});
  const [adjustmentTextMap, setAdjustmentTextMap] = useState({});

  const payer = participants.find((participant) => participant.participantId === paidById) ??
    participants[0];

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
    setPaidById(participant.participantId);
    setIsPayerListOpen(false);
  }

  function handleConfirm() {
    if (!activeResult.isValid) {
      return;
    }
    navigation.popTo('SplitAddExpense', {
      splitConfig: {
        method: activeTab,
        paidById,
        participantAmounts: activeResult.participantAmounts,
      },
    });
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

      {payer ? (
        <View style={styles.paidBySection}>
          <ListItem
            leading={<Avatar initials={payer.initials} size="small" />}
            title={`Paid by ${payer.name}`}
            trailing={
              <Pressable
                onPress={() => setIsPayerListOpen((prev) => !prev)}
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
          {isPayerListOpen ? (
            <View style={styles.inlineList}>
              {participants.map((participant) => (
                <ListItem
                  key={participant.participantId}
                  leading={<Avatar initials={participant.initials} size="small" />}
                  title={participant.name}
                  onPress={() => handleSelectPayer(participant)}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

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

// Compact underline numeric field used inline in a ListItem's trailing slot
// — Unequally/By percentages/By shares/By adjustment's per-row input.
// File-local (not exported/shared) since it's a small composition specific
// to this screen's four tabs, reused 4x within this one file rather than
// crossing into a new shared design-system component the ADR doesn't ask
// for.
function InlineNumberField({ prefix, suffix, value, onChangeText, placeholder, keyboardType }) {
  const theme = useTheme();
  const styles = createInlineFieldStyles(theme);

  return (
    <View style={styles.row}>
      {prefix ? <Text style={styles.affix}>{prefix}</Text> : null}
      <RNTextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
        keyboardType={keyboardType ?? 'decimal-pad'}
      />
      {suffix ? <Text style={styles.affix}>{suffix}</Text> : null}
    </View>
  );
}

// Composed into ScreenHeader's rightSlot — identical pattern to
// SplitAddExpenseScreen.jsx's own HeaderCheckmark (duplicated here rather
// than extracted into a new shared component, since this is a trivial,
// screen-header-specific composition — the same "composed into rightSlot
// per-screen" framing ADR 0005 §3.1 already uses for ThemeToggleButton +
// Avatar).
function HeaderCheckmark({ onPress }) {
  const theme = useTheme();
  const styles = createHeaderCheckmarkStyles(theme);

  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save">
      <Text style={styles.icon}>✓</Text>
    </Pressable>
  );
}

function createHeaderCheckmarkStyles(theme) {
  return StyleSheet.create({
    icon: {
      color: theme.color.text.primary,
      fontSize: 22,
      fontWeight: '700',
    },
  });
}

function createInlineFieldStyles(theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      paddingBottom: theme.space.xs,
      minWidth: 88,
    },
    affix: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.body.fontSize,
      marginHorizontal: theme.space.xs,
    },
    input: {
      flex: 1,
      textAlign: 'right',
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      paddingVertical: 0,
    },
  });
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    paidBySection: {
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
      paddingBottom: theme.space.lg,
    },
    bottomBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.md,
      borderTopWidth: 1,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.background.surface,
    },
    bottomBarColumn: {
      alignItems: 'center',
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.md,
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
