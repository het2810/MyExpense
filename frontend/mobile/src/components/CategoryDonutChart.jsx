import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { G, Line, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme/useTheme';
import {
  LABEL_HORIZONTAL_GUTTER,
  LABEL_VERTICAL_GUTTER,
  buildSliceArcs,
  buildSliceLabels,
  buildSliceSweeps,
  canLabelSlice,
} from '../utils/pieGeometry';

/**
 * The Statistics tab's chart: one wedge per top-level category, each sized by
 * that category's share of the range's total spend
 * (docs/api/api-overview.md §14.1,
 * docs/decisions/0022-statistics-expenses-by-parent-category.md §1 point 2 —
 * the Project Owner's original "pie/donut breakdown by parent category").
 *
 * ---
 * **A FILLED PIE WITH LABELS OUTSIDE IT** (Project Owner reference, 2026-11-01:
 * "category displayed outside donut as well as below it").
 *
 * Three things changed and all three are constants: the wedge depth is
 * `size / 2`, which closes the hole and makes the wedges meet at the centre —
 * the one-constant donut/pie switch this file already documented; the labelled
 * slices now print their name and percentage *outside* the pie, each joined to
 * its own wedge by a two-segment leader line; and the canvas grew a gutter on
 * every side to hold them. The legend below the chart
 * (`components/CategoryBreakdownRow.jsx`) is unchanged in purpose and still
 * carries every category, which is what makes the labelling selective rather
 * than lossy.
 *
 * **Not every slice is labelled, deliberately.** `utils/pieGeometry.js` owns
 * the three collision rules — a minimum share, a maximum count, and a
 * minimum vertical gap between two labels on the same side — because with many
 * small slices outside labels collide, and a chart that overlaps its own text is
 * worse than one that labels the big slices and leaves the rest to the legend.
 *
 * ---
 * **DRAWN BY HAND WITH `react-native-svg`. NO CHART LIBRARY, AND NONE IS TO
 * BE ADDED.**
 *
 * `react-native-svg@15.16.0` is the **one** dependency cleared for this screen
 * (constitution §21, ADR 0022's Frontend Engineer follow-up 8, approved by the
 * Project Owner and installed by them). A chart package —
 * `react-native-gifted-charts`, `victory-native` or any other — is **not**
 * covered by that clearance and must not be introduced: the whole chart is
 * `Path` wedges, two `Line`s per label and some trigonometry, which is less code
 * than the wrapper around a library would be.
 *
 * ---
 * **PRESENTATIONAL ONLY — IT KNOWS NOTHING ABOUT CATEGORIES.**
 *
 * It takes `slices` of `{ key, share, color, label, glyph, caption }` and draws
 * them in the order given. It does not sort, re-sort, group, total or
 * percentage anything: the order is the server's (`amount` descending, ties by
 * name ascending — §14.1), the shares come from
 * `utils/statistics.js#computeShare` (which already guards `totalSpent <= 0`),
 * the colors from `utils/chartPalette.js`, and `label`/`glyph`/`caption` are
 * finished display strings the screen composed — this file never formats a
 * percentage or resolves an icon. The geometry is `utils/pieGeometry.js`'. What
 * is left here is the markup and the styles, which is the whole point of the
 * split (constitution §8/§26).
 *
 * **Every number that decides its proportions is a named constant below, and
 * every one of them is overridable by a prop** — size, wedge depth, where the
 * first slice starts, the hairline between slices, and whether outside labels
 * are drawn at all.
 *
 * Set `ringThickness` to something smaller than `size / 2` and the hole opens
 * again: it is a donut, and the optional two lines in the hole
 * (`centerLabel`/`centerValue`) become meaningful. Both of ADR 0022's words are
 * still one constant apart.
 *
 * ---
 * **IT SCALES DOWN TO ITS CONTAINER, NEVER OVERFLOWS IT.**
 *
 * The labelled canvas is wider than the pie by two gutters, which on a narrow
 * phone can exceed the card it sits in. So the wrapper is `maxWidth: '100%'`
 * with a fixed `aspectRatio` and the `Svg` is `100%` of it against a fixed
 * `viewBox` — SVG's own scaling then shrinks the drawing, labels included, to
 * whatever width it is given. The alternative, measuring the container with
 * `onLayout` and re-rendering, would add a layout pass and a frame of wrong
 * geometry for no better result.
 *
 * ---
 * **ACCESSIBILITY: THE CHART IS ONE IMAGE, THE LEGEND CARRIES THE FACTS.**
 *
 * A screen reader walking eight unlabelled wedges learns nothing, and labelling
 * each wedge would read the same list the legend below already reads properly
 * (`components/CategoryBreakdownRow.jsx`, each row spoken as one sentence with
 * its name, amount and share). So the chart is a single `image` with a summary
 * label that points at the legend, and the legend is the accessible surface.
 * The outside labels are part of that image and are deliberately not separately
 * focusable: they are a subset of what the legend already says.
 */

/** Pie diameter, in points — the drawing, not the canvas. */
const DONUT_SIZE = 168;

/**
 * Wedge depth. At `DONUT_SIZE / 2` the hole is closed and this is a filled pie,
 * which is what the Project Owner's reference shows. Anything smaller reopens
 * the hole and it is a donut again.
 */
const DONUT_RING_THICKNESS = DONUT_SIZE / 2;

/** Where the first slice begins. `0` is twelve o'clock; slices run clockwise. */
const DONUT_START_ANGLE = 0;

/**
 * Hairline between neighbouring slices, drawn as a `background.surface` stroke
 * **on top of** each wedge rather than as a gap in the geometry — so no angle is
 * shrunk to make room and every slice stays exactly its own share wide. The
 * token is the card's own fill, so the separation reads as the card showing
 * through in both themes (dark gaps on dark, light on light) rather than as a
 * painted line.
 */
const SLICE_SEPARATOR_WIDTH = 2;

const DEFAULT_ACCESSIBILITY_LABEL =
  'Pie chart of spending by category. Each category is listed below it with its amount and share.';

/**
 * @param {{
 *   slices: Array<{ key: string, share: number, color: string, label?: string,
 *     glyph?: string | null, caption?: string | null }>,
 *   size?: number,
 *   ringThickness?: number,
 *   startAngle?: number,
 *   separatorWidth?: number,
 *   showLabels?: boolean,
 *   centerLabel?: string | null,
 *   centerValue?: string | null,
 *   accessibilityLabel?: string,
 *   style?: object,
 * }} props `share` is 0..1 (`computeShare`). `label` is the category's name,
 *   `glyph` the badge character drawn before it and `caption` the percentage
 *   line beneath it — all already formatted. `centerLabel`/`centerValue` are the
 *   optional two lines in the hole, rendered only when `ringThickness` leaves a
 *   hole to print in; unset by this screen, because the TOTAL SPENT card already
 *   states the total and a finance app must not print one figure twice in two
 *   roundings.
 */
function CategoryDonutChart({
  slices,
  size = DONUT_SIZE,
  ringThickness = DONUT_RING_THICKNESS,
  startAngle = DONUT_START_ANGLE,
  separatorWidth = SLICE_SEPARATOR_WIDTH,
  showLabels = true,
  centerLabel = null,
  centerValue = null,
  accessibilityLabel = DEFAULT_ACCESSIBILITY_LABEL,
  style,
}) {
  const theme = useTheme();
  const sweeps = buildSliceSweeps(slices);
  // Whether to reserve the gutters at all, decided from the slices rather than
  // from the placed labels: a label's position depends on the centre, and the
  // centre depends on the gutters.
  const hasLabelCandidates = showLabels && sweeps.some((sweep) => canLabelSlice(sweep.slice));
  const horizontalGutter = hasLabelCandidates ? LABEL_HORIZONTAL_GUTTER : 0;
  const verticalGutter = hasLabelCandidates ? LABEL_VERTICAL_GUTTER : 0;
  const canvasWidth = size + horizontalGutter * 2;
  const canvasHeight = size + verticalGutter * 2;
  const styles = createStyles(theme, canvasWidth, canvasHeight);

  const center = { x: horizontalGutter + size / 2, y: verticalGutter + size / 2 };
  // Half the stroke of the outermost wedge sits outside the wedge itself, so the
  // radius is pulled in by that much to keep the pie inside the viewBox.
  const outerRadius = size / 2 - separatorWidth / 2;
  const innerRadius = Math.max(0, outerRadius - ringThickness);
  const arcs = buildSliceArcs(sweeps, { center, outerRadius, innerRadius, startAngle });
  const labels = hasLabelCandidates
    ? buildSliceLabels(sweeps, { center, outerRadius, startAngle })
    : [];

  // Nothing to draw is not a degenerate circle: the screen's empty state
  // handles a genuinely-empty range (ADR 0022 §5) and this renders nothing
  // rather than an empty ring that would read as "spending, unaccounted for".
  if (arcs.length === 0) {
    return null;
  }

  return (
    <View
      style={[styles.chart, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}>
        {arcs.map((arc) => (
          <Path
            key={arc.key}
            d={arc.d}
            fill={arc.color}
            stroke={theme.color.background.surface}
            strokeWidth={separatorWidth}
          />
        ))}

        {labels.map((label) => (
          <G key={label.key}>
            <Line
              x1={label.anchor.x}
              y1={label.anchor.y}
              x2={label.elbow.x}
              y2={label.elbow.y}
              stroke={theme.color.text.tertiary}
              strokeWidth={1}
            />
            <Line
              x1={label.elbow.x}
              y1={label.elbow.y}
              x2={label.elbowEndX}
              y2={label.elbow.y}
              stroke={theme.color.text.tertiary}
              strokeWidth={1}
            />
            <SvgText
              x={label.textX}
              y={label.nameY}
              textAnchor={label.textAnchor}
              fill={theme.color.text.primary}
              fontSize={theme.type.caption.fontSize}
              fontWeight={theme.type.bodyLg.fontWeight}
            >
              {label.name}
            </SvgText>
            {label.caption ? (
              <SvgText
                x={label.textX}
                y={label.captionY}
                textAnchor={label.textAnchor}
                fill={theme.color.text.secondary}
                fontSize={theme.type.caption.fontSize}
              >
                {label.caption}
              </SvgText>
            ) : null}
          </G>
        ))}
      </Svg>

      {innerRadius > 0 && (centerLabel || centerValue) ? (
        <View style={styles.centerOverlay}>
          {centerLabel ? <Text style={styles.centerLabel}>{centerLabel}</Text> : null}
          {centerValue ? <Text style={styles.centerValue}>{centerValue}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme, canvasWidth, canvasHeight) {
  return StyleSheet.create({
    // Fixed aspect ratio, capped at the container's width — see this file's
    // scaling note. The `Svg` inside is 100% of this box against a fixed
    // viewBox, so the drawing shrinks with it instead of being clipped.
    chart: {
      width: canvasWidth,
      maxWidth: '100%',
      aspectRatio: canvasWidth / canvasHeight,
      alignSelf: 'center',
    },
    centerOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      // Only rendered when there is a hole, so this only has to keep the copy
      // clear of the canvas edge.
      paddingHorizontal: theme.space.xl,
    },
    centerLabel: {
      color: theme.color.text.secondary,
      fontSize: theme.type.label.fontSize,
      lineHeight: theme.type.label.lineHeight,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      textAlign: 'center',
    },
    centerValue: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      textAlign: 'center',
    },
  });
}

export default CategoryDonutChart;
