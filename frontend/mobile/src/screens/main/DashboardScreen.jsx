import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, SectionList, StyleSheet, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getFabTopEdge } from '../../theme/layout';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useGroupsStore } from '../../store/useGroupsStore';
import { useBudgetView } from '../../hooks/useBudgetView';
import { describeLocalSyncStatus } from '../../utils/syncDisplay';
import { useTransactions } from '../../hooks/useTransactions';
import { useTransactionSelection } from '../../hooks/useTransactionSelection';
import { useCategories } from '../../hooks/useCategories';
import { useUserIdentity } from '../../hooks/useUserIdentity';
import { groupTransactionsByDay } from '../../utils/transactionDayGroups';
import { formatCategoryPath } from '../../utils/categories';
import {
  getDaysElapsedInPeriod,
  computeSpentForPeriod,
  computeSpentByPaymentModeForPeriod,
  computeCategoryCapUsage,
} from '../../utils/budgetPeriod';
import ScreenHeader from '../../components/ScreenHeader';
import ThemeToggleButton from '../../components/ThemeToggleButton';
import NotificationBell from '../../components/NotificationBell';
import Avatar from '../../components/Avatar';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';
import TransactionDayHeader from '../../components/TransactionDayHeader';
import SegmentedControl from '../../components/SegmentedControl';
import ProgressBar from '../../components/ProgressBar';
import FloatingActionButton from '../../components/FloatingActionButton';
import InlineMessage from '../../components/InlineMessage';
import HeaderDeleteButton from '../../components/HeaderDeleteButton';
import ConfirmationDialog from '../../components/ConfirmationDialog';
import Checkbox from '../../components/Checkbox';
import { dashboardSummary } from '../../mocks/dashboardMocks';

const VIEW_OPTIONS = [
  { label: 'Personal', value: 'personal' },
  { label: 'Group', value: 'group' },
];

// Spending ratio at which the overspending warning first appears.
const WARNING_THRESHOLD = 0.8;

// Duration (ms) of the cross-fade applied to the transaction list content
// whenever the Personal/Group toggle changes.
const CONTENT_FADE_DURATION = 220;

/**
 * MyExpense home/dashboard — monthly budget, remaining, daily average,
 * personal/group toggle, recent transactions.
 *
 * MONTHLY BUDGET / spent / REMAINING / DAILY AVG are derived from
 * useBudgetStore's activePeriod and useTransactionsStore, per
 * docs/decisions/0010-budget-settings.md §8 — no longer static mock values.
 * A "Savings" stat item never renders on this screen (removed entirely per
 * ADR 0010's second same-day amendment, §A) — it is reintroduced only as a
 * one-time retrospective figure on BudgetSummaryScreen, shown separately
 * when a period ends. `dashboardSummary` (src/mocks/dashboardMocks.js) now
 * only supplies `currencySymbol`.
 *
 * ---
 * **TRANSACTIONS ARE SERVER-BACKED AS OF DOMAIN 4'S WIRING STEP**
 * (`GET /api/v1/transactions`, docs/api/api-overview.md §4.1). Three things
 * follow, and all three are visible on this screen:
 *
 * 1. **Every row renders from the server's own snapshot fields** —
 *    `categoryName`/`parentCategoryName`/`categoryGlyph`/`categoryTone` —
 *    never from a category lookup. Income rows carry `categoryId: null` with
 *    those fields filled from server constants, so nothing here null-guards a
 *    category (docs/decisions/0018-income-is-not-a-category.md §3). Since
 *    docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md
 *    a category rename rewrites those snapshots server-side, so they are the
 *    live truth rather than frozen history, and re-reading the list is what
 *    picks that up.
 * 2. **The list is paginated and accumulates.** `onEndReached` asks for the
 *    next page; the footer says when one is loading or failed.
 * 3. **The summary card's figures are derived from the rows CURRENTLY
 *    LOADED**, because §4/§5 expose no aggregate endpoint. With more than one
 *    page of history they are understated until the rest is loaded — see
 *    `useTransactionsStore`'s pagination note. Flagged, not hidden.
 */
function DashboardScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [viewMode, setViewMode] = useState('personal');
  // Multi-select (long press) + bulk delete — hooks/useTransactionSelection.js.
  const selection = useTransactionSelection();
  const [isBulkDeleteDialogVisible, setIsBulkDeleteDialogVisible] =
    useState(false);
  const selectedCount = selection.selectedIds.size;
  const overspendingAlertsEnabled = useSettingsStore(
    state => state.overspendingAlertsEnabled,
  );
  const paymentModeEnabled = useSettingsStore(
    state => state.paymentModeEnabled,
  );
  // This hook is the load trigger for `GET /transactions` (cache-first, one
  // page-0 request per session) as well as the read.
  const {
    transactions,
    hasLoaded,
    isLoading,
    isLoadingMore,
    loadError,
    loadMoreError,
    loadMore,
    reload,
  } = useTransactions();
  const groups = useGroupsStore(state => state.groups);
  // Snapshot + a queued budget save (ADR 0027 §8.8).
  const activePeriod = useBudgetView();
  // Needed only to roll subcategory spend up to a capped parent (caps are
  // inclusive of subcategories, api-overview.md §5.2). Cache-first load.
  const { categories } = useCategories();
  // Header avatar initials — the signed-in user's own, derived from the
  // stored session (and from GET /users/me once something has loaded it), no
  // longer src/mocks/profileMocks.js's static placeholder. Deliberately does
  // NOT trigger a profile request: this screen is the post-auth landing
  // surface, and the session already carries the name it needs.
  const identity = useUserIdentity();
  const styles = createStyles(theme, insets);

  // MONTHLY BUDGET — docs/decisions/0010-budget-settings.md §8.1. Dashboard
  // is only ever reached (per the post-auth gate, docs/decisions/
  // 0011-post-auth-budget-gate.md) once a valid, non-ended, funded
  // activePeriod exists, so activePeriod is expected non-null here — the
  // `?? 0` fallbacks below are a defensive guard only (constitution §22),
  // not the expected path.
  const monthlyBudget = activePeriod?.amount ?? 0;

  // spent — docs/decisions/0010-budget-settings.md §8.2: sum of expense
  // transactions whose date falls within the active period's date range.
  // No scope/viewMode filtering, mirroring this card's existing,
  // already-documented "intentionally NOT scoped by viewMode" convention.
  const spent = useMemo(
    () => computeSpentForPeriod(transactions, activePeriod),
    [transactions, activePeriod],
  );

  // remaining — docs/decisions/0010-budget-settings.md §8.3. Can go
  // negative (overspending) — the existing isOverBudget/overspendingWarning
  // logic below already handles that.
  const remaining = monthlyBudget - spent;

  // dailyAverage — docs/decisions/0010-budget-settings.md §8.4.
  const dailyAverage = useMemo(() => {
    if (!activePeriod) {
      return 0;
    }
    return spent / getDaysElapsedInPeriod(activePeriod);
  }, [spent, activePeriod]);

  const progress = monthlyBudget > 0 ? spent / monthlyBudget : 0;

  const { currencySymbol } = dashboardSummary;
  const isOverBudget = progress >= 1;

  // Filters the transaction list by the active Personal/Group segment. The
  // budget/remaining/daily-avg summary card is intentionally NOT scoped by
  // viewMode — only the transaction list below it changes.
  const filteredTransactions = useMemo(
    () => transactions.filter(transaction => transaction.scope === viewMode),
    [transactions, viewMode],
  );

  // Date-wise sections: a day header (with that day's income/expense totals)
  // followed by the day's rows, newest day first.
  const daySections = useMemo(
    () => groupTransactionsByDay(filteredTransactions),
    [filteredTransactions],
  );

  // Cash / Online breakdown of this period's spend. Same expense-in-period
  // rule as `spent`, so the two rows always add up to it. The previous
  // derivation (`monthlyBudget − mode spend`, over all dates, income netted)
  // started each row at the full budget, so neither row nor their sum meant
  // anything.
  const spentByMode = useMemo(
    () => computeSpentByPaymentModeForPeriod(transactions, activePeriod),
    [transactions, activePeriod],
  );

  // Per-category cap warnings — one per capped category at or past
  // WARNING_THRESHOLD of its cap, gated on the same Overspending Alerts
  // setting as the budget-level banner.
  const categoryCapWarnings = useMemo(
    () =>
      computeCategoryCapUsage(transactions, activePeriod, categories)
        .filter(usage => usage.spent >= usage.monthlyCap * WARNING_THRESHOLD)
        .map(usage => {
          const isOver = usage.spent > usage.monthlyCap;
          return {
            categoryId: usage.categoryId,
            isOver,
            message: isOver
              ? `${
                  usage.categoryName
                }: over its ${currencySymbol}${usage.monthlyCap.toLocaleString(
                  'en-IN',
                )} cap by ${currencySymbol}${(
                  usage.spent - usage.monthlyCap
                ).toLocaleString('en-IN')}.`
              : `${usage.categoryName}: ${Math.round(
                  (usage.spent / usage.monthlyCap) * 100,
                )}% of its ${currencySymbol}${usage.monthlyCap.toLocaleString(
                  'en-IN',
                )} cap used.`,
          };
        }),
    [transactions, activePeriod, categories, currencySymbol],
  );

  // Meaningful, percentage-aware copy — see constitution Section 22
  // (frontend error/warning messages must be clear, never generic).
  const overspendingWarning = useMemo(() => {
    if (isOverBudget) {
      const overspendAmount = spent - monthlyBudget;
      return `You've exceeded your monthly budget by ${currencySymbol}${overspendAmount.toLocaleString(
        'en-IN',
      )}.`;
    }
    if (progress >= WARNING_THRESHOLD) {
      const spentPercent = Math.round(progress * 100);
      return `You've used ${spentPercent}% of your monthly budget — pace yourself for the rest of the month.`;
    }
    return null;
  }, [progress, isOverBudget, currencySymbol, spent, monthlyBudget]);

  // Cross-fade on the transaction list content (section header + rows) when
  // the Personal/Group toggle changes, layered on top of the real data
  // filter above so the list swap doesn't feel like an abrupt content jump.
  const contentOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    contentOpacity.setValue(0);
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: CONTENT_FADE_DURATION,
      useNativeDriver: true,
    }).start();
  }, [viewMode, contentOpacity]);

  return (
    <View style={styles.flex}>
      {selection.isSelecting ? (
        // Selection mode: back (top-left) leaves it, delete (top-right) asks
        // for confirmation, the title counts the selection.
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
        <ScreenHeader
          title="MyExpense"
          align="left"
          rightSlot={
            <>
              <NotificationBell />
              <ThemeToggleButton />
              <Avatar
                initials={identity.initials}
                size="small"
                onPress={() => navigation.navigate('ProfileTab')}
              />
            </>
          }
        />
      )}
      {selection.deleteError ? (
        <InlineMessage message={selection.deleteError} />
      ) : null}

      <SectionList
        // Fabric view-identity guard: FlatList defaults this to true on
        // Android, which attaches and detaches children outside Fabric's
        // own insert/remove instructions and can produce
        // "addViewAt ... child already has a parent" crashes.
        removeClippedSubviews={false}
        sections={daySections}
        keyExtractor={item => item.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Animated.View style={{ opacity: contentOpacity }}>
            <TransactionDayHeader
              section={section}
              currencySymbol={currencySymbol}
            />
          </Animated.View>
        )}
        contentContainerStyle={styles.listContent}
        // Pagination (§4.1). `onEndReachedThreshold` is deliberately small:
        // the next page is one request, not a prefetch budget, and the store
        // ignores the call while a read is in flight or the last page is
        // already held — so a fast scroll cannot stack up requests.
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <TransactionsPlaceholder
            styles={styles}
            hasLoaded={hasLoaded}
            isLoading={isLoading}
            loadError={loadError}
            onRetry={reload}
          />
        }
        ListFooterComponent={
          // Pagination state, below the rows rather than over them: a failed
          // next page must never blank a list the user is already reading
          // (constitution §22 — and the rows on screen are still correct).
          <>
            {isLoadingMore ? (
              <Text style={styles.statusText}>Loading more transactions…</Text>
            ) : null}
            {loadMoreError ? (
              <InlineMessage message={loadMoreError} onRetry={loadMore} />
            ) : null}
          </>
        }
        ListHeaderComponent={
          <>
            <Card style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>MONTHLY BUDGET</Text>
              <Text style={styles.summaryAmount}>
                {currencySymbol}
                {monthlyBudget.toLocaleString('en-IN')}
              </Text>
              <Text style={styles.spentLine}>
                {currencySymbol}
                {spent.toLocaleString('en-IN')} spent of {currencySymbol}
                {monthlyBudget.toLocaleString('en-IN')}
              </Text>
              <ProgressBar progress={progress} style={styles.progressBar} />

              {/* Spent by mode — always shown. Cash / Online / Split rows sum
                  to the "spent" line above (computeSpentByPaymentModeForPeriod).
                  The Payment Mode setting only controls whether Add Expense
                  asks cash vs online. */}
              <View style={styles.remainingCard}>
                <Text style={styles.summaryLabel}>SPENT BY MODE</Text>
                {[
                  { label: 'Cash', value: spentByMode.cash },
                  { label: 'Online', value: spentByMode.online },
                  { label: 'Split', value: spentByMode.split },
                ].map(row => (
                  <View key={row.label} style={styles.remainingRow}>
                    <Text style={styles.remainingRowLabel}>{row.label}</Text>
                    <Text style={styles.statValue}>
                      {currencySymbol}
                      {row.value.toLocaleString('en-IN', {
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Stat row — REMAINING / DAILY AVG only. No "Savings" entry,
                  in any state, live or otherwise (docs/decisions/
                  0010-budget-settings.md's second same-day amendment, §A) —
                  Savings is reintroduced only as a one-time retrospective on
                  BudgetSummaryScreen, shown separately when a period ends. */}
              <View style={styles.statRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>REMAINING</Text>
                  <Text style={styles.statValuePositive}>
                    {currencySymbol}
                    {remaining.toLocaleString('en-IN')}
                  </Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>DAILY AVG</Text>
                  <Text style={styles.statValue}>
                    {currencySymbol}
                    {dailyAverage.toLocaleString('en-IN', {
                      maximumFractionDigits: 0,
                    })}
                  </Text>
                </View>
              </View>

              {overspendingAlertsEnabled && overspendingWarning ? (
                <View
                  style={[
                    styles.warningBanner,
                    isOverBudget
                      ? styles.warningBannerNegative
                      : styles.warningBannerWarning,
                  ]}
                >
                  <Text
                    style={[
                      styles.warningText,
                      isOverBudget
                        ? styles.warningTextNegative
                        : styles.warningTextWarning,
                    ]}
                  >
                    {overspendingWarning}
                  </Text>
                </View>
              ) : null}

              {overspendingAlertsEnabled
                ? categoryCapWarnings.map(warning => (
                    <View
                      key={warning.categoryId}
                      style={[
                        styles.warningBanner,
                        warning.isOver
                          ? styles.warningBannerNegative
                          : styles.warningBannerWarning,
                      ]}
                    >
                      <Text
                        style={[
                          styles.warningText,
                          warning.isOver
                            ? styles.warningTextNegative
                            : styles.warningTextWarning,
                        ]}
                      >
                        {warning.message}
                      </Text>
                    </View>
                  ))
                : null}
            </Card>

            <SegmentedControl
              options={VIEW_OPTIONS}
              value={viewMode}
              onChange={value => {
                // Selection is scoped to the visible list; switching tabs
                // drops it rather than deleting rows the user cannot see.
                selection.clear();
                setViewMode(value);
              }}
              style={styles.segmentedControl}
            />

            <Animated.View style={{ opacity: contentOpacity }}>
              <Text style={styles.sectionHeader}>Recent Transactions</Text>
            </Animated.View>
          </>
        }
        renderItem={({ item }) => {
          // The date lives in the day header now, so the subtitle is the
          // category path (`Food > Snacks`, composed from the server's two
          // snapshot fields — ADR 0019 §6.2) plus the group name for a group
          // row.
          const groupName =
            item.scope === 'group'
              ? groups.find(group => group.id === item.groupId)?.name
              : null;
          const categoryLabel = formatCategoryPath(
            item.parentCategoryName,
            item.categoryName,
          );
          const subtitle = groupName
            ? `${categoryLabel} • ${groupName}`
            : categoryLabel;

          // One "how it was paid" badge per expense row. A split-originated
          // row (the caller's share, written by the server) is SPLIT — its
          // stored paymentMode is only a NOT NULL placeholder and showing
          // "CASH" there was misleading. Other expenses show their payment
          // mode when Payment Mode tracking is on.
          const badges = [
            item.splitExpenseId
              ? 'SPLIT'
              : paymentModeEnabled &&
                item.type === 'expense' &&
                item.paymentMode
              ? item.paymentMode.toUpperCase()
              : null,
            // A row still in the offline queue (ADR 0027 §8.8): "Waiting to
            // sync" / "Couldn't sync", in the same badge slot.
            describeLocalSyncStatus(item.localSyncStatus)?.toUpperCase() ??
              null,
          ].filter(Boolean);

          return (
            <Animated.View style={{ opacity: contentOpacity }}>
              <ListItem
                leading={
                  selection.isSelecting ? (
                    <Checkbox checked={selection.selectedIds.has(item.id)} />
                  ) : (
                    <IconBadge
                      glyph={item.categoryGlyph}
                      tone={item.categoryTone}
                    />
                  )
                }
                selected={selection.selectedIds.has(item.id)}
                onLongPress={() => selection.startSelection(item.id)}
                title={item.title}
                subtitle={subtitle}
                badges={badges}
                trailingText={`${
                  item.type === 'income' ? '+' : '-'
                }${currencySymbol}${item.amount.toLocaleString('en-IN')}`}
                trailingTone={item.type === 'income' ? 'positive' : 'negative'}
                // Drill-down to Transaction Detail — a plain stack push
                // within this same tab's stack, not a modal (docs/decisions/
                // 0007-transaction-detail-screen.md §8/§9). ListItem already
                // supports onPress (wraps content in a Pressable with the
                // existing pressed-opacity feedback) — no component change
                // needed, no new visual affordance introduced.
                // In selection mode a tap toggles the row instead.
                onPress={() =>
                  selection.isSelecting
                    ? selection.toggle(item.id)
                    : navigation.navigate('TransactionDetail', {
                        transactionId: item.id,
                      })
                }
              />
            </Animated.View>
          );
        }}
      />

      {selection.isSelecting ? null : (
        <FloatingActionButton
          onPress={() => navigation.navigate('AddExpense')}
        />
      )}

      <ConfirmationDialog
        visible={isBulkDeleteDialogVisible}
        title={
          selectedCount === 1
            ? 'Delete Transaction'
            : `Delete ${selectedCount} Transactions`
        }
        message={`Are you sure you want to delete ${
          selectedCount === 1
            ? 'this transaction'
            : `these ${selectedCount} transactions`
        }? This cannot be undone.`}
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
 * What stands in for the rows when there are none — the three states a
 * server-backed list has, kept apart on purpose (constitution §22).
 *
 * **A failed read must never render the empty state.** "No transactions yet —
 * tap + to add your first expense" in front of a user who has a year of
 * history, because a request timed out, is the most misleading thing this
 * screen could say; it invites them to re-enter data they already have. So a
 * failure says so and offers Retry, and the cheerful empty state is reserved
 * for a read that actually succeeded and came back empty.
 *
 * Renders under the summary card / segmented control / section header (all
 * part of `ListHeaderComponent`), not in place of them — unchanged from the
 * mock-era empty state, which is also where the glyph and copy come from
 * (docs/ui/design-system.md §18.1).
 */
function TransactionsPlaceholder({
  styles,
  hasLoaded,
  isLoading,
  loadError,
  onRetry,
}) {
  if (!hasLoaded && isLoading) {
    return <Text style={styles.statusText}>Loading transactions…</Text>;
  }

  if (!hasLoaded && loadError) {
    return <InlineMessage message={loadError} onRetry={onRetry} />;
  }

  if (!hasLoaded) {
    // Neither loading, nor failed, nor loaded: the one-render gap before the
    // load effect fires. Deliberately blank rather than flashing either the
    // empty state or a spinner.
    return null;
  }

  return (
    <View style={styles.emptyState}>
      <IconBadge glyph="₹" tone="neutral" size="large" />
      <Text style={styles.emptyStateText}>
        No transactions yet — tap + to add your first expense.
      </Text>
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
      // This screen renders behind both the floating tab bar AND the FAB
      // (see MainTabs.jsx / FloatingActionButton.jsx) — the FAB sits higher
      // off the screen bottom than the tab bar, so its top edge is the one
      // that must be cleared. `getFabTopEdge(theme, insets)` (theme/layout.js)
      // is `getFabBottomOffset` (theme.space.xxxl * 3 = 96, plus the bottom
      // safe-area inset) + FAB_COLLAPSED_SIZE (56) above the screen bottom;
      // adding `theme.space.lg` (16px) leaves a comfortable gap above that
      // edge instead of just grazing it — computed from the same constants
      // the FAB itself is positioned with, including the same inset, so this
      // can't silently drift out of sync on a device with a navigation bar.
      paddingBottom: getFabTopEdge(theme, insets) + theme.space.lg,
    },
    summaryCard: {
      marginBottom: theme.space.xl,
    },
    summaryLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    summaryAmount: {
      color: theme.color.text.primary,
      fontSize: theme.type.display.fontSize,
      lineHeight: theme.type.display.lineHeight,
      fontWeight: theme.type.display.fontWeight,
    },
    spentLine: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.md,
    },
    progressBar: {
      marginBottom: theme.space.lg,
    },
    // Compact "Remaining" card (docs/decisions/
    // 0003-payment-mode-and-date-tracking.md's 2026-08-10 Amendment, Part
    // B) — same background.surfaceAlt/radius.md/space.lg-horizontal/
    // space.md-vertical token combination already used by AddExpenseScreen's
    // groupList, reused here for a consistent "nested block within a card"
    // treatment rather than a new visual style.
    remainingCard: {
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.md,
      marginBottom: theme.space.lg,
    },
    remainingRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: theme.space.xs,
    },
    remainingRowLabel: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    statItem: {
      flex: 1,
    },
    statLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    statValue: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    statValuePositive: {
      color: theme.color.status.positive,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    warningBanner: {
      marginTop: theme.space.lg,
      paddingVertical: theme.space.sm,
      paddingHorizontal: theme.space.md,
      borderRadius: theme.radius.sm,
      borderLeftWidth: 3,
      backgroundColor: theme.color.background.surfaceAlt,
    },
    warningBannerWarning: {
      borderLeftColor: theme.color.status.warning,
    },
    warningBannerNegative: {
      borderLeftColor: theme.color.status.negative,
    },
    warningText: {
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    warningTextWarning: {
      color: theme.color.status.warning,
    },
    warningTextNegative: {
      color: theme.color.status.negative,
    },
    segmentedControl: {
      marginBottom: theme.space.xxl,
    },
    sectionHeader: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      marginBottom: theme.space.md,
    },
    emptyState: {
      alignItems: 'center',
      paddingVertical: theme.space.xxxl,
    },
    // Load/pagination status copy — the same `text.secondary` body treatment
    // CategoryPickerScreen's own "Loading categories…" line uses, so the two
    // server-backed lists read identically.
    statusText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      paddingVertical: theme.space.lg,
    },
    emptyStateText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      marginTop: theme.space.md,
    },
  });
}

export default DashboardScreen;
