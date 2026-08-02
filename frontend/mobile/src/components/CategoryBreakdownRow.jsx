import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { formatSharePercent, resolveBreakdownGlyph } from '../utils/statistics';
import { formatCategoryPath } from '../utils/categories';
import { pickReadableTextColor } from '../utils/color';
import IconBadge from './IconBadge';
import ExpandChevron from './ExpandChevron';

/**
 * One legend entry under the Statistics tab's pie: the category's share as a
 * color chip, its glyph badge, its name and its rolled-up amount — expanding to
 * its subcategories (docs/api/api-overview.md §14.1).
 *
 * ---
 * **THE LEGEND IS WHAT MAKES THE PIE READABLE, AND IT IS NOT OPTIONAL.**
 *
 * `components/CategoryDonutChart.jsx` draws the wedges and deliberately knows
 * nothing about categories; it labels the largest few outside the pie and
 * leaves the rest unnamed, because two lines of text cannot point at a
 * one-percent wedge without landing on another label. **Every** category §14.1
 * returns is therefore printed here, with every fact it carries — name, amount,
 * percentage — and this is also the surface a screen reader walks, which is why
 * the chart itself is one summarised `image` rather than eight unlabelled
 * paths. Each row is spoken as **one sentence**, because the three values are
 * one fact about one category.
 *
 * **The percentage chip is the join between the two.** Its fill comes from
 * `utils/chartPalette.js#resolveSliceColor` keyed by the row's position in the
 * server's order, exactly as the pie's wedge does — the same index into the
 * same ordered, token-derived palette, so a row's chip cannot disagree with
 * its own slice.
 *
 * **It was a 10pt dot with the share on a second line until 2026-11-01**, when
 * the Project Owner's reference moved the percentage *into* the color: one
 * rounded chip on the left, carrying the integer share, then the glyph badge,
 * the name, and the amount right-aligned. Two gains, both the reference's: the
 * row is one line instead of two, and the color sample is large enough to match
 * against its wedge — a 10pt dot is hard to match to a slice at all, which
 * matters more now that the palette is a graded ramp rather than eight
 * maximally-different hues.
 *
 * The chip's text color is **chosen, not fixed**: `pickReadableTextColor` picks
 * whichever of `accent.onPrimary` and `status.onNegative` has more contrast on
 * that particular fill. The ramp spans red to cyan and the two themes give those
 * tokens deliberately different lightness, so one fixed label color would be
 * unreadable on part of every run of the chart.
 *
 * The chip replaced this row's `ProgressBar` when the breakdown became a chart
 * (the Project Owner's original ADR 0022 §1 point 2 design): the proportion is
 * the chart's job now, so a second proportional bar beside the percentage would
 * be a third rendering of one number.
 *
 * ---
 * **THE SUBCATEGORY ROLL-UP STAYS REACHABLE, IN THE LEGEND.**
 *
 * The donut has one arc per **top-level** category — §14.1's `categories[]` is
 * top-level entries with their children nested inside, and a second ring of
 * children would have to repeat every parent's own direct spend as a wedge
 * with no name. So the nesting lives where the names are: a parent with
 * children keeps its chevron, and expanding it lists each child with its
 * amount and its share, plus the parent's own direct spend. Nothing §14.1
 * returns is unreachable from this screen.
 *
 * Each child carries its parent's name (`Food > Snacks`) through the shared
 * `formatCategoryPath` — a correctness requirement, not polish (ADR 0019 §3,
 * restated as ADR 0022's Frontend Engineer follow-up 6): a leaf name is only
 * unique within its parent, so two bare `Snacks` rows would be
 * indistinguishable. The separator lives in exactly one place and this screen
 * does not add a second.
 *
 * A child row **is** tappable: `GET /transactions?categoryId=` with a
 * subcategory id matches that subcategory alone (§4.1), so the drill-down for
 * it is the same call with a different id — no new endpoint, no new screen.
 *
 * ---
 * **THE PARENT'S OWN DIRECT SPEND IS A SUBTRACTION, AND IT IS NOT TAPPABLE.**
 *
 * §14 ships no field for it: it is `amount` minus the sum of
 * `subcategories[].amount`, computed by `utils/statistics.js#computeDirectSpend`
 * (§14.1, constitution §17) and still the only source of that figure. It
 * renders as a plain row inside the expanded parent — and deliberately
 * **without** a press target, because §4.1 has no filter that could back it: a
 * top-level `categoryId` rolls up over its children by design, so "this parent
 * but not its children" is not a list this API can produce. Offering the tap
 * and then showing a rolled-up list would be a worse answer than not offering
 * it.
 *
 * @param {{
 *   row: object,
 *   swatchColor: string,
 *   currencySymbol: string,
 *   isExpanded: boolean,
 *   onToggleExpanded: () => void,
 *   onOpenCategory: (entry: object, parentCategoryName: string | null) => void,
 * }} props `row` is one entry from `useCategoryStatistics().rows` — a §14.1
 *   top-level entry plus `share` and `directSpend`, its `subcategories` each
 *   plus `share`. `swatchColor` is this category's slice color and fills the
 *   percentage chip.
 */
function CategoryBreakdownRow({
  row,
  swatchColor,
  currencySymbol,
  isExpanded,
  onToggleExpanded,
  onOpenCategory,
}) {
  const theme = useTheme();
  const styles = createStyles(theme, swatchColor);
  const subcategories = row.subcategories ?? [];
  const canExpand = subcategories.length > 0;
  const shareLabel = formatSharePercent(row.share);
  const amountLabel = formatAmount(currencySymbol, row.amount);

  return (
    <View style={styles.row}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => onOpenCategory(row, null)}
          style={({ pressed }) => [styles.headerPressable, pressed && styles.pressed]}
          accessibilityRole="button"
          // Spoken as one sentence, because the three values are one fact
          // about this category and a screen reader should not have to
          // assemble them from three unlabelled fragments. The chip's color is
          // not named: a color is not a fact about anyone's spending, and its
          // percentage is already in the sentence.
          accessibilityLabel={`${row.categoryName}, ${amountLabel}, ${shareLabel} of total spend. Show transactions.`}
        >
          <View style={styles.shareChip}>
            <Text style={styles.shareChipText} numberOfLines={1}>
              {shareLabel}
            </Text>
          </View>
          <IconBadge glyph={resolveBreakdownGlyph(row)} tone="neutral" size="small" />
          <Text style={styles.name} numberOfLines={1}>
            {row.categoryName}
          </Text>
          <Text style={styles.amount} numberOfLines={1}>
            {amountLabel}
          </Text>
        </Pressable>
        {canExpand ? (
          <ExpandChevron
            isExpanded={isExpanded}
            onPress={onToggleExpanded}
            accessibilityLabel={`${isExpanded ? 'Hide' : 'Show'} subcategories of ${row.categoryName}`}
          />
        ) : null}
      </View>

      {isExpanded ? (
        <SubcategoryBreakdown
          row={row}
          styles={styles}
          currencySymbol={currencySymbol}
          onOpenCategory={onOpenCategory}
        />
      ) : null}
    </View>
  );
}

/**
 * The expanded parent's children, plus the parent's own direct spend when it
 * has any.
 *
 * **Every share here is a share of `totalSpent`, not of the parent** — the one
 * division ADR 0022 §4 names, already applied by
 * `utils/statistics.js#buildBreakdownRows` at both levels. One scale for every
 * percentage on the screen is what lets a child's percentage be read against
 * its parent's slice; a share-of-parent number would be a second,
 * differently-based percentage in the same list.
 *
 * No color chips on children: they are not slices of the pie, and a colored chip
 * beside a row that has no wedge would be a legend entry pointing at nothing.
 * Their percentage is printed as plain text instead, which is also what keeps
 * the chip reading as "this is a slice".
 */
function SubcategoryBreakdown({ row, styles, currencySymbol, onOpenCategory }) {
  const subcategories = row.subcategories ?? [];

  return (
    <View style={styles.children}>
      {subcategories.map((subcategory) => (
        <Pressable
          key={subcategory.categoryId}
          onPress={() => onOpenCategory(subcategory, row.categoryName)}
          style={({ pressed }) => [styles.childRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${formatCategoryPath(row.categoryName, subcategory.categoryName)}, ${formatAmount(currencySymbol, subcategory.amount)}, ${formatSharePercent(subcategory.share)} of total spend. Show transactions.`}
        >
          <Text style={styles.childName} numberOfLines={1}>
            {formatCategoryPath(row.categoryName, subcategory.categoryName)}
          </Text>
          <Text style={styles.childShare}>{formatSharePercent(subcategory.share)}</Text>
          <Text style={styles.childAmount} numberOfLines={1}>
            {formatAmount(currencySymbol, subcategory.amount)}
          </Text>
        </Pressable>
      ))}

      {row.directSpend > 0 ? (
        // Not a Pressable — see this file's note on why §4.1 cannot filter to a
        // parent's direct spend alone. `directSpend` is `computeDirectSpend`'s
        // figure and nothing here recomputes it.
        <View style={styles.childRow}>
          <Text style={styles.childName} numberOfLines={1}>
            {row.categoryName} itself
          </Text>
          <Text style={styles.childAmount} numberOfLines={1}>
            {formatAmount(currencySymbol, row.directSpend)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One amount as display copy. `toLocaleString('en-IN')` with the app's single
 * currency symbol, exactly as every other amount in this app is rendered
 * (Dashboard rows, Transaction Detail) — §14's amounts carry no currency field
 * because currency is a display symbol only (ADR 0017).
 *
 * @param {string} currencySymbol
 * @param {number} amount
 * @returns {string}
 */
function formatAmount(currencySymbol, amount) {
  return `${currencySymbol}${amount.toLocaleString('en-IN')}`;
}

/**
 * The percentage chip's width. Fixed rather than content-sized, so every row's
 * glyph, name and amount line up in a column whatever each percentage is —
 * `100%`, `<1%` and `7%` are all three different widths. Wide enough for the
 * longest of them at this font size.
 */
const SHARE_CHIP_WIDTH = 46;

function createStyles(theme, swatchColor) {
  return StyleSheet.create({
    row: {
      paddingVertical: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerPressable: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    // The same pressed treatment ListItem uses, so a legend row and a
    // transaction row feel like the same control.
    pressed: {
      opacity: 0.7,
    },
    shareChip: {
      width: SHARE_CHIP_WIDTH,
      paddingVertical: theme.space.xs,
      borderRadius: theme.radius.sm,
      backgroundColor: swatchColor,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.space.md,
    },
    shareChipText: {
      // Whichever of the two tokens reads better on this particular chip — see
      // this file's note and `utils/color.js#pickReadableTextColor`.
      color: pickReadableTextColor(
        swatchColor,
        theme.color.accent.onPrimary,
        theme.color.status.onNegative,
      ),
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.caption.lineHeight,
      fontWeight: theme.type.label.fontWeight,
    },
    name: {
      flex: 1,
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      lineHeight: theme.type.bodyLg.lineHeight,
      fontWeight: theme.type.bodyLg.fontWeight,
      marginLeft: theme.space.md,
      marginRight: theme.space.sm,
    },
    amount: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: '600',
    },
    children: {
      marginTop: theme.space.sm,
      // Indented and rule-marked, so a child reads as part of the category
      // above it rather than as another top-level slice.
      marginLeft: SHARE_CHIP_WIDTH + theme.space.md,
      paddingLeft: theme.space.lg,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.color.border.subtle,
    },
    childRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.space.xs,
    },
    childName: {
      flex: 1,
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginRight: theme.space.sm,
    },
    childShare: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginRight: theme.space.sm,
    },
    childAmount: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
  });
}

export default CategoryBreakdownRow;
