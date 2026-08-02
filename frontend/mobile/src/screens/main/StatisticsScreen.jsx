import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useCategoryStatistics } from '../../hooks/useCategoryStatistics';
import {
  formatSharePercent,
  formatStatisticsRangeLabel,
  resolveBreakdownGlyph,
} from '../../utils/statistics';
import { buildCategorySlicePalette, resolveSliceColor } from '../../utils/chartPalette';
import ScreenHeader from '../../components/ScreenHeader';
import ThemeToggleButton from '../../components/ThemeToggleButton';
import NotificationBell from '../../components/NotificationBell';
import Card from '../../components/Card';
import IconBadge from '../../components/IconBadge';
import InlineMessage from '../../components/InlineMessage';
import CategoryDonutChart from '../../components/CategoryDonutChart';
import CategoryBreakdownRow from '../../components/CategoryBreakdownRow';
import StatisticsRangeStepper from '../../components/StatisticsRangeStepper';
import { dashboardSummary } from '../../mocks/dashboardMocks';

/**
 * Statistics tab — where the account's expenses went, by parent category, for
 * one date range. Server-backed by `GET /api/v1/statistics/categories`
 * (docs/api/api-overview.md §14.1), designed by
 * docs/decisions/0022-statistics-expenses-by-parent-category.md.
 *
 * **Expenses only, and there is no toggle to add.** §14 carries no `type`
 * parameter: `type = 'expense'` is a server-side invariant and income is
 * structurally unreachable rather than filtered out (ADR 0022 §1 — income is
 * not a category, so an income breakdown would be one 100% slice forever). So
 * this screen has no income tab, no income total and no segmented control, and
 * nothing here is to be extended into one.
 *
 * ---
 * **A PIE PLUS A LEGEND — ADR 0022 §1 POINT 2'S ORIGINAL DESIGN, NOW MATCHED TO
 * THE PROJECT OWNER'S REFERENCE (2026-11-01).**
 *
 * The Project Owner asked for a pie/donut breakdown by parent category. It
 * shipped first as a ranked bar list because a chart needed a dependency that
 * had not cleared constitution §21 (ADR 0022's Frontend Engineer follow-up 8);
 * `react-native-svg@15.16.0` has since been approved by the Project Owner and
 * installed, so the chart is drawn directly — **`Path` wedges, no chart
 * library, and ADR 0022 §8's "nothing else gets installed" still holds.**
 *
 * Their reference screenshot (a different finance app, shared as a *style*
 * reference — nothing of its branding, categories or literal colors is copied)
 * settled three things the first pass had left open: a **filled pie** rather
 * than a ring, each category **named outside its own slice** on a leader line
 * with its percentage beneath, and a **legend row** that leads with a rounded
 * color chip carrying the integer percentage. Their words for it: "category
 * displayed outside donut as well as below it".
 *
 * The two halves are deliberately separate components:
 * `components/CategoryDonutChart.jsx` draws wedges and outside labels from
 * `{ share, color, label, glyph, caption }` and knows nothing about categories;
 * `components/CategoryBreakdownRow.jsx` is one legend entry and carries every
 * fact (name, amount, percentage, the subcategory roll-up, the drill-down tap).
 * The chart's proportions and its label-collision rules are named constants and
 * props inside the chart component; this screen's own arrangement — which card
 * holds the total, where the pie sits relative to the legend, the legend's
 * heading — is the header block in `BreakdownHeader` and `createStyles` below.
 *
 * **Not every slice gets an outside label, and that is deliberate.** The chart
 * labels the largest few and skips anything too small or too close to its
 * neighbour (its three documented collision rules), because two lines of text
 * pointing at a one-percent wedge can only land on another label. Nothing is
 * lost: the legend below lists **every** category the API returned. There is no
 * "Other" bucket anywhere on this screen — the slice count is whatever §14.1
 * answers with.
 *
 * **Slice colors are never hardcoded.** `utils/chartPalette.js` samples a
 * graded warm-to-cool ramp out of four theme tokens across however many slices
 * there are, and a category's color is its **index in the server's order** into
 * that palette — so the pie and the legend chip agree by construction, and the
 * same response always paints the same chart. Nothing is re-sorted here
 * (§14.1), so the ramp runs biggest-spend-first.
 *
 * **The range opens on the active budget period, falling back to this calendar
 * month, and steps backwards a calendar month at a time** —
 * `useCategoryStatistics` owns both the choice and the stepping (§14 takes two
 * optional dates and no `budgetPeriodId`, deliberately). The stepper added
 * 2026-11-01 replaces the standalone label that used to sit under the total:
 * it is the same `formatStatisticsRangeLabel(range)` copy, printed once, now
 * between the two arrows that move it — so the figures are still never
 * unattributed and the range is no longer a dead end.
 *
 * **It sits outside the FlatList, above it, deliberately.** `BreakdownHeader`
 * returns `null` until `hasLoaded`, so a stepper inside it would vanish on
 * exactly the two screens a user most needs to leave — a failed read and an
 * empty month — stranding them on a range they cannot step out of. Outside the
 * list it is also pinned rather than scrolled away, which is how
 * `ScreenHeader` above it behaves.
 *
 * ---
 * **FOUR STATES, AND A FAILED READ IS NEVER THE EMPTY ONE.**
 *
 * `BreakdownPlaceholder` keeps loading, failure, the pre-effect gap and
 * genuine-zero apart, and **the total card and the pie render only once a
 * read has succeeded**: `₹0 spent` in front of a user whose request timed out
 * would be a false statement about their money, and this screen exists to make
 * statements about their money. Zero spend in the range is a `200` with an
 * empty array (§14.1) and gets its own, cheerful-but-accurate empty state —
 * never a degenerate empty circle.
 *
 * **The read is also re-run when a transaction is written.** Nothing on this
 * screen does that: `useTransactionsStore` marks the statistics cache stale
 * after every confirmed create/update/delete and `useCategoryStatistics`' focus
 * effect picks it up the next time this tab is shown (Project Owner, 2026-11-01:
 * "after saving the expense the stats are not updated in the real time").
 */
function StatisticsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  // This hook is the load trigger for `GET /statistics/categories` (cache-first
  // per range, one request per session unless the range changes) as well as the
  // read. `rows` is the server's order with each entry's share and each
  // parent's direct spend attached — nothing is re-sorted here (§14.1).
  const {
    rows,
    totalSpent,
    range,
    hasLoaded,
    isLoading,
    loadError,
    unsyncedNote,
    reload,
    canGoToPreviousMonth,
    canGoToNextMonth,
    goToPreviousMonth,
    goToNextMonth,
  } = useCategoryStatistics();
  const [expandedCategoryId, setExpandedCategoryId] = useState(null);
  const { currencySymbol } = dashboardSummary;
  const styles = createStyles(theme, insets);

  // Sized to the breakdown, so the gradient spans exactly this chart's slices —
  // see `buildCategorySlicePalette`. The legend reads the same palette object,
  // so one call decides both surfaces' colors.
  const palette = useMemo(() => buildCategorySlicePalette(theme, rows.length), [theme, rows.length]);

  /**
   * The pie's input: one slice per top-level category, in the server's order,
   * each with the share `buildBreakdownRows` already computed, its palette color
   * and the three display strings its outside label prints. The legend derives
   * its chip from the same `resolveSliceColor(palette, index)` call, so the two
   * cannot drift.
   *
   * **The formatting happens here, not in the chart** (constitution §8): the
   * percentage is `formatSharePercent` — the same single rounding decision the
   * legend's chip prints, so a slice's label and its legend row can never
   * disagree by a point — and the glyph is `resolveBreakdownGlyph`, the same
   * icon-fallback rule the legend badge uses. The chart receives finished
   * strings and knows nothing about categories.
   */
  const slices = useMemo(
    () =>
      rows.map((row, index) => ({
        key: row.categoryId,
        share: row.share,
        color: resolveSliceColor(palette, index),
        label: row.categoryName,
        glyph: resolveBreakdownGlyph(row),
        caption: formatSharePercent(row.share),
      })),
    [rows, palette],
  );

  const toggleExpanded = useCallback((categoryId) => {
    // One open parent at a time — the same accordion behaviour Category Picker
    // and Manage Categories already use for a category's subcategories.
    setExpandedCategoryId((current) => (current === categoryId ? null : categoryId));
  }, []);

  /**
   * The drill-down: `GET /transactions?categoryId=&dateFrom=&dateTo=` behind a
   * pushed screen, with **no new endpoint** (§14.1, ADR 0022 §6).
   *
   * `categoryAmount` travels as a route param because §14 already answered it
   * and this screen is already holding it — the detail view must not sum its
   * paginated list to produce a total (that ADR's rule: §14 owns every total,
   * `GET /transactions` owns every list). One of the two calls the drill-down
   * needs is therefore already in hand, which is exactly the trade §6 names.
   */
  const openCategory = useCallback(
    (entry, parentCategoryName) => {
      navigation.navigate('CategoryTransactions', {
        categoryId: entry.categoryId,
        categoryName: entry.categoryName,
        parentCategoryName,
        categoryAmount: entry.amount,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      });
    },
    [navigation, range.dateFrom, range.dateTo],
  );

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Statistics"
        align="left"
        rightSlot={
          <>
            <NotificationBell />
            <ThemeToggleButton />
          </>
        }
      />

      {/* Always rendered, in every one of the four states — see the note at
          the top of this file for why it is not part of the list header. */}
      <StatisticsRangeStepper
        label={formatStatisticsRangeLabel(range)}
        canGoPrevious={canGoToPreviousMonth}
        canGoNext={canGoToNextMonth}
        onPrevious={goToPreviousMonth}
        onNext={goToNextMonth}
        style={styles.rangeStepper}
      />

      {/* Cached server totals that predate queued transaction writes
          (ADR 0027 §8.8). */}
      {hasLoaded && unsyncedNote ? <Text style={styles.statusText}>{unsyncedNote}</Text> : null}

      <FlatList
        // Fabric view-identity guard: FlatList defaults this to true on
        // Android, which attaches and detaches children outside Fabric's
        // own insert/remove instructions and can produce
        // "addViewAt ... child already has a parent" crashes.
        removeClippedSubviews={false}
        data={rows}
        keyExtractor={(item) => item.categoryId}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <BreakdownHeader
            styles={styles}
            hasLoaded={hasLoaded}
            slices={slices}
            totalSpent={totalSpent}
            currencySymbol={currencySymbol}
          />
        }
        ListEmptyComponent={
          <BreakdownPlaceholder
            styles={styles}
            hasLoaded={hasLoaded}
            isLoading={isLoading}
            loadError={loadError}
            onRetry={reload}
          />
        }
        renderItem={({ item, index }) => (
          <CategoryBreakdownRow
            row={item}
            swatchColor={resolveSliceColor(palette, index)}
            currencySymbol={currencySymbol}
            isExpanded={expandedCategoryId === item.categoryId}
            onToggleExpanded={() => toggleExpanded(item.categoryId)}
            onOpenCategory={openCategory}
          />
        )}
      />
    </View>
  );
}

/**
 * Everything above the legend: the total, the range it describes, and the pie.
 *
 * **This is the block to rearrange** — the order of the two cards, whether the
 * pie shares the total's card, and whether the legend keeps its heading are all
 * decided here and in `createStyles`. The chart's own proportions (diameter,
 * wedge depth, start angle, the label gutters and the collision rules) are
 * constants and props in `components/CategoryDonutChart.jsx`.
 *
 * **Both cards are gated on `hasLoaded`, for the same reason the empty state
 * is**: a total of zero and a chart with no wedges are both statements about
 * the user's money, and neither may be made on the strength of a read that has
 * not succeeded. The pie is additionally gated on there being slices, so the
 * genuine-zero case renders the empty state rather than an empty circle.
 *
 * **The range label is no longer printed here**, because the stepper directly
 * above this block now carries exactly the same
 * `formatStatisticsRangeLabel(range)` copy. The total is still attributed —
 * more reliably than before, since the stepper renders in all four states while
 * this block renders in one — and printing one caption twice, eight pixels
 * apart, would read as a rendering fault.
 */
function BreakdownHeader({ styles, hasLoaded, slices, totalSpent, currencySymbol }) {
  if (!hasLoaded) {
    return null;
  }

  const hasSlices = slices.length > 0;

  return (
    <View>
      <Card style={styles.totalCard}>
        <Text style={styles.totalLabel}>TOTAL SPENT</Text>
        <Text style={styles.totalAmount}>
          {currencySymbol}
          {totalSpent.toLocaleString('en-IN')}
        </Text>
      </Card>

      {hasSlices ? (
        <>
          <Card style={styles.chartCard}>
            <CategoryDonutChart slices={slices} />
          </Card>
          <Text style={styles.legendLabel}>BY CATEGORY</Text>
        </>
      ) : null}
    </View>
  );
}

/**
 * What stands in for the legend when there are no categories — the four states
 * a server-backed read has, kept apart on purpose (constitution §22).
 *
 * **A failed read must never render the empty state.** "No expenses in this
 * period" in front of a user who spent all month, because a request timed out,
 * is a lie about their finances — and unlike a missing list row, a *wrong zero*
 * in a finance app reads as authoritative. So a failure says so and offers
 * Retry, and the zero state is reserved for a read that actually succeeded and
 * came back empty, which §14.1 answers as a plain `200` with
 * `{ totalSpent: 0.00, categories: [] }` rather than an error or a "no active
 * budget period" condition.
 *
 * The treatment is the Dashboard's, deliberately — the same status copy, the
 * same `InlineMessage` retry and the same `IconBadge` + body-text empty state
 * (docs/ui/design-system.md §18.1) — so the two server-backed lists in this app
 * read identically.
 */
function BreakdownPlaceholder({ styles, hasLoaded, isLoading, loadError, onRetry }) {
  if (!hasLoaded && isLoading) {
    return <Text style={styles.statusText}>Loading your spending…</Text>;
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
      <IconBadge glyph="▤" tone="neutral" size="large" />
      <Text style={styles.emptyStateText}>
        No expenses in this period yet — add one and your category breakdown
        appears here.
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
    // The stepper is a sibling of the FlatList rather than a row inside it, so
    // it carries the same `space.xl` horizontal gutter `listContent` applies
    // below — the two must line up, and this is the only place that is stated
    // twice because they are two different boxes.
    rangeStepper: {
      marginHorizontal: theme.space.xl,
      marginBottom: theme.space.lg,
    },
    listContent: {
      paddingHorizontal: theme.space.xl,
      // This screen renders behind the floating tab bar only (no FAB — nothing
      // is created from Statistics), so the tab bar's top edge is what must be
      // cleared. Computed from the same theme/layout.js constants MainTabs.jsx
      // positions the bar with, including the bottom inset, so it cannot
      // silently drift out of sync — the same arrangement ProfileScreen uses.
      paddingBottom: getTabBarTopEdge(theme, insets) + theme.space.lg,
    },
    totalCard: {
      marginBottom: theme.space.lg,
    },
    chartCard: {
      // The chart centres itself inside the card (`CategoryDonutChart`'s own
      // `alignSelf`), so this only owns the breathing room around it.
      paddingVertical: theme.space.xl,
      // Narrower side padding than `Card`'s default, on purpose: the chart's
      // outside labels live at the edges of its canvas, and the canvas scales
      // itself down to whatever width it is given — so every point returned
      // here is a point of pie diameter and label legibility on a narrow phone.
      // The card's radius and border still frame it.
      paddingHorizontal: theme.space.sm,
      marginBottom: theme.space.lg,
    },
    legendLabel: {
      color: theme.color.text.secondary,
      fontSize: theme.type.label.fontSize,
      lineHeight: theme.type.label.lineHeight,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    totalLabel: {
      color: theme.color.text.secondary,
      fontSize: theme.type.label.fontSize,
      lineHeight: theme.type.label.lineHeight,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
    },
    totalAmount: {
      color: theme.color.text.primary,
      fontSize: theme.type.display.fontSize,
      lineHeight: theme.type.display.lineHeight,
      fontWeight: theme.type.display.fontWeight,
      marginTop: theme.space.xs,
    },
    // Load status copy — the same `text.secondary` body treatment the
    // Dashboard's and Category Picker's own "Loading…" lines use.
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
  });
}

export default StatisticsScreen;
