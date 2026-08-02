import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, SectionList, Animated, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useGroupsStore } from '../../store/useGroupsStore';
import { useIndividualSplitsStore } from '../../store/useIndividualSplitsStore';
import { useSplitExpensesStore } from '../../store/useSplitExpensesStore';
import { useContactsStore } from '../../store/useContactsStore';
import { profileUser } from '../../mocks/profileMocks';
import { splitSummary } from '../../mocks/splitMocks';
import { getDateDisplayLabel } from '../../utils/dateDisplay';
import { getBalanceTrailing } from '../../utils/splitCalculations';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';
import Avatar from '../../components/Avatar';
import PrimaryButton from '../../components/PrimaryButton';
import SegmentedControl from '../../components/SegmentedControl';

// Cross-fade duration for the tab content (section headers + rows) when the
// Expenses/Members SegmentedControl changes — reused verbatim from
// DashboardScreen.jsx / SplitGroupsListScreen.jsx (docs/decisions/
// 0009-split-detail-and-settle-up.md §5, not a new duration/mechanism).
const CONTENT_FADE_DURATION = 220;

const DETAIL_TABS = [
  { label: 'Expenses', value: 'expenses' },
  { label: 'Members', value: 'members' },
];

/**
 * Split Detail — one shared screen, parameterized by `mode: 'group' |
 * 'individual'`, reached by tapping either an Individual-tab or Group-tab
 * card on SplitGroupsListScreen.jsx (docs/decisions/
 * 0009-split-detail-and-settle-up.md). Params: `{ mode: 'group', groupId }`
 * or `{ mode: 'individual', individualId }`. Stack push (back arrow), not a
 * modal — registered in SplitStack.jsx.
 *
 * Data sources (ADR 0009 §1/§2, verified against the actual store shapes):
 * - Expense history comes from useSplitExpensesStore, filtered by
 *   `groupId`/`individualId` — never useTransactionsStore, which only ever
 *   holds the user's own consumption share of a checked-in split, not the
 *   full itemized history.
 * - "YOUR BALANCE" reads the existing, already-computed aggregate
 *   `yourBalance` directly off the relevant useGroupsStore/
 *   useIndividualSplitsStore entry, via a reactive selector (ADR 0007 §8's
 *   precedent) — no new derivation.
 *
 * Settle Up (ADR 0009 §6, amended 2026-08-14) zeroes that aggregate balance
 * and logs one useActivityLogStore entry — it never creates, updates, or
 * deletes any useTransactionsStore record, in either balance direction (ADR
 * 0009 §6.1's reasoned "no", a direct continuation of ADR 0005 §6.1's
 * consumption-share accounting model, not a corner cut). As of the
 * amendment, this screen no longer performs that write itself — tapping
 * "Settle Up" below now navigates to the dedicated SettleUp screen
 * (SettleUpScreen.jsx), which owns the confirmation step and the actual
 * settleBalance/buildSettlementActivity calls. The mechanism itself is
 * unchanged, only its trigger point moved.
 */
function SplitDetailScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme);

  const { mode, groupId, individualId } = route.params ?? {};
  const isGroup = mode === 'group';
  const { currencySymbol } = splitSummary;

  // Reactive lookups (not one-time snapshots) — ADR 0007 §8's precedent,
  // reused here per ADR 0009 §4 — so this screen reflects Settle Up's write
  // immediately, with no navigation round-trip.
  const group = useGroupsStore((state) =>
    isGroup ? state.groups.find((item) => item.id === groupId) : null,
  );
  const individualSplitEntry = useIndividualSplitsStore((state) =>
    !isGroup ? state.individualSplits.find((item) => item.id === individualId) : null,
  );
  const splitExpenses = useSplitExpensesStore((state) => state.splitExpenses);
  const contacts = useContactsStore((state) => state.contacts);

  const entity = isGroup ? group : individualSplitEntry;

  const [activeTab, setActiveTab] = useState('expenses');
  const contentOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    contentOpacity.setValue(0);
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: CONTENT_FADE_DURATION,
      useNativeDriver: true,
    }).start();
  }, [activeTab, contentOpacity]);

  // Expense-history filter — ADR 0009 §1's corrected filter key
  // (`individualId`, a useIndividualSplitsStore entry id — never `contactId`).
  const filteredSplitExpenses = useMemo(() => {
    if (!entity) {
      return [];
    }
    return isGroup
      ? splitExpenses.filter((expense) => expense.groupId === groupId)
      : splitExpenses.filter((expense) => expense.individualId === individualId);
  }, [entity, isGroup, splitExpenses, groupId, individualId]);

  // "TOTAL ... SPENT" — the full expense total across every filtered
  // record, never scoped to only the current user's own share (ADR 0009 §4).
  const totalSpent = useMemo(
    () => filteredSplitExpenses.reduce((sum, expense) => sum + expense.amount, 0),
    [filteredSplitExpenses],
  );

  const expenseSections = useMemo(
    () => groupSplitExpensesByDate(filteredSplitExpenses),
    [filteredSplitExpenses],
  );

  // Members tab (Group mode only) — "You" first, then each
  // memberContactIds entry resolved via useContactsStore. No per-member
  // balance (none exists in this app's data model) — ADR 0009 §5.
  const memberSections = useMemo(() => {
    if (!isGroup || !group) {
      return [];
    }
    const memberRows = [
      { key: 'self', title: 'You', initials: profileUser.initials },
      ...group.memberContactIds.map((contactId) => {
        const contact = contacts.find((candidate) => candidate.id === contactId);
        return {
          key: contactId,
          title: contact ? contact.name : 'Unknown Contact',
          initials: contact ? contact.initials : '?',
        };
      }),
    ];
    return [{ title: null, data: memberRows }];
  }, [isGroup, group, contacts]);

  // Not-found defensive state (ADR 0009 §7) — a stale/deep-link
  // groupId/individualId that no longer resolves. Mirrors
  // TransactionDetailScreen.jsx's exact pattern.
  if (!entity) {
    return (
      <View style={styles.flex}>
        <ScreenHeader
          title={isGroup ? 'Group' : 'Split'}
          onBack={() => navigation.goBack()}
        />
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

  const balanceCopy =
    yourBalance > 0
      ? {
          text: `You are owed ${currencySymbol}${yourBalance.toLocaleString('en-IN')}`,
          color: theme.color.status.positive,
          borderColor: theme.color.status.positive,
        }
      : yourBalance < 0
        ? {
            text: `You owe ${currencySymbol}${Math.abs(yourBalance).toLocaleString('en-IN')}`,
            color: theme.color.status.negative,
            borderColor: theme.color.status.negative,
          }
        : {
            text: "You're all settled up",
            color: theme.color.text.secondary,
            borderColor: theme.color.border.subtle,
          };

  // Settle Up — navigates to the dedicated SettleUp screen (ADR 0009's
  // 2026-08-14 amendment) instead of an inline Alert.alert confirmation.
  // The destination screen owns the confirmation UI and the actual
  // settleBalance/buildSettlementActivity calls; this screen's own
  // reactive selectors above pick up the change immediately on return.
  function handleSettleUp() {
    navigation.navigate('SettleUp', isGroup ? { mode, groupId } : { mode, individualId });
  }

  const sections = isGroup && activeTab === 'members' ? memberSections : expenseSections;

  return (
    <View style={styles.flex}>
      <ScreenHeader title={name} onBack={() => navigation.goBack()} />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id ?? item.key}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <>
            <Card style={styles.totalCard}>
              <Text style={styles.cardLabel}>
                {isGroup ? 'TOTAL GROUP SPENT' : 'TOTAL SPENT TOGETHER'}
              </Text>
              <Text style={styles.totalAmount}>
                {currencySymbol}
                {totalSpent.toLocaleString('en-IN')}
              </Text>
            </Card>

            <View style={[styles.balanceCard, { borderLeftColor: balanceCopy.borderColor }]}>
              <Text style={styles.cardLabel}>YOUR BALANCE</Text>
              <Text style={[styles.balanceText, { color: balanceCopy.color }]}>
                {balanceCopy.text}
              </Text>
            </View>

            {yourBalance !== 0 ? (
              <PrimaryButton
                label="Settle Up"
                icon={<Text style={styles.settleIcon}>⇄</Text>}
                onPress={handleSettleUp}
                style={styles.settleButton}
              />
            ) : null}

            {isGroup ? (
              <SegmentedControl
                options={DETAIL_TABS}
                value={activeTab}
                onChange={setActiveTab}
                style={styles.segmentedControl}
              />
            ) : null}
          </>
        }
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Animated.View style={{ opacity: contentOpacity }}>
              <Text style={styles.sectionHeader}>{section.title}</Text>
            </Animated.View>
          ) : null
        }
        renderItem={({ item }) => (
          <Animated.View style={{ opacity: contentOpacity }}>
            {isGroup && activeTab === 'members' ? (
              <ListItem
                leading={<Avatar initials={item.initials} size="medium" />}
                title={item.title}
              />
            ) : (
              <ExpenseRow item={item} currencySymbol={currencySymbol} />
            )}
          </Animated.View>
        )}
        ListEmptyComponent={
          !isGroup || activeTab === 'expenses' ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {isGroup
                  ? `No expenses yet in "${group.name}". Split an expense with this group to see it here.`
                  : `No expenses yet with ${individualSplitEntry.personName}. Split an expense to see it here.`}
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

/**
 * One expense-history row — ADR 0009 §2's exact per-row derivation. Reads
 * everything directly off the split record (category icon, "Paid by",
 * per-expense lent/owed direction) with no live contact lookup — names are
 * frozen at the moment the split was saved, extending ADR 0008 §1.3's
 * "historical accuracy" precedent to this screen.
 */
function ExpenseRow({ item, currencySymbol }) {
  const payerLabel =
    item.paidById === 'self'
      ? 'You'
      : (item.participants.find((participant) => participant.participantId === item.paidById)
          ?.name ?? 'Someone');

  const yourShare =
    item.participants.find((participant) => participant.participantId === 'self')?.amount ?? 0;
  const netForRow = (item.paidById === 'self' ? item.amount : 0) - yourShare;
  const { trailingText, trailingSubtext, trailingTone } = getBalanceTrailing(
    netForRow,
    currencySymbol,
  );

  return (
    <ListItem
      leading={<IconBadge glyph={item.glyph} tone={item.tone} />}
      title={item.title}
      subtitle={`Paid by ${payerLabel}`}
      trailingText={trailingText}
      trailingSubtext={trailingSubtext}
      trailingTone={trailingTone}
    />
  );
}

/**
 * Local, single-call-site pure function grouping the filtered split-expense
 * list into SectionList-ready, date-labeled sections — ADR 0009 §3. Not
 * promoted to dateDisplay.js this round (constitution §3.5/§25 — duplicate
 * once is acceptable; flagged forward for a future date-grouped screen).
 *
 * Buckets by the raw stored `date` string (not the computed label), so two
 * records on the same real calendar day always land together regardless of
 * when "today" is evaluated; within a bucket, the store's existing
 * newest-first order is preserved.
 */
function groupSplitExpensesByDate(splitExpenseList) {
  const buckets = new Map();

  splitExpenseList.forEach((expense) => {
    if (!buckets.has(expense.date)) {
      buckets.set(expense.date, []);
    }
    buckets.get(expense.date).push(expense);
  });

  return Array.from(buckets.entries())
    .sort(([dateA], [dateB]) => (dateA < dateB ? 1 : dateA > dateB ? -1 : 0))
    .map(([date, items]) => ({
      title: getDateDisplayLabel(date).toUpperCase(),
      data: items,
    }));
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    listContent: {
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      // No FAB on this screen — only the floating tab bar needs clearing,
      // same helper TransactionDetailScreen.jsx/ActivitiesScreen.jsx use.
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
    cardLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    totalCard: {
      marginBottom: theme.space.md,
    },
    totalAmount: {
      color: theme.color.text.primary,
      fontSize: theme.type.h1.fontSize,
      lineHeight: theme.type.h1.lineHeight,
      fontWeight: theme.type.h1.fontWeight,
    },
    balanceCard: {
      borderRadius: theme.radius.lg,
      borderLeftWidth: 4,
      backgroundColor: theme.color.background.surfaceAlt,
      paddingVertical: theme.space.md,
      paddingHorizontal: theme.space.lg,
      marginBottom: theme.space.lg,
    },
    balanceText: {
      fontSize: theme.type.h1.fontSize,
      lineHeight: theme.type.h1.lineHeight,
      fontWeight: theme.type.h1.fontWeight,
    },
    settleButton: {
      marginBottom: theme.space.xl,
    },
    settleIcon: {
      color: theme.color.accent.onPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    segmentedControl: {
      marginBottom: theme.space.xl,
    },
    sectionHeader: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginTop: theme.space.md,
      marginBottom: theme.space.sm,
    },
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: theme.space.xxxl,
    },
    emptyText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
    },
  });
}

export default SplitDetailScreen;
