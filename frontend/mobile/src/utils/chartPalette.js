/**
 * The Statistics donut's slice colors — an explicit, ordered, theme-derived
 * palette (`components/CategoryDonutChart.jsx`,
 * `components/CategoryBreakdownRow.jsx`).
 *
 * Its own module rather than a constant inside the chart because **two
 * surfaces must agree on it**: the donut paints the slice and the legend paints
 * the swatch beside that category's name. A legend whose swatch disagrees with
 * its own slice is worse than no legend at all, so the derivation exists once
 * and both callers read it.
 *
 * ---
 * **EVERY SLICE COLOR IS A TOKEN OR A BLEND OF TWO TOKENS. NO HEX HERE.**
 *
 * `theme/tokens.js` names four colors that carry a usable hue
 * (`status.negative`, `status.warning`, `status.positive`, `accent.primary`).
 * That is fewer than the number of categories a user can have, so those four
 * are treated as the **stops of a gradient** and every slice color is sampled
 * along it with `utils/color.js#mixHexColors` — the same blend ProgressBar's
 * budget bar has always used. Both themes therefore flip together and nothing
 * here is a literal color (docs/ui/design-system.md §3, constitution §17).
 *
 * **Order is the palette's contract.** `resolveSliceColor` indexes it by the
 * category's **position in the server's already-sorted `categories[]`**
 * (`amount` descending, ties by name ascending — `api-overview.md` §14.1), not
 * by a hash of the name and not by anything random. So the biggest spend is
 * always the first palette entry, the same category keeps the same color on
 * every render of the same response, and re-reading the range cannot reshuffle
 * the chart's colors.
 *
 * Deliberately **not** a `theme.color` token group: these are one feature's
 * chart colors, not a system-wide semantic role, and adding eight keys to both
 * themes would require a design-system change that is the System Architect's
 * to make (constitution §12/§20).
 *
 * Pure functions only: no React. The caller passes the live theme in.
 */

import { mixHexColors } from './color';

/**
 * How many entries the palette has when the caller does not say how many slices
 * it is painting. Only a fallback: the ramp is sampled across the actual slice
 * count so that the gradient spans the chart rather than stopping part-way.
 */
const DEFAULT_SLICE_COUNT = 8;

/**
 * The ramp's stops, warm to cool, in slice order.
 *
 * Four tokens, which are the four `theme/tokens.js` colors that carry a usable
 * hue, ordered as the Project Owner's reference chart runs them: red, amber,
 * green, cyan. The biggest spend therefore gets the warmest color and the
 * smallest the coolest, because `categories[]` arrives `amount` descending
 * (api-overview.md §14.1).
 *
 * @param {object} theme
 * @returns {string[]} `#rrggbb` tokens — raw tokens, never blends, because
 *   `mixHexColors` takes hex.
 */
function buildRampStops(theme) {
  const { accent, status } = theme.color;
  return [status.negative, status.warning, status.positive, accent.primary];
}

/**
 * The ordered palette: a **graded ramp sampled across the slices**.
 *
 * **This replaced a max-contrast palette on 2026-11-01**, and the change is the
 * Project Owner's, not a preference: their reference chart runs the slices as
 * one continuous warm-to-cool gradient, so the palette is now sampled evenly
 * along `buildRampStops` for however many slices there are — entry 0 is exactly
 * the first stop, the last entry exactly the last stop, everything between them
 * a blend of two adjacent stops.
 *
 * What was given up, stated plainly: the old palette put adjacent *slices* as
 * far apart in hue as the token set allowed, which a ramp cannot do — two
 * neighbouring slices are now neighbouring shades. That is legible here because
 * every slice is named twice over: the labelled slices carry their name and
 * percentage outside the pie, and the legend below prints a chip of the exact
 * same color beside every category. A ramp with no legend would not be
 * acceptable; this is why the legend is not optional.
 *
 * `text.secondary`, the old neutral eighth entry, is deliberately gone: a grey
 * slice inside a gradient reads as a rendering fault rather than as a category.
 *
 * @param {object} theme A `theme/tokens.js` theme object (`useTheme()`).
 * @param {number} [sliceCount] How many slices will be painted. A non-positive
 *   or non-integer value falls back to `DEFAULT_SLICE_COUNT`.
 * @returns {string[]} `sliceCount` color strings, safe for both a React Native
 *   `backgroundColor` and a react-native-svg `fill`.
 */
export function buildCategorySlicePalette(theme, sliceCount = DEFAULT_SLICE_COUNT) {
  const stops = buildRampStops(theme);
  const count =
    Number.isInteger(sliceCount) && sliceCount > 0 ? sliceCount : DEFAULT_SLICE_COUNT;

  return Array.from({ length: count }, (unused, index) =>
    // One slice is the first stop rather than a division by zero.
    sampleRamp(stops, count === 1 ? 0 : index / (count - 1)),
  );
}

/**
 * The ramp color at `position` (0..1), blended between the two stops it falls
 * between.
 *
 * @param {string[]} stops At least two `#rrggbb` values.
 * @param {number} position
 * @returns {string} An `rgb(...)` string (`mixHexColors`' format).
 */
function sampleRamp(stops, position) {
  const clamped = Math.max(0, Math.min(1, position));
  const scaled = clamped * (stops.length - 1);
  // Clamped to the last *segment*, so `position: 1` lands on the final stop
  // instead of indexing one past the end of the array.
  const lowerIndex = Math.min(stops.length - 2, Math.floor(scaled));
  return mixHexColors(stops[lowerIndex], stops[lowerIndex + 1], scaled - lowerIndex);
}

/**
 * One category's color, from its position in the breakdown.
 *
 * Cycles rather than running out, and falls back to the first entry for an
 * index that is not a usable position — a chart must always reach a color,
 * never `undefined`, which react-native-svg would render as a black slice.
 * `buildCategorySlicePalette` is normally asked for exactly as many entries as
 * there are slices, so the cycle is a guard rather than a routine path; it still
 * matters, because a caller that forgets the count gets the eight-entry fallback
 * and a ninth category must not be black.
 *
 * @param {string[]} palette From `buildCategorySlicePalette`.
 * @param {number} index Position in the server's `categories[]` order.
 * @returns {string}
 */
export function resolveSliceColor(palette, index) {
  const safeIndex = Number.isInteger(index) && index >= 0 ? index % palette.length : 0;
  return palette[safeIndex];
}
