import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, SectionList, Animated, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useGroups } from '../../hooks/useGroups';
import { useIndividualBalances } from '../../hooks/useIndividualBalances';
import { useSplitFeedView } from '../../hooks/useSplitFeedView';
import { useGroupBalancesView } from '../../hooks/useGroupBalancesView';
import { useSplitExpenseSave } from '../../hooks/useSplitExpenseSave';
import { useMultiSelectDelete } from '../../hooks/useMultiSelectDelete';
import { isFeedItemTappable } from '../../utils/splitFeed';
import { canEditSplitExpense } from '../../utils/splitEdit';
import { splitSummary } from '../../mocks/splitMocks';
import { useUserIdentity } from '../../hooks/useUserIdentity';
import { formatSplitAmount } from '../../utils/currency';
import { buildBalanceSummary, debtSentence, memberNetSentence } from '../../utils/balanceCopy';
import { ESTIMATE_PREFIX, describeEstimate } from '../../utils/syncDisplay';
import { getInitialsFromName } from '../../utils/initials';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import InlineMessage from '../../components/InlineMessage';
import Avatar from '../../components/Avatar';
import PrimaryButton from '../../components/PrimaryButton';
import SegmentedControl from '../../components/SegmentedControl';
import TransactionDayHeader from '../../components/TransactionDayHeader';
import SplitFeedRow from '../../components/SplitFeedRow';
import BalanceSummary from '../../components/BalanceSummary';
import HeaderDeleteButton from '../../components/HeaderDeleteButton';
import ConfirmationDialog from '../../components/ConfirmationDialog';

// Cross-fade duration for the tab content when the Expenses/Balances control
// changes — reused verbatim from DashboardScreen.jsx (ADR 0009 §5).
const CONTENT_FADE_DURATION = 220;

// Singular/plural for useMultiSelectDelete's fallback error copy.
const SPLIT_EXPENSE_NOUN = ['expense', 'expenses'];

const DETAIL_TABS = [
  { label: 'Expenses', value: 'expenses' },
  // Renamed from "Members" — docs/decisions/
  // 0028-split-expense-edit-delete-feeds-and-balance-copy.md §11.2.
  { label: 'Balances', value: 'balances' },
];

/**
 * Split Detail — one shared screen, parameterized by `mode: 'group' |
 * 'individual'` (docs/decisions/0009-split-detail-and-settle-up.md), params
 * `{ mode: 'group', groupId }` or `{ mode: 'individual', individualBalanceId }`.
 *
 * **As of ADR 0028 (§7, §11.2) the Expenses tab is the target's feed**:
 * split expenses (deleted ones as tombstones) and settlements, grouped by day
 * with the Dashboard's own day header (`TransactionDayHeader`) — Project Owner,
 * 2026-11-12, replacing the ADR's month sections (§7.6) — through
 * `useSplitFeedView` (cache + queued ops, infinite scroll). Tapping a live
 * expense opens SplitExpenseDetail; a long press starts multi-select delete.
 *
 * The group **Balances** tab (was Members) shows each member's net
 * (`memberNetSentence`) and **Suggested payments** (`simplifyDebts`, §8.2).
 * The header reads `groupSummarySentence` plus up to two of the viewer's debts,
 * or `pairBalanceSentence` for a pair (§9.2). Every sentence comes from
 * `utils/balanceCopy.js`; nothing here negates a balance (ADR 0023 §1.4).
 *
 * **A failed read is never an empty state** — see `FeedPlaceholder` and
 * `renderMissingTarget`.
 */
function SplitDetailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme, insets);

  const { mode, groupId, individualBalanceId } = route.params ?? {};
  const isGroup = mode === 'group';
  const { currencySymbol } = splitSummary;

  const groupsRead = useGroups();
  const balancesRead = useIndividualBalances();
  const identity = useUserIdentity();
  const group = isGroup ? groupsRead.groups.find((item) => item.id === groupId) : null;
  const balance = !isGroup
    ? balancesRead.balances.find((item) => item.id === individualBalanceId)
    : null;
  const entity = isGroup ? group : balance;
  const target = useMemo(
    () => (isGroup ? { groupId } : { individualBalanceId }),
    [isGroup, groupId, individualBalanceId],
  );

  const feed = useSplitFeedView({
    ...target,
    // Lets queued items with this contact show here (ADR 0027 §8.8).
    counterpartContactId: balance?.counterpartContactId ?? null,
  });
  const groupBalances = useGroupBalancesView(isGroup ? groupId : null);

  // Multi-select delete (long press), the same pattern as the Dashboard. Only
  // a live split expense the viewer may delete (canEditSplitExpense — §11.4,
  // re-checked by the server) is selectable; settlements and tombstones are
  // not. Each delete is the same per-split delete SplitExpenseDetail uses, so
  // it reverses that split's balances and queues offline (ADR 0027/0028).
  const { deleteSplitExpense } = useSplitExpenseSave();
  const feedItemsRef = useRef(feed.items);
  feedItemsRef.current = feed.items;
  const deleteOne = useCallback(
    (id) => {
      const item = feedItemsRef.current.find(
        (candidate) => candidate.itemType === 'split_expense' && candidate.id === id,
      );
      return item
        ? deleteSplitExpense(item.splitExpense)
        : Promise.resolve({ success: true, error: null });
    },
    [deleteSplitExpense],
  );
  const selection = useMultiSelectDelete({ deleteOne, noun: SPLIT_EXPENSE_NOUN });
  const [isBulkDeleteDialogVisible, setIsBulkDeleteDialogVisible] = useState(false);
  const selectedCount = selection.selectedIds.size;
  const canSelect = (item) =>
    isFeedItemTappable(item) && canEditSplitExpense(item.splitExpense, identity.userId);

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

  // "TOTAL … SPENT" sums whole bills of live expenses, and only once every
  // page is loaded — a total over one page of a paginated feed would be a
  // confident wrong number (ADR 0009 §4).
  const totalSpent = useMemo(() => {
    if (!feed.hasLoaded || feed.hasMore) {
      return null;
    }
    return feed.items
      .filter((item) => item.itemType === 'split_expense' && !item.splitExpense?.deletedAt)
      .reduce((sum, item) => sum + item.splitExpense.amount, 0);
  }, [feed.items, feed.hasLoaded, feed.hasMore]);

  const balanceSections = useMemo(() => {
    const memberRows = groupBalances.members.map((member) => ({ kind: 'member', key: member.key, member }));
    const sections = [{ key: 'members', title: null, data: memberRows }];
    if (groupBalances.hasBalances && groupBalances.debts.length > 0) {
      sections.push({
        key: 'suggested',
        title: 'Suggested payments',
        data: groupBalances.debts.map((debt) => ({ kind: 'debt', key: `${debt.fromKey}>${debt.toKey}`, debt })),
      });
    }
    return sections;
  }, [groupBalances]);

  if (!entity) {
    return renderMissingTarget({
      styles,
      isGroup,
      onBack: () => navigation.goBack(),
      read: isGroup ? groupsRead : balancesRead,
    });
  }

  const name = isGroup ? group.name : balance.counterpartName;
  const yourBalance = isGroup ? group.yourBalance : balance.balance;
  const summary = buildBalanceSummary({
    isGroup,
    name,
    yourBalance,
    viewerDebts: groupBalances.viewerDebts,
    me: identity.userId,
    symbol: currencySymbol,
  });
  const isBalancesTab = isGroup && activeTab === 'balances';

  /** Names a legacy settlement's initiator (§7.4), which the item does not carry. */
  function resolveUserName(userId) {
    if (!userId) {
      return undefined;
    }
    if (isGroup) {
      return group.members.find((member) => member.userId === userId)?.name;
    }
    return balance.counterpartUserId === userId ? balance.counterpartName : undefined;
  }

  function renderItem({ item }) {
    if (!isBalancesTab) {
      return (
        <SplitFeedRow
          item={item}
          target={target}
          currentUserId={identity.userId}
          currencySymbol={currencySymbol}
          initiatorName={resolveUserName(item.settlement?.initiatedByUserId)}
          onOpenSplitExpense={(row) =>
            navigation.navigate('SplitExpenseDetail', { splitExpenseId: row.id, target })
          }
          isSelecting={selection.isSelecting}
          isSelectable={canSelect(item)}
          isSelected={selection.selectedIds.has(item.id)}
          onStartSelection={() => selection.startSelection(item.id)}
          onToggleSelection={() => selection.toggle(item.id)}
        />
      );
    }
    if (item.kind === 'debt') {
      return (
        <ListItem
          title={debtSentence(item.debt.from, item.debt.to, item.debt.amount, identity.userId, currencySymbol)}
        />
      );
    }
    const { member } = item;
    return (
      <ListItem
        leading={<Avatar initials={member.isMe ? identity.initials : getInitialsFromName(member.name)} size="medium" />}
        title={member.isMe ? 'You' : member.name}
        subtitle={groupBalances.hasBalances ? memberNetSentence(member, identity.userId, currencySymbol) : null}
      />
    );
  }

  return (
    <View style={styles.flex}>
      {selection.isSelecting ? (
        <ScreenHeader
          title={`${selectedCount} selected`}
          align="left"
          onBack={selection.clear}
          rightSlot={
            <HeaderDeleteButton
              onPress={() => setIsBulkDeleteDialogVisible(true)}
              disabled={selection.isDeleting}
              accessibilityLabel={`Delete ${selectedCount} selected`}
            />
          }
        />
      ) : (
        <ScreenHeader title={name} onBack={() => navigation.goBack()} />
      )}
      {selection.deleteError ? <InlineMessage message={selection.deleteError} /> : null}

      <SectionList
        sections={isBalancesTab ? balanceSections : feed.sections}
        keyExtractor={(item) => (isBalancesTab ? item.key : `${item.itemType}:${item.id}`)}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        onEndReached={isBalancesTab ? undefined : feed.loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <>
            {totalSpent !== null ? (
              <Card style={styles.totalCard}>
                <Text style={styles.cardLabel}>{isGroup ? 'TOTAL GROUP SPENT' : 'TOTAL SPENT TOGETHER'}</Text>
                <Text style={styles.totalAmount}>
                  {currencySymbol}
                  {formatSplitAmount(totalSpent)}
                </Text>
              </Card>
            ) : null}

            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>YOUR BALANCE</Text>
              <BalanceSummary
                summary={summary}
                prefix={entity.isEstimate ? ESTIMATE_PREFIX : ''}
                caption={entity.isEstimate ? describeEstimate(entity.pendingOpCount ?? 0) : null}
                onPressMore={() => setActiveTab('balances')}
              />
            </View>

            {yourBalance !== 0 ? (
              <PrimaryButton
                label="Settle Up"
                icon={<Text style={styles.settleIcon}>⇄</Text>}
                onPress={() => navigation.navigate('SettleUp', { mode, ...target })}
                style={styles.settleButton}
              />
            ) : null}

            {isGroup ? (
              <SegmentedControl
                options={DETAIL_TABS}
                value={activeTab}
                onChange={(value) => {
                  // Selection belongs to the Expenses list only.
                  selection.clear();
                  setActiveTab(value);
                }}
                style={styles.segmentedControl}
              />
            ) : null}
            {isBalancesTab && groupBalances.error ? (
              <Text style={styles.emptyText}>
                Suggested payments aren&apos;t available until these balances finish syncing.
              </Text>
            ) : null}
          </>
        }
        // Feed sections are day sections (keyed by `date`, no `title`); the
        // Balances tab's sections carry an optional `title`.
        renderSectionHeader={({ section }) => {
          if (!isBalancesTab && section.date) {
            return (
              <Animated.View style={{ opacity: contentOpacity }}>
                <TransactionDayHeader section={section} currencySymbol={currencySymbol} />
              </Animated.View>
            );
          }
          return isBalancesTab && section.title ? (
            <Animated.View style={{ opacity: contentOpacity }}>
              <Text style={styles.sectionHeader}>{section.title}</Text>
            </Animated.View>
          ) : null;
        }}
        renderItem={(info) => (
          <Animated.View style={{ opacity: contentOpacity }}>{renderItem(info)}</Animated.View>
        )}
        ListFooterComponent={
          !isBalancesTab && feed.isLoadingMore ? <Text style={styles.footerText}>Loading more…</Text> : null
        }
        ListEmptyComponent={
          isBalancesTab ? null : (
            <FeedPlaceholder styles={styles} name={name} isGroup={isGroup} feed={feed} />
          )
        }
      />

      <ConfirmationDialog
        visible={isBulkDeleteDialogVisible}
        title={selectedCount === 1 ? 'Delete Expense' : `Delete ${selectedCount} Expenses`}
        message={`Delete ${
          selectedCount === 1 ? 'this expense' : `these ${selectedCount} expenses`
        }? Everyone's balances will be updated, and your own expense from ${
          selectedCount === 1 ? 'it' : 'them'
        } will be removed too.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setIsBulkDeleteDialogVisible(false);
          selection.deleteSelected();
        }}
        onCancel={() => setIsBulkDeleteDialogVisible(false)}
      />
    </View>
  );
}

/**
 * The Expenses tab's states, kept apart on purpose (constitution §22):
 * loading, failed with a Retry, and a read that genuinely came back empty.
 */
function FeedPlaceholder({ styles, name, isGroup, feed }) {
  if (!feed.hasLoaded && feed.loadError) {
    return <InlineMessage message={feed.loadError} onRetry={feed.reload} />;
  }
  if (!feed.hasLoaded) {
    return <Text style={styles.emptyText}>Loading this split&apos;s history…</Text>;
  }
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>
        {isGroup
          ? `No expenses yet in "${name}". Split an expense with this group to see it here.`
          : `No expenses yet with ${name}. Split an expense to see it here.`}
      </Text>
    </View>
  );
}

/**
 * The target itself is not in the held list — still loading, the read failed
 * (with a Retry), or it genuinely is not there (which for a membership-gated
 * resource also covers "no longer a member": a `404`, never a `403`). The
 * not-found copy deliberately names no cause (ADR 0009 §7).
 */
function renderMissingTarget({ styles, isGroup, onBack, read }) {
  return (
    <View style={styles.flex}>
      <ScreenHeader title={isGroup ? 'Group' : 'Split'} onBack={onBack} />
      <View style={styles.notFoundContainer}>
        {!read.hasLoaded && read.isLoading ? (
          <Text style={styles.notFoundText}>Loading…</Text>
        ) : !read.hasLoaded && read.loadError ? (
          <InlineMessage message={read.loadError} onRetry={read.reload} />
        ) : (
          <>
            <Text style={styles.notFoundText}>
              This {isGroup ? 'group' : 'split'} couldn&apos;t be found. It may have been removed.
            </Text>
            <PrimaryButton label="Go Back" onPress={onBack} style={styles.notFoundButton} />
          </>
        )}
      </View>
    </View>
  );
}

function createStyles(theme, insets) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    listContent: {
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      // No FAB on this screen — only the floating tab bar needs clearing.
      paddingBottom: getTabBarTopEdge(theme, insets) + theme.space.lg,
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
      backgroundColor: theme.color.background.surfaceAlt,
      paddingVertical: theme.space.md,
      paddingHorizontal: theme.space.lg,
      marginBottom: theme.space.lg,
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
    footerText: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      textAlign: 'center',
      paddingVertical: theme.space.md,
    },
  });
}

export default SplitDetailScreen;
