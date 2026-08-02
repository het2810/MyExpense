import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useCategoryTransactions } from '../../hooks/useCategoryTransactions';
import { formatDateRange } from '../../utils/statistics';
import { formatCategoryPath } from '../../utils/categories';
import { getDateDisplayLabel } from '../../utils/dateDisplay';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';
import InlineMessage from '../../components/InlineMessage';
import PrimaryButton from '../../components/PrimaryButton';
import { dashboardSummary } from '../../mocks/dashboardMocks';

/**
 * One category's transactions for the Statistics tab's range — the drill-down
 * behind a tapped bar. Reached by a plain stack push from Statistics
 * (`navigation.navigate('CategoryTransactions', { … })`), the same
 * back-navigable push Transaction Detail and Manage Categories use rather than
 * a modal: it is a drill-down into data the account already has, not a
 * creation flow.
 *
 * **No new endpoint backs this screen** (docs/api/api-overview.md §14.1,
 * docs/decisions/0022-statistics-expenses-by-parent-category.md §6). It reads
 * `GET /api/v1/transactions?categoryId=&dateFrom=&dateTo=` (§4.1), which
 * already filters by category **with the parent -> subcategory roll-up built
 * in**, is already paginated, already owner-scoped and already returns every
 * display field a row needs. So a top-level category lists its own *and* its
 * children's transactions without this screen asking for that, and a
 * subcategory lists only its own.
 *
 * ---
 * **THE TOTAL COMES FROM §14. THE ROWS COME FROM §4.1. NOTHING IS SUMMED HERE.**
 *
 * `categoryAmount` arrives as a route param because the Statistics tab already
 * held it — that is the one extra call ADR 0022 §6 says this view does *not*
 * need to make. Adding up `transactions` to produce it instead would be
 * understated by construction the moment the category has more than one page,
 * which is the rule that ADR states as: **§14 owns every total, and
 * `GET /transactions` owns every list.** The row count is `totalElements` from
 * the very `PageResponse` this list is reading, which is why §14 carries no
 * `transactionCount` field.
 *
 * ---
 * **ROWS ARE READ-ONLY HERE, DELIBERATELY — AND IT IS WORTH KNOWING WHY.**
 *
 * They are not tappable through to Transaction Detail. `useTransactionDetail`
 * resolves its base row out of `useTransactionsStore` — the Dashboard's own
 * accumulated pages — so a transaction that is in *this* filtered list but not
 * in those pages would open a screen reading "This transaction couldn't be
 * found," which is false and alarming. Wiring it needs Transaction Detail to
 * stand on its own §4.3 read rather than on the list store, which is a change
 * inside the transactions domain and is flagged as follow-up rather than made
 * as a drive-by here (constitution §20).
 */
function CategoryTransactionsScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const {
    categoryId,
    categoryName,
    parentCategoryName = null,
    categoryAmount = null,
    dateFrom = null,
    dateTo = null,
  } = route.params ?? {};
  const paymentModeEnabled = useSettingsStore((state) => state.paymentModeEnabled);
  // This hook is the load trigger for this one filtered query as well as the
  // read; it is cache-first per `categoryId`/`dateFrom`/`dateTo`.
  const {
    transactions,
    totalElements,
    hasLoaded,
    isLoading,
    isLoadingMore,
    loadError,
    loadMoreError,
    loadMore,
    reload,
  } = useCategoryTransactions({ categoryId, dateFrom, dateTo });
  const { currencySymbol } = dashboardSummary;
  const styles = createStyles(theme);

  // Only reachable if something navigated here without the one param that
  // identifies what to read. It offers the only action that makes sense, rather
  // than rendering an empty list that would read as "this category has no
  // transactions" (constitution §22) — the same treatment Transaction Detail
  // gives a stale id.
  if (!categoryId) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="Transactions" onBack={() => navigation.goBack()} />
        <View style={styles.unavailableContainer}>
          <Text style={styles.unavailableText}>
            This category couldn&apos;t be opened. Go back and try again.
          </Text>
          <PrimaryButton
            label="Go Back"
            onPress={() => navigation.goBack()}
            style={styles.unavailableButton}
          />
        </View>
      </View>
    );
  }

  // The parent's name travels with a subcategory and is shown with it — a leaf
  // name is only unique within its parent (ADR 0019 §3), so `Snacks` alone
  // would not say which `Snacks` this is. Composed through the one shared
  // formatter, never a second separator.
  const title = formatCategoryPath(parentCategoryName, categoryName);

  return (
    <View style={styles.flex}>
      <ScreenHeader title={title} onBack={() => navigation.goBack()} />

      <FlatList
        // Fabric view-identity guard: FlatList defaults this to true on
        // Android, which attaches and detaches children outside Fabric's
        // own insert/remove instructions and can produce
        // "addViewAt ... child already has a parent" crashes.
        removeClippedSubviews={false}
        data={transactions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        // Pagination (§4.1). The store ignores the call while a read is in
        // flight or the last page is already held, so a fast scroll cannot
        // stack up requests.
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>SPENT IN THIS CATEGORY</Text>
            {/* §14's figure, passed in — never summed from the rows below. */}
            <Text style={styles.summaryAmount}>
              {categoryAmount === null
                ? '—'
                : `${currencySymbol}${categoryAmount.toLocaleString('en-IN')}`}
            </Text>
            <Text style={styles.summaryMeta}>
              {dateFrom && dateTo ? formatDateRange(dateFrom, dateTo) : 'All time'}
            </Text>
            {/* `totalElements` — the query's true row count, not the loaded
                one, and the only count this screen states. */}
            {hasLoaded ? (
              <Text style={styles.summaryMeta}>{formatTransactionCount(totalElements)}</Text>
            ) : null}
          </Card>
        }
        ListEmptyComponent={
          <CategoryTransactionsPlaceholder
            styles={styles}
            hasLoaded={hasLoaded}
            isLoading={isLoading}
            loadError={loadError}
            onRetry={reload}
          />
        }
        ListFooterComponent={
          // Pagination state below the rows rather than over them: a failed
          // next page must never blank a list the user is already reading
          // (constitution §22 — the rows on screen are still correct).
          <>
            {isLoadingMore ? (
              <Text style={styles.statusText}>Loading more transactions…</Text>
            ) : null}
            {loadMoreError ? <InlineMessage message={loadMoreError} onRetry={loadMore} /> : null}
          </>
        }
        renderItem={({ item }) => {
          // Date label computed live from the server's `txnDate` (§4.1) rather
          // than read from a frozen label, so it stays correct as "today" moves
          // forward — the same row treatment the Dashboard uses.
          const dateLabel = getDateDisplayLabel(item.txnDate);
          const subtitle = `${formatCategoryPath(item.parentCategoryName, item.categoryName)} • ${dateLabel}`;
          const badges = [
            paymentModeEnabled && item.type === 'expense' && item.paymentMode
              ? item.paymentMode.toUpperCase()
              : null,
            item.splitExpenseId ? 'SPLIT' : null,
          ].filter(Boolean);

          return (
            <ListItem
              leading={<IconBadge glyph={item.categoryGlyph} tone={item.categoryTone} />}
              title={item.title}
              subtitle={subtitle}
              badges={badges}
              trailingText={`-${currencySymbol}${item.amount.toLocaleString('en-IN')}`}
              trailingTone="negative"
            />
          );
        }}
      />
    </View>
  );
}

/**
 * The three states this list has before it has rows, kept apart for the reason
 * constitution §22 and the Dashboard's own placeholder record: **a failed read
 * must never render the empty state.** "No transactions" for a category the
 * breakdown just said holds spend would contradict the screen the user came
 * from.
 *
 * The genuine empty case is reachable without being a contradiction — the
 * category's rows can be deleted while the breakdown is held — so it says
 * plainly that nothing is in range rather than inviting the user to add
 * anything.
 */
function CategoryTransactionsPlaceholder({ styles, hasLoaded, isLoading, loadError, onRetry }) {
  if (!hasLoaded && isLoading) {
    return <Text style={styles.statusText}>Loading transactions…</Text>;
  }

  if (!hasLoaded && loadError) {
    return <InlineMessage message={loadError} onRetry={onRetry} />;
  }

  if (!hasLoaded) {
    // The one-render gap before the load effect fires — deliberately blank.
    return null;
  }

  return (
    <View style={styles.emptyState}>
      <IconBadge glyph="₹" tone="neutral" size="large" />
      <Text style={styles.emptyStateText}>No transactions in this category for this period.</Text>
    </View>
  );
}

/**
 * "1 transaction" / "N transactions" — the same count-label convention
 * `ManageCategoryRow`'s subcategory count uses.
 *
 * @param {number} count
 * @returns {string}
 */
function formatTransactionCount(count) {
  return count === 1 ? '1 transaction' : `${count} transactions`;
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    listContent: {
      paddingHorizontal: theme.space.xl,
      // A pushed screen, not a tab root: the tab bar is not behind it, so only
      // a comfortable bottom gap is needed.
      paddingBottom: theme.space.xxxl,
    },
    summaryCard: {
      marginBottom: theme.space.xl,
    },
    summaryLabel: {
      color: theme.color.text.secondary,
      fontSize: theme.type.label.fontSize,
      lineHeight: theme.type.label.lineHeight,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
    },
    summaryAmount: {
      color: theme.color.text.primary,
      fontSize: theme.type.h1.fontSize,
      lineHeight: theme.type.h1.lineHeight,
      fontWeight: theme.type.h1.fontWeight,
      marginTop: theme.space.xs,
    },
    summaryMeta: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginTop: theme.space.xs,
    },
    statusText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      paddingVertical: theme.space.lg,
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
    unavailableContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.space.xl,
    },
    unavailableText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
    },
    unavailableButton: {
      marginTop: theme.space.lg,
    },
  });
}

export default CategoryTransactionsScreen;
