import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { getFabTopEdge } from '../../theme/layout';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTransactionsStore } from '../../store/useTransactionsStore';
import { useGroupsStore } from '../../store/useGroupsStore';
import { useBudgetStore } from '../../store/useBudgetStore';
import { getDateDisplayLabel } from '../../utils/dateDisplay';
import { getDaysElapsedInPeriod, computeSpentForPeriod } from '../../utils/budgetPeriod';
import ScreenHeader from '../../components/ScreenHeader';
import ThemeToggleButton from '../../components/ThemeToggleButton';
import NotificationBell from '../../components/NotificationBell';
import Avatar from '../../components/Avatar';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';
import SegmentedControl from '../../components/SegmentedControl';
import ProgressBar from '../../components/ProgressBar';
import FloatingActionButton from '../../components/FloatingActionButton';
import { dashboardSummary } from '../../mocks/dashboardMocks';
import { profileUser } from '../../mocks/profileMocks';

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
 */
function DashboardScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const [viewMode, setViewMode] = useState('personal');
  const overspendingAlertsEnabled = useSettingsStore((state) => state.overspendingAlertsEnabled);
  const paymentModeEnabled = useSettingsStore((state) => state.paymentModeEnabled);
  const transactions = useTransactionsStore((state) => state.transactions);
  const groups = useGroupsStore((state) => state.groups);
  const activePeriod = useBudgetStore((state) => state.activePeriod);
  const styles = createStyles(theme);

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
    () => transactions.filter((transaction) => transaction.scope === viewMode),
    [transactions, viewMode],
  );

  // Remaining Cash / Remaining Online — derivation per
  // docs/decisions/0003-payment-mode-and-date-tracking.md, as updated by its
  // 2026-08-10 "Debit/Credit Entry Type" Amendment (Part C, which supersedes
  // both the original formula and the earlier same-day Amendment's Part B
  // formula): sums over ALL transactions — expense AND income, no longer
  // filtered to type === 'expense' — regardless of scope/date (mirrors the
  // existing summary card's deliberately-unscoped convention, see the
  // comment above), both measured against monthlyBudget
  // (useBudgetStore().activePeriod.amount, per docs/decisions/
  // 0010-budget-settings.md §9 — the budget source changed, but this
  // derivation stays deliberately unfiltered by date otherwise). A credit
  // (type: 'income') transaction nets AGAINST that
  // mode's spend (sign = -1) rather than adding to it, since it represents
  // real money returning to that payment lens (a cash refund/credit
  // increases remaining cash, symmetric with how a cash expense decreases
  // it) — an expense contributes with sign = +1, exactly as before.
  // 'both'-mode transactions still use their real cashAmount/onlineAmount
  // split (earlier Amendment Part A) instead of a 50/50 estimate — the
  // 50/50 split is retained only as a defensive fallback for a 'both'
  // record somehow missing its split fields (e.g. stale pre-migration
  // data), which should not occur post-migration but must not throw if it
  // does (constitution Section 22). This only affects what's computed here
  // — display is separately gated on paymentModeEnabled below, so toggling
  // the Profile setting doesn't need to recompute anything, just show/hide
  // it.
  const { remainingCash, remainingOnline } = useMemo(() => {
    let cashSpend = 0;
    let onlineSpend = 0;

    transactions.forEach((transaction) => {
      const sign = transaction.type === 'income' ? -1 : 1;

      if (transaction.paymentMode === 'cash') {
        cashSpend += sign * transaction.amount;
      } else if (transaction.paymentMode === 'online') {
        onlineSpend += sign * transaction.amount;
      } else if (transaction.paymentMode === 'both') {
        cashSpend +=
          sign * (transaction.cashAmount != null ? transaction.cashAmount : transaction.amount * 0.5);
        onlineSpend +=
          sign * (transaction.onlineAmount != null ? transaction.onlineAmount : transaction.amount * 0.5);
      }
      // Rows with no paymentMode value (shouldn't occur post-migration)
      // fall through and contribute 0 to both — fails gracefully per
      // constitution Section 22, rather than throwing.
    });

    return {
      remainingCash: monthlyBudget - cashSpend,
      remainingOnline: monthlyBudget - onlineSpend,
    };
  }, [transactions, monthlyBudget]);

  // Meaningful, percentage-aware copy — see constitution Section 22
  // (frontend error/warning messages must be clear, never generic).
  const overspendingWarning = useMemo(() => {
    if (isOverBudget) {
      const overspendAmount = spent - monthlyBudget;
      return `You've exceeded your monthly budget by ${currencySymbol}${overspendAmount.toLocaleString('en-IN')}.`;
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
      <ScreenHeader
        title="MyExpense"
        align="left"
        rightSlot={
          <>
            <NotificationBell />
            <ThemeToggleButton />
            <Avatar
              initials={profileUser.initials}
              size="small"
              onPress={() => navigation.navigate('ProfileTab')}
            />
          </>
        }
      />

      <FlatList
        data={filteredTransactions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          // Zero transactions in the active Personal/Group filter —
          // docs/ui/design-system.md §18.1. Renders under the summary
          // card/segmented control/section header (all still part of
          // ListHeaderComponent below), not in place of them.
          <View style={styles.emptyState}>
            <IconBadge glyph="₹" tone="neutral" size="large" />
            <Text style={styles.emptyStateText}>
              No transactions yet — tap + to add your first expense.
            </Text>
          </View>
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

              {/* Compact "Remaining" card — docs/decisions/
                  0003-payment-mode-and-date-tracking.md's 2026-08-10
                  Amendment, Part B. Replaces the old top-level REMAINING
                  stat item entirely when paymentModeEnabled is true, sitting
                  in that item's exact old layout slot (directly after the
                  progress bar, before the row that now holds only DAILY
                  AVG). Deliberately a plain block (not a nested Card)
                  reusing the same background.surfaceAlt/radius.md token
                  combination as the GROUP field's inline list in
                  AddExpenseScreen, per the ADR. Total is the derived
                  `remaining` value unchanged — NOT remainingCash +
                  remainingOnline, which would double-count the shared
                  monthlyBudget (see the ADR's correctness note); all three
                  rows carry equal visual weight on purpose so Total doesn't
                  visually read as "the sum of the two above it". */}
              {paymentModeEnabled ? (
                <View style={styles.remainingCard}>
                  <Text style={styles.summaryLabel}>REMAINING</Text>
                  <View style={styles.remainingRow}>
                    <Text style={styles.remainingRowLabel}>Cash</Text>
                    <Text style={styles.statValuePositive}>
                      {currencySymbol}
                      {remainingCash.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </Text>
                  </View>
                  <View style={styles.remainingRow}>
                    <Text style={styles.remainingRowLabel}>Online</Text>
                    <Text style={styles.statValuePositive}>
                      {currencySymbol}
                      {remainingOnline.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </Text>
                  </View>
                  <View style={styles.remainingRow}>
                    <Text style={styles.remainingRowLabel}>Total</Text>
                    <Text style={styles.statValuePositive}>
                      {currencySymbol}
                      {remaining.toLocaleString('en-IN')}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Stat row — REMAINING / DAILY AVG only. No "Savings" entry,
                  in any state, live or otherwise (docs/decisions/
                  0010-budget-settings.md's second same-day amendment, §A) —
                  Savings is reintroduced only as a one-time retrospective on
                  BudgetSummaryScreen, shown separately when a period ends. */}
              <View style={styles.statRow}>
                {!paymentModeEnabled ? (
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>REMAINING</Text>
                    <Text style={styles.statValuePositive}>
                      {currencySymbol}
                      {remaining.toLocaleString('en-IN')}
                    </Text>
                  </View>
                ) : null}
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
                    isOverBudget ? styles.warningBannerNegative : styles.warningBannerWarning,
                  ]}
                >
                  <Text
                    style={[
                      styles.warningText,
                      isOverBudget ? styles.warningTextNegative : styles.warningTextWarning,
                    ]}
                  >
                    {overspendingWarning}
                  </Text>
                </View>
              ) : null}
            </Card>

            <SegmentedControl
              options={VIEW_OPTIONS}
              value={viewMode}
              onChange={setViewMode}
              style={styles.segmentedControl}
            />

            <Animated.View style={{ opacity: contentOpacity }}>
              <Text style={styles.sectionHeader}>Recent Transactions</Text>
            </Animated.View>
          </>
        }
        renderItem={({ item }) => {
          // Date label is computed live from the stored YYYY-MM-DD value
          // (src/utils/dateDisplay.js) rather than read from a frozen
          // label, so it stays correct as "today" moves forward.
          const dateLabel = getDateDisplayLabel(item.date);

          // Group name is derived via a useGroupsStore lookup, not stored
          // on the transaction (docs/decisions/0003-payment-mode-and-date-tracking.md
          // Section 2) — a plain .find() per row is fine at this mock scale
          // (single-digit groups), per the ADR's own note not to
          // preemptively build a Map for a lookup this cheap.
          const groupName =
            item.scope === 'group'
              ? groups.find((group) => group.id === item.groupId)?.name
              : null;

          const subtitle = groupName
            ? `${item.category} • ${dateLabel} • ${groupName}`
            : `${item.category} • ${dateLabel}`;

          // Ordered, fixed-position badge list (docs/decisions/
          // 0006-contact-group-search-and-split-tag.md §5) — payment-mode
          // badge first, "SPLIT" badge second, both eligible to render
          // together on the same row (a Split-originated expense always
          // carries a paymentMode, exactly like any other expense).
          const badges = [
            paymentModeEnabled && item.type === 'expense' && item.paymentMode
              ? item.paymentMode.toUpperCase()
              : null,
            item.splitExpenseId ? 'SPLIT' : null,
          ].filter(Boolean);

          return (
            <Animated.View style={{ opacity: contentOpacity }}>
              <ListItem
                leading={<IconBadge glyph={item.glyph} tone={item.tone} />}
                title={item.title}
                subtitle={subtitle}
                badges={badges}
                trailingText={`${item.type === 'income' ? '+' : '-'}${currencySymbol}${item.amount.toLocaleString('en-IN')}`}
                trailingTone={item.type === 'income' ? 'positive' : 'negative'}
                // Drill-down to Transaction Detail — a plain stack push
                // within this same tab's stack, not a modal (docs/decisions/
                // 0007-transaction-detail-screen.md §8/§9). ListItem already
                // supports onPress (wraps content in a Pressable with the
                // existing pressed-opacity feedback) — no component change
                // needed, no new visual affordance introduced.
                onPress={() => navigation.navigate('TransactionDetail', { transactionId: item.id })}
              />
            </Animated.View>
          );
        }}
      />

      <FloatingActionButton onPress={() => navigation.navigate('AddExpense')} />
    </View>
  );
}

function createStyles(theme) {
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
      // that must be cleared. `getFabTopEdge(theme)` (theme/layout.js) is
      // `getFabBottomOffset` (theme.space.xxxl * 3 = 96) + FAB_COLLAPSED_SIZE
      // (56) = 152px above the screen bottom; adding `theme.space.lg` (16px)
      // leaves a comfortable gap above that edge instead of just grazing it,
      // for a total of 168px — computed from the same constants the FAB
      // itself is positioned with, so this can't silently drift out of sync.
      paddingBottom: getFabTopEdge(theme) + theme.space.lg,
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
