/**
 * The Statistics pie's geometry — every angle, path string and label position
 * `components/CategoryDonutChart.jsx` draws, and nothing that draws them.
 *
 * **Its own module for the reason `utils/chartPalette.js` is**: this is
 * arithmetic, not rendering. Pure functions, no React, no theme and no
 * `react-native-svg` import — the component passes the sizes in and gets back
 * numbers and `d` strings. It also keeps the component file inside
 * constitution §26's size guideline, which it was not when the outside labels
 * were added (2026-11-01).
 *
 * **What it deliberately does not own:** the pie's diameter, its wedge depth,
 * its start angle and the hairline width. Those are the component's documented
 * constants-and-props, because they are what a caller tunes. The label layout
 * below is *not* a prop — it is the collision behaviour, which is a correctness
 * property of the chart rather than a style choice, so it lives with the code
 * that enforces it.
 *
 * It knows nothing about categories either: it works on `{ key, share, color,
 * label, glyph, caption }` and never formats a percentage, resolves an icon or
 * sorts anything (the order is the server's — docs/api/api-overview.md §14.1).
 */

const DEGREES_IN_CIRCLE = 360;
const DEGREES_IN_HALF_CIRCLE = 180;

/**
 * A slice within this many degrees of the whole circle is drawn as a closed
 * ring instead of an arc. A single category at 100% is a real response (one
 * category, `share: 1`), and an arc whose start and end points are the same
 * point draws **nothing** — the chart would vanish for the user whose spending
 * is the least ambiguous.
 */
const FULL_CIRCLE_EPSILON = 0.01;

/** The radial stub from the wedge's edge out to the label's elbow. */
const LEADER_STUB_LENGTH = 10;

/** The horizontal run from the elbow out towards the label. */
const LEADER_ELBOW_LENGTH = 8;

/**
 * Reserved width for one label's two lines of text. Every point spent here is a
 * point the pie does not get on a narrow phone (the canvas scales as a whole),
 * so this is held to about ten characters rather than to the longest category
 * name a user could type.
 *
 * It and `MAX_LABEL_CHARACTERS` are one decision in two numbers and must be
 * changed together: a label wider than its column is clipped by the viewBox at
 * the three- and nine-o'clock positions, where the text starts furthest out.
 */
const LABEL_COLUMN_WIDTH = 64;

/** Gap between the end of the leader line and the first character. */
const LABEL_TEXT_GAP = 4;

/** Distance from the name's baseline down to the percentage's. */
const LABEL_LINE_HEIGHT = 13;

/**
 * What the canvas adds on each side of the pie to hold the labels — the
 * component's only reason to read these numbers.
 */
export const LABEL_HORIZONTAL_GUTTER =
  LEADER_STUB_LENGTH + LEADER_ELBOW_LENGTH + LABEL_COLUMN_WIDTH;
export const LABEL_VERTICAL_GUTTER = LEADER_STUB_LENGTH + LABEL_LINE_HEIGHT * 2;

/**
 * Where a label's text is cut and an ellipsis added — the reference's
 * `Social Lif…`. SVG text does not reflow or truncate itself, so the cut is
 * made on the string; ten characters, glyph included, is what
 * `LABEL_COLUMN_WIDTH` holds at the caption font size.
 */
const MAX_LABEL_CHARACTERS = 10;

/**
 * **Collision rule, part one: a slice under this share gets no outside label.**
 *
 * A label is two lines of text pointing at a wedge; below about a twentieth of
 * the circle the wedge is narrower than the text is tall, so its label could
 * only sit on top of its neighbour's. Five percent is the floor.
 */
const MIN_LABELLED_SLICE_SHARE = 0.05;

/**
 * **Collision rule, part two: at most this many labels.**
 *
 * Slices arrive `amount` descending (§14.1), so the labelled set is always the
 * largest few — no selection pass, and the same response always labels the same
 * slices.
 */
const MAX_OUTSIDE_LABELS = 6;

/**
 * **Collision rule, part three: the backstop.**
 *
 * Parts one and two still allow six five-percent slices to sit next to each
 * other, so a candidate whose elbow lands within two text lines of the last
 * label placed on the *same side* of the pie is skipped. This is what makes
 * non-overlap a property of the chart rather than a hope about the data.
 *
 * Nothing is lost by a skip: the legend below the chart lists every category
 * with its own percentage chip and amount (`CategoryBreakdownRow`).
 */
const LABEL_MIN_VERTICAL_GAP = LABEL_LINE_HEIGHT * 2;

/**
 * Each slice's angular extent, walked in the order given — **the one place the
 * angles are decided**, so the wedges and their labels cannot disagree about
 * where a slice is.
 *
 * A zero share is skipped rather than drawn: §14.1 omits a category with no
 * spend, so a `0` here means a malformed number reached the chart, and a
 * zero-length arc is an invisible path with a visible stroke.
 *
 * The running total is capped at one full circle. The contract says
 * `totalSpent` is exactly the sum of the slices (ADR 0022 §4), so the shares
 * sum to 1 — but if a server ever disagreed with itself, slices overlapping
 * each other would be a chart that is wrong without looking wrong.
 *
 * @param {Array<object>} slices
 * @returns {Array<{ slice: object, startOffset: number, sweep: number }>}
 */
export function buildSliceSweeps(slices) {
  const sweeps = [];
  let consumed = 0;

  (slices ?? []).forEach((slice) => {
    const remaining = DEGREES_IN_CIRCLE - consumed;
    const requested = clampShare(slice.share) * DEGREES_IN_CIRCLE;
    const sweep = Math.min(requested, remaining);

    if (sweep > 0) {
      sweeps.push({ slice, startOffset: consumed, sweep });
      consumed += sweep;
    }
  });

  return sweeps;
}

/**
 * Turns the sweeps into `Path` inputs.
 *
 * @param {Array<{ slice: object, startOffset: number, sweep: number }>} sweeps
 * @param {{ center: { x: number, y: number }, outerRadius: number,
 *   innerRadius: number, startAngle: number }} geometry
 * @returns {Array<{ key: string, color: string, d: string }>}
 */
export function buildSliceArcs(sweeps, geometry) {
  const { center, outerRadius, innerRadius, startAngle } = geometry;

  return sweeps.map(({ slice, startOffset, sweep }) => {
    const isFullCircle = sweep >= DEGREES_IN_CIRCLE - FULL_CIRCLE_EPSILON;
    return {
      key: slice.key,
      color: slice.color,
      d: isFullCircle
        ? buildRingPath(center, outerRadius, innerRadius)
        : buildSlicePath(center, outerRadius, innerRadius, startAngle + startOffset, sweep),
    };
  });
}

/**
 * Where each labelled slice's leader line and two text lines go — the three
 * collision rules above, applied in one pass over the sweeps.
 *
 * Positions are computed from the slice's **mid-angle**, so a leader always
 * points at the middle of the wedge it belongs to. Labels on the right half
 * read outwards from their line (`textAnchor: 'start'`); labels on the left half
 * read inwards towards it (`'end'`), which is what keeps both columns flush
 * against the canvas edge instead of drifting over the pie.
 *
 * @param {Array<{ slice: object, startOffset: number, sweep: number }>} sweeps
 * @param {{ center: { x: number, y: number }, outerRadius: number,
 *   startAngle: number }} geometry
 * @returns {Array<object>} One entry per label actually placed.
 */
export function buildSliceLabels(sweeps, geometry) {
  const { center, outerRadius, startAngle } = geometry;
  const labels = [];
  const lastPlacedY = { left: null, right: null };

  sweeps.forEach(({ slice, startOffset, sweep }) => {
    if (labels.length >= MAX_OUTSIDE_LABELS || !canLabelSlice(slice)) {
      return;
    }

    const midAngle = startAngle + startOffset + sweep / 2;
    const anchor = pointOnCircle(center, outerRadius, midAngle);
    const elbow = pointOnCircle(center, outerRadius + LEADER_STUB_LENGTH, midAngle);
    const side = elbow.x >= center.x ? 'right' : 'left';
    const direction = side === 'right' ? 1 : -1;

    const previousY = lastPlacedY[side];
    if (previousY !== null && Math.abs(elbow.y - previousY) < LABEL_MIN_VERTICAL_GAP) {
      return;
    }
    lastPlacedY[side] = elbow.y;

    labels.push({
      key: slice.key,
      anchor,
      elbow,
      elbowEndX: round(elbow.x + direction * LEADER_ELBOW_LENGTH),
      textX: round(elbow.x + direction * (LEADER_ELBOW_LENGTH + LABEL_TEXT_GAP)),
      textAnchor: side === 'right' ? 'start' : 'end',
      nameY: elbow.y,
      captionY: round(elbow.y + LABEL_LINE_HEIGHT),
      name: truncateLabel(slice.glyph ? `${slice.glyph} ${slice.label}` : slice.label),
      caption: slice.caption ?? null,
    });
  });

  return labels;
}

/**
 * A slice big enough to label, and with something to print. Exported because
 * the component has to know whether to reserve the label gutters *before* it
 * can place any label: the positions depend on the centre, and the centre
 * depends on the gutters.
 *
 * @param {object} slice
 * @returns {boolean}
 */
export function canLabelSlice(slice) {
  return Boolean(slice.label) && clampShare(slice.share) >= MIN_LABELLED_SLICE_SHARE;
}

function clampShare(share) {
  return Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
}

/** Cut on the string, because SVG text neither reflows nor ellipsizes itself. */
function truncateLabel(text) {
  if (text.length <= MAX_LABEL_CHARACTERS) {
    return text;
  }
  return `${text.slice(0, MAX_LABEL_CHARACTERS - 1).trimEnd()}…`;
}

/**
 * One wedge: out along the start edge, clockwise round the outside, in along the
 * end edge, anticlockwise back round the inside.
 *
 * With `innerRadius` at 0 the two inner points collapse onto the centre and it
 * is a pie wedge instead — the `ringThickness = size / 2` case, which is the
 * Statistics tab's.
 */
function buildSlicePath(center, outerRadius, innerRadius, startAngle, sweepAngle) {
  const endAngle = startAngle + sweepAngle;
  const largeArc = sweepAngle > DEGREES_IN_HALF_CIRCLE ? 1 : 0;
  const outerStart = pointOnCircle(center, outerRadius, startAngle);
  const outerEnd = pointOnCircle(center, outerRadius, endAngle);

  const commands = [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${round(outerRadius)} ${round(outerRadius)} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
  ];

  if (innerRadius <= 0) {
    commands.push(`L ${round(center.x)} ${round(center.y)}`);
  } else {
    const innerEnd = pointOnCircle(center, innerRadius, endAngle);
    const innerStart = pointOnCircle(center, innerRadius, startAngle);
    commands.push(`L ${innerEnd.x} ${innerEnd.y}`);
    commands.push(
      `A ${round(innerRadius)} ${round(innerRadius)} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    );
  }

  commands.push('Z');
  return commands.join(' ');
}

/**
 * The whole circle as one closed path — the single-category-at-100% case.
 *
 * With an inner radius, two subpaths wound in opposite directions, which is what
 * punches the hole under SVG's default non-zero fill rule. Each circle is two
 * half arcs because a single arc back to its own start point is a no-op.
 */
function buildRingPath(center, outerRadius, innerRadius) {
  const commands = [...buildCirclePath(center, outerRadius, 1)];

  if (innerRadius > 0) {
    commands.push(...buildCirclePath(center, innerRadius, 0));
  }

  return commands.join(' ');
}

function buildCirclePath(center, radius, sweepFlag) {
  const left = round(center.x - radius);
  const right = round(center.x + radius);
  const middle = round(center.y);
  const r = round(radius);

  return [
    `M ${left} ${middle}`,
    `A ${r} ${r} 0 1 ${sweepFlag} ${right} ${middle}`,
    `A ${r} ${r} 0 1 ${sweepFlag} ${left} ${middle}`,
    'Z',
  ];
}

/**
 * A point on a circle, with `0°` at twelve o'clock and angles increasing
 * clockwise — SVG's y axis grows downwards, so that is what `sin` already
 * does once the angle is rotated back by a quarter turn.
 *
 * The centre is a point rather than one number because the labelled canvas is
 * wider than it is tall, so the pie's centre is no longer on the diagonal.
 */
function pointOnCircle(center, radius, angleInDegrees) {
  const radians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: round(center.x + radius * Math.cos(radians)),
    y: round(center.y + radius * Math.sin(radians)),
  };
}

/** Two decimals is well under a pixel at these radii and keeps `d` readable. */
function round(value) {
  return Math.round(value * 100) / 100;
}
