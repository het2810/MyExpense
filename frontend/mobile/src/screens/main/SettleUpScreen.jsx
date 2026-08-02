import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useGroupsStore } from '../../store/useGroupsStore';
import { useIndividualSplitsStore } from '../../store/useIndividualSplitsStore';
import { useContactsStore } from '../../store/useContactsStore';
import { useActivityLogStore } from '../../store/useActivityLogStore';
import { splitSummary } from '../../mocks/splitMocks';
import { getExactDateLabel, getTodayIsoDate } from '../../utils/dateDisplay';
import { buildSettlementActivity } from '../../utils/activityLogEntries';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import Avatar from '../../components/Avatar';
import IconBadge from '../../components/IconBadge';
import PrimaryButton from '../../components/PrimaryButton';
import ConfettiBurst from '../../components/ConfettiBurst';

const SETTLEMENT_METHODS = [
  { value: 'marked_paid', label: 'Mark as Paid' },
  { value: 'upi', label: 'Settle via UPI / External App' },
];

/**
 * Settle Up — dedicated pushed screen, docs/decisions/
 * 0009-split-detail-and-settle-up.md's 2026-08-14 amendment (Part A-D),
 * docs/ui/design-system.md §13.6-13.8. Registered as `SettleUp` in
 * SplitStack.jsx, reached from SplitDetailScreen's "Settle Up" button via
 * `navigation.navigate('SettleUp', { mode, groupId })` /
 * `{ mode, individualId }` — the same param shape SplitDetail itself takes,
 * forwarded unchanged.
 *
 * Replaces SplitDetailScreen's former inline `Alert.alert` confirmation —
 * this screen IS the confirmation step now, so no Alert.alert layers on top
 * of "Confirm Settlement".
 *
 * The underlying settle mechanism is completely UNCHANGED from ADR 0009
 * §6.1/§6.3, only its trigger point moved here: on confirm, calls the
 * existing `useGroupsStore().settleBalance(groupId)` /
 * `useIndividualSplitsStore().settleBalance(individualId)` action (zeroes
 * the aggregate yourBalance) plus one
 * `useActivityLogStore().addActivity(buildSettlementActivity({...}))` call.
 * Deliberately, per ADR 0009 §6.1's fully-reasoned "no", this NEVER creates,
 * updates, or deletes anything in useTransactionsStore, in either balance
 * direction — that store is not imported here at all.
 *
 * "Mark as Paid" (default) and "Settle via UPI / External App" fire the
 * identical settle mechanism either way — the only difference is which
 * `method` value is threaded into buildSettlementActivity's Activity Log
 * copy (ADR 0009 amendment, Part D). Neither option performs any real
 * payment integration.
 *
 * On success, plays a one-shot ConfettiBurst celebration, then
 * navigation.goBack() returns to SplitDetail, whose reactive selectors
 * (ADR 0009 §4, unchanged) immediately reflect the now-zeroed balance.
 */
function SettleUpScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme);

  const { mode, groupId, individualId } = route.params ?? {};
  const isGroup = mode === 'group';
  const { currencySymbol } = splitSummary;

  const group = useGroupsStore((state) =>
    isGroup ? state.groups.find((item) => item.id === groupId) : null,
  );
  const individualSplitEntry = useIndividualSplitsStore((state) =>
    !isGroup ? state.individualSplits.find((item) => item.id === individualId) : null,
  );
  const settleGroupBalance = useGroupsStore((state) => state.settleBalance);
  const settleIndividualBalance = useIndividualSplitsStore((state) => state.settleBalance);
  const contacts = useContactsStore((state) => state.contacts);
  const addActivity = useActivityLogStore((state) => state.addActivity);

  const entity = isGroup ? group : individualSplitEntry;

  const [method, setMethod] = useState('marked_paid');
  const [isCelebrating, setIsCelebrating] = useState(false);

  // Not-found defensive state — a stale/deep-link groupId/individualId that
  // no longer resolves (mirrors SplitDetailScreen.jsx's identical pattern).
  if (!entity) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="Settle Up" onBack={() => navigation.goBack()} />
        <View style={styles.notFoundContainer}>
          <Text style={styles.notFoundText}>
            This {isGroup ? 'group' : 'split'} couldn&apos;t be found. It may have been removed.
          </Text>
          <PrimaryButton
            label="Go Back"
            onPress={() => navigation.goBack()}
            style={styles.notFoundButton}
          />
        </View>
      </View>
    );
  }

  const name = isGroup ? group.name : individualSplitEntry.personName;
  const yourBalance = entity.yourBalance;

  const otherContact = !isGroup
    ? contacts.find((contact) => contact.id === individualSplitEntry.contactId)
    : null;
  const individualInitials = otherContact
    ? otherContact.initials
    : (individualSplitEntry?.personName?.charAt(0) ?? '?');

  // Same three-way balance sentence SplitDetailScreen's YOUR BALANCE block
  // already computes (ADR 0009 §4) — duplicated here rather than promoted
  // into a shared helper, per the ADR's own "minor, non-architecturally-
  // significant call" framing (constitution §3.5/§25 — duplicate once is
  // acceptable).
  const balanceCopy =
    yourBalance > 0
      ? {
          text: `You are owed ${currencySymbol}${yourBalance.toLocaleString('en-IN')}`,
          color: theme.color.status.positive,
        }
      : yourBalance < 0
        ? {
            text: `You owe ${currencySymbol}${Math.abs(yourBalance).toLocaleString('en-IN')}`,
            color: theme.color.status.negative,
          }
        : {
            text: "You're all settled up",
            color: theme.color.text.secondary,
          };

  const selectedMethodLabel =
    SETTLEMENT_METHODS.find((option) => option.value === method)?.label ?? 'Mark as Paid';

  // Orchestration — identical mechanism to ADR 0009 §6.3's original
  // handleConfirmSettle, mode-branched, unchanged. `amount` is captured
  // BEFORE the store write, since settleBalance discards the prior value.
  function handleConfirmSettlement() {
    const amount = Math.abs(yourBalance);
    if (isGroup) {
      settleGroupBalance(groupId);
      addActivity(
        buildSettlementActivity({
          mode: 'group',
          name: group.name,
          amount,
          groupId,
          contactId: null,
          method,
        }),
      );
    } else {
      settleIndividualBalance(individualId);
      addActivity(
        buildSettlementActivity({
          mode: 'individual',
          name: individualSplitEntry.personName,
          amount,
          groupId: null,
          contactId: individualSplitEntry.contactId,
          method,
        }),
      );
    }
    setIsCelebrating(true);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Settle Up" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          {isGroup ? (
            <IconBadge glyph={group.name.charAt(0)} tone="neutral" size="large" />
          ) : (
            <Avatar initials={individualInitials} size="large" />
          )}
          <Text style={styles.heroName}>{name}</Text>
          <Text style={[styles.heroBalance, { color: balanceCopy.color }]}>
            {balanceCopy.text}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>SETTLEMENT METHOD</Text>
        {SETTLEMENT_METHODS.map((option) => (
          <MethodRow
            key={option.value}
            label={option.label}
            isSelected={method === option.value}
            onPress={() => setMethod(option.value)}
          />
        ))}

        <Card style={styles.detailsCard}>
          <Text style={styles.cardLabel}>SETTLEMENT DETAILS</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailRowLabel}>Amount</Text>
            <Text style={styles.detailRowValue}>
              {currencySymbol}
              {Math.abs(yourBalance).toLocaleString('en-IN')}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailRowLabel}>Date</Text>
            <Text style={styles.detailRowValue}>{getExactDateLabel(getTodayIsoDate())}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailRowLabel}>Method</Text>
            <Text style={styles.detailRowValue}>{selectedMethodLabel}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailRowLabel}>{isGroup ? 'Group' : 'With'}</Text>
            <Text style={styles.detailRowValue}>{name}</Text>
          </View>
        </Card>

        <PrimaryButton
          label="Confirm Settlement"
          icon={<Text style={styles.confirmIcon}>⇄</Text>}
          onPress={handleConfirmSettlement}
          disabled={isCelebrating}
          style={styles.confirmButton}
        />
      </ScrollView>

      {isCelebrating ? <ConfettiBurst onComplete={() => navigation.goBack()} /> : null}
    </View>
  );
}

/**
 * One Settlement Method row — reuses the exact single-select-with-checkmark
 * interaction docs/decisions/0005-split-add-expense-flow.md §4.1's four "How
 * Was This Expense Split?" preset rows already established (HowWasThisSplitScreen.jsx's
 * PresetRow), simplified to a plain label (no avatars/amount line needed
 * here — just which method was picked).
 */
function MethodRow({ label, isSelected, onPress }) {
  const theme = useTheme();
  const styles = createMethodRowStyles(theme);

  return (
    <Card style={styles.card}>
      <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
        <Text style={styles.label}>{label}</Text>
        <View style={styles.checkmarkSlot}>{isSelected ? <Text style={styles.checkmark}>✓</Text> : null}</View>
      </Pressable>
    </Card>
  );
}

function createMethodRowStyles(theme) {
  return StyleSheet.create({
    card: {
      marginBottom: theme.space.sm,
      padding: theme.space.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    label: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
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

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      // No FAB on this screen — only the floating tab bar needs clearing,
      // same helper SplitDetailScreen.jsx/TransactionDetailScreen.jsx use.
      paddingBottom: getTabBarTopEdge(theme) + theme.space.lg,
    },
    notFoundContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.space.xl,
    },
    notFoundText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      marginBottom: theme.space.lg,
    },
    notFoundButton: {
      minWidth: 160,
    },
    hero: {
      alignItems: 'center',
      marginBottom: theme.space.xl,
    },
    heroName: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      textAlign: 'center',
      marginTop: theme.space.md,
      marginBottom: theme.space.xs,
    },
    heroBalance: {
      fontSize: theme.type.h1.fontSize,
      lineHeight: theme.type.h1.lineHeight,
      fontWeight: theme.type.h1.fontWeight,
      textAlign: 'center',
    },
    sectionLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.sm,
    },
    detailsCard: {
      marginTop: theme.space.md,
      marginBottom: theme.space.xl,
    },
    cardLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.sm,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: theme.space.xs,
    },
    detailRowLabel: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    detailRowValue: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    confirmIcon: {
      color: theme.color.accent.onPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    confirmButton: {
      marginBottom: theme.space.lg,
    },
  });
}

export default SettleUpScreen;
