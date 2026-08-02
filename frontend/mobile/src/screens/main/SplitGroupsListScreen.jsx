import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getFabTopEdge } from '../../theme/layout';
import { useGroups } from '../../hooks/useGroups';
import { useIndividualBalances } from '../../hooks/useIndividualBalances';
import ScreenHeader from '../../components/ScreenHeader';
import ThemeToggleButton from '../../components/ThemeToggleButton';
import NotificationBell from '../../components/NotificationBell';
import Avatar from '../../components/Avatar';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';
import InlineMessage from '../../components/InlineMessage';
import PrimaryButton from '../../components/PrimaryButton';
import SegmentedControl from '../../components/SegmentedControl';
import FloatingActionButton from '../../components/FloatingActionButton';
import BalanceSummary from '../../components/BalanceSummary';
import { buildSplitCardSummary } from '../../utils/balanceCopy';
import { splitSummary } from '../../mocks/splitMocks';
import { useUserIdentity } from '../../hooks/useUserIdentity';
import { getBalanceTrailing } from '../../utils/splitCalculations';
import { labelEstimatedTrailing } from '../../utils/syncDisplay';
import { describeBalanceUpdatedAt, describeGroupSubtitle, summarizeSplitBalances } from '../../utils/splitBalances';

// New local const, independent of Dashboard's VIEW_OPTIONS and Add
// Expense's TYPE_OPTIONS — see docs/decisions/0004-split-individual-tab.md
// §1/§4. "Individual" is scoped to this one tab switcher only.
const SPLIT_TABS = [
  { label: 'Individual', value: 'individual' },
  { label: 'Group', value: 'group' },
];

// Duration (ms) of the cross-fade applied to the list content (section
// header + rows) whenever the Individual/Group tab changes — reuses
// Dashboard's exact CONTENT_FADE_DURATION value (DashboardScreen.jsx) per
// ADR 0004 §5; not re-derived or re-tuned for this screen.
const CONTENT_FADE_DURATION = 220;

/**
 * Split screen — total owe/owed summary, an Individual/Group tab switcher,
 * and the active tab's list.
 *
 * **Server-backed as of Domain 6's wiring step.** Both tabs read real data:
 * `GET /api/v1/splits/individuals` (docs/api/api-overview.md §8.1, as corrected
 * by docs/decisions/0023-shared-ledger-contract-corrections.md §1) and
 * `GET /api/v1/groups` (§7.1), through `useIndividualBalances`/`useGroups`,
 * which are also the load triggers. The four seeded individual entries and
 * three seeded groups are gone; `src/mocks/splitMocks.js` now supplies only the
 * currency symbol, exactly as `dashboardMocks` does for the wired Dashboard and
 * Statistics screens.
 *
 * ---
 * **THE SUMMARY CARDS ARE DERIVED, AND THEY NEED BOTH READS.**
 *
 * "YOU OWE" / "YOU ARE OWED" are sums over **both** lists
 * (`utils/splitBalances.js`), which is legitimate because neither endpoint is
 * paginated — these are totals over complete lists, not over a page (the error
 * ADR 0022 §6 names). They are therefore rendered **only once both reads have
 * succeeded**: a total missing one of its two inputs would be a wrong number
 * under a confident label, and this is a statement about the user's money.
 *
 * **No balance is negated anywhere on this screen.** Both `balance` (§8.1) and
 * `yourBalance` (§7.1) arrive already oriented to the caller — positive = owed,
 * negative = owing — with the pairwise sign flipped once, server-side, when the
 * caller is the canonical counterpart of the pair (ADR 0023 §1.4). A second
 * flip here would show every debt backwards and look plausible doing it.
 *
 * ---
 * **A FAILED READ IS NEVER THE EMPTY STATE.** `TabPlaceholder` keeps loading,
 * failure and genuine-zero apart. "No individual splits yet" in front of a user
 * who is owed ₹450, because a request timed out, is a lie about their finances
 * (constitution §22) — so a failure says so and offers Retry.
 *
 * FAB (docs/decisions/0005-split-add-expense-flow.md §1): opens the Split Add
 * Expense flow, hinting the currently-active tab as `initialSplitMode`.
 */
function SplitGroupsListScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const {
    balances,
    hasLoaded: hasLoadedBalances,
    isLoading: isLoadingBalances,
    loadError: balancesError,
    reload: reloadBalances,
  } = useIndividualBalances();
  const {
    groups,
    hasLoaded: hasLoadedGroups,
    isLoading: isLoadingGroups,
    loadError: groupsError,
    reload: reloadGroups,
  } = useGroups();
  const [activeTab, setActiveTab] = useState('individual');
  // Header avatar initials — the signed-in user's own (see
  // src/hooks/useUserIdentity.js); no profile request is triggered from here.
  const identity = useUserIdentity();
  const styles = createStyles(theme, insets);
  const { currencySymbol } = splitSummary;

  // Cross-fade on the list content (section header + rows) when the
  // Individual/Group tab changes — identical mechanism to Dashboard's
  // Personal/Group toggle fade (see DashboardScreen.jsx).
  const contentOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    contentOpacity.setValue(0);
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: CONTENT_FADE_DURATION,
      useNativeDriver: true,
    }).start();
  }, [activeTab, contentOpacity]);

  const isIndividual = activeTab === 'individual';
  const listData = isIndividual ? balances : groups;

  const { totalYouOwe, totalYouAreOwed } = useMemo(
    () => summarizeSplitBalances({ balances, groups }),
    [balances, groups],
  );

  // Both figures come from both lists, so both reads have to have landed
  // before either figure can be shown.
  const hasLoadedSummary = hasLoadedBalances && hasLoadedGroups;
  const summaryError = balancesError ?? groupsError;

  const reloadBoth = useCallback(() => {
    reloadBalances();
    reloadGroups();
  }, [reloadBalances, reloadGroups]);

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Split"
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

      <FlatList
        // Fabric view-identity guard: FlatList defaults this to true on
        // Android, which attaches and detaches children outside Fabric's
        // own insert/remove instructions and can produce
        // "addViewAt ... child already has a parent" crashes.
        removeClippedSubviews={false}
        data={listData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <TabPlaceholder
            styles={styles}
            isIndividual={isIndividual}
            hasLoaded={isIndividual ? hasLoadedBalances : hasLoadedGroups}
            isLoading={isIndividual ? isLoadingBalances : isLoadingGroups}
            loadError={isIndividual ? balancesError : groupsError}
            onRetry={isIndividual ? reloadBalances : reloadGroups}
          />
        }
        ListHeaderComponent={
          <>
            {hasLoadedSummary ? (
              <View style={styles.summaryRow}>
                <Card style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>YOU OWE</Text>
                  <Text style={styles.summaryAmountNegative}>
                    {currencySymbol}
                    {totalYouOwe.toLocaleString('en-IN')}
                  </Text>
                </Card>
                <Card style={[styles.summaryCard, styles.summaryCardLast]}>
                  <Text style={styles.summaryLabel}>YOU ARE OWED</Text>
                  <Text style={styles.summaryAmountPositive}>
                    {currencySymbol}
                    {totalYouAreOwed.toLocaleString('en-IN')}
                  </Text>
                </Card>
              </View>
            ) : (
              // One retry covers both reads, because one figure needs both.
              <SummaryPlaceholder
                styles={styles}
                loadError={summaryError}
                onRetry={reloadBoth}
              />
            )}

            <SegmentedControl
              options={SPLIT_TABS}
              value={activeTab}
              onChange={setActiveTab}
              style={styles.segmentedControl}
            />

            <Animated.View style={{ opacity: contentOpacity }}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>
                  {isIndividual ? 'Individual Splits' : 'Active Groups'}
                </Text>
                {!isIndividual ? (
                  <PrimaryButton
                    label="New Group"
                    glow={false}
                    onPress={() => navigation.navigate('NewGroup')}
                    style={styles.newGroupButton}
                  />
                ) : null}
              </View>
            </Animated.View>
          </>
        }
        renderItem={({ item }) => {
          // `balance`/`yourBalance` are used exactly as the server states
          // them — see this file's header note on why nothing is negated.
          // A row the offline overlay estimated gets "≈" and
          // "Estimated · n change(s) waiting to sync" (ADR 0027 §8.8).
          const { trailingText, trailingSubtext, trailingTone } = labelEstimatedTrailing(
            getBalanceTrailing(isIndividual ? item.balance : item.yourBalance, currencySymbol),
            item,
          );
          // "Raj owes you ₹250" / the group summary + the viewer's own debts
          // (docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §9.2).
          const cardSummary = buildSplitCardSummary({
            isIndividual,
            item,
            me: identity.userId,
            symbol: currencySymbol,
          });

          if (isIndividual) {
            return (
              <Animated.View style={{ opacity: contentOpacity }}>
                <Card style={styles.groupCard}>
                  <ListItem
                    leading={
                      <IconBadge
                        glyph={item.counterpartName.charAt(0)}
                        tone="neutral"
                        size="large"
                      />
                    }
                    title={item.counterpartName}
                    // §8.1 states no activity summary — `updatedAt` is the only
                    // temporal fact it carries, so that is what is shown rather
                    // than an invented "Dinner split • 3 days ago".
                    subtitle={describeBalanceUpdatedAt(item.updatedAt)}
                    trailingText={trailingText}
                    trailingSubtext={trailingSubtext}
                    trailingTone={trailingTone}
                    onPress={() =>
                      navigation.navigate('SplitDetail', {
                        mode: 'individual',
                        // The `individual_balances` row id — what §9.3 filters
                        // by and §10.1 settles.
                        individualBalanceId: item.id,
                      })
                    }
                  />
                  <BalanceSummary summary={cardSummary} size="small" style={styles.cardSummary} />
                </Card>
              </Animated.View>
            );
          }

          return (
            <Animated.View style={{ opacity: contentOpacity }}>
              <Card style={styles.groupCard}>
                <ListItem
                  leading={<IconBadge glyph={item.name.charAt(0)} tone="neutral" size="large" />}
                  title={item.name}
                  // The creator is already in `members[]` (§7.1), so the count
                  // is `members.length` — not the mock shape's +1 — and
                  // `lastActivity` is only appended when it is populated, which
                  // the backend never does today.
                  subtitle={describeGroupSubtitle(item)}
                  trailingText={trailingText}
                  trailingSubtext={trailingSubtext}
                  trailingTone={trailingTone}
                  onPress={() => navigation.navigate('SplitDetail', { mode: 'group', groupId: item.id })}
                />
                <BalanceSummary
                  summary={cardSummary}
                  size="small"
                  style={styles.cardSummary}
                  onPressMore={() => navigation.navigate('SplitDetail', { mode: 'group', groupId: item.id })}
                />
              </Card>
            </Animated.View>
          );
        }}
      />

      <FloatingActionButton
        onPress={() => navigation.navigate('SplitAddExpense', { initialSplitMode: activeTab })}
      />
    </View>
  );
}

/**
 * What stands in for the two summary cards until both reads have landed. A
 * failure here replaces the totals rather than showing a partial sum, because
 * "YOU OWE ₹0" computed from one of two lists is worse than no figure at all.
 */
function SummaryPlaceholder({ styles, loadError, onRetry }) {
  if (loadError) {
    return <InlineMessage message={loadError} onRetry={onRetry} style={styles.summaryMessage} />;
  }
  return <Text style={styles.statusText}>Loading your balances…</Text>;
}

/**
 * The active tab's own four states, kept apart on purpose (constitution §22):
 * loading, failed, the one-render gap before the load effect fires, and a read
 * that genuinely came back empty.
 */
function TabPlaceholder({ styles, isIndividual, hasLoaded, isLoading, loadError, onRetry }) {
  if (!hasLoaded && isLoading) {
    return (
      <Text style={styles.statusText}>
        {isIndividual ? 'Loading your splits…' : 'Loading your groups…'}
      </Text>
    );
  }

  if (!hasLoaded && loadError) {
    return <InlineMessage message={loadError} onRetry={onRetry} />;
  }

  if (!hasLoaded) {
    // Neither loading, nor failed, nor loaded: the one-render gap before the
    // load effect fires. Deliberately blank rather than flashing the empty
    // state — the same choice StatisticsScreen's placeholder makes.
    return null;
  }

  // Zero entries in the active tab, from a read that succeeded —
  // docs/ui/design-system.md §18.2. Per-tab copy, unchanged.
  return (
    <View style={styles.emptyState}>
      <IconBadge glyph="⇄" tone="neutral" size="large" />
      <Text style={styles.emptyStateText}>
        {isIndividual
          ? 'No individual splits yet — tap + to split an expense with someone.'
          : 'No groups yet — tap New Group or + to get started.'}
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
      // This screen now renders behind the FAB as well as the floating tab
      // bar (docs/decisions/0005-split-add-expense-flow.md §1) — the FAB
      // sits higher off the screen bottom, so its top edge is the one that
      // must be cleared. Identical to DashboardScreen.jsx's own
      // listContent.paddingBottom computation, safe-area inset included.
      paddingBottom: getFabTopEdge(theme, insets) + theme.space.lg,
    },
    summaryRow: {
      flexDirection: 'row',
      gap: theme.space.md,
      marginBottom: theme.space.xxl,
    },
    summaryCard: {
      flex: 1,
      marginRight: theme.space.md,
    },
    summaryCardLast: {
      marginRight: 0,
    },
    summaryLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    summaryAmountNegative: {
      color: theme.color.status.negative,
      fontSize: theme.type.h1.fontSize,
      fontWeight: theme.type.h1.fontWeight,
    },
    summaryAmountPositive: {
      color: theme.color.status.positive,
      fontSize: theme.type.h1.fontSize,
      fontWeight: theme.type.h1.fontWeight,
    },
    // Occupies the slot the two cards would have, so the controls below do not
    // jump when the figures arrive.
    summaryMessage: {
      marginBottom: theme.space.xl,
    },
    statusText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      marginBottom: theme.space.xxl,
    },
    segmentedControl: {
      marginBottom: theme.space.xxl,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.space.md,
    },
    sectionHeader: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
    },
    newGroupButton: {
      paddingVertical: theme.space.sm,
      paddingHorizontal: theme.space.lg,
    },
    groupCard: {
      marginBottom: theme.space.md,
    },
    // ADR 0028 §9.2's "who owes whom" lines under each card's row.
    cardSummary: {
      marginTop: theme.space.xs,
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

export default SplitGroupsListScreen;
