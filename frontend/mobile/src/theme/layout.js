/**
 * Shared geometry for the app's floating overlays — the bottom tab bar
 * (navigation/MainTabs.jsx) and the Dashboard's FloatingActionButton
 * (components/FloatingActionButton.jsx).
 *
 * Both overlays float above screen content with `position: 'absolute'`, so
 * any scrollable screen that renders behind them needs bottom padding large
 * enough to fully clear whichever overlay(s) it sits under, plus a
 * comfortable gap — otherwise the last item(s) in the list render partially
 * or fully hidden underneath.
 *
 * This is the single source of truth for that geometry. MainTabs.jsx and
 * FloatingActionButton.jsx read from here to position themselves, and
 * screens read from here to compute correct bottom padding — instead of
 * every consumer re-deriving (or worse, guessing) the same numbers, which
 * silently drifts out of sync the moment one of them changes.
 *
 * SAFE AREAS
 * ----------
 * Every function below takes TWO arguments: the theme, and the `insets`
 * object returned by react-native-safe-area-context's `useSafeAreaInsets()`.
 * `insets.bottom` (the Android navigation bar — 3-button or gesture pill —
 * or the iOS home indicator) is folded into every offset here, in exactly
 * one place, so that:
 *
 * - both overlays move up by the SAME amount and keep their relative
 *   spacing (the FAB stays a fixed `theme.space.lg` gap above the tab bar's
 *   top edge on every device), and
 * - every screen's clearing padding grows by that same amount automatically,
 *   because it is derived from these same functions.
 *
 * Consumers must never add `insets.bottom` themselves on top of a value
 * returned from here — that would double-count it. They pass `insets` in and
 * use the result as-is.
 *
 * On a device with no bottom system bar `insets.bottom` is 0, so every
 * function returns exactly the value it returned before safe-area support
 * existed — the designed spacing is unchanged, not merely approximated.
 *
 * These stay plain functions (not hooks) deliberately: `useSafeAreaInsets()`
 * may only be called from a component, and this module is imported by
 * `createStyles(theme, insets)` helpers that run outside the React call
 * stack. Each consuming component calls the hook itself and threads the
 * result down.
 */

// Defensive read — `useSafeAreaInsets()` always returns a full object, so a
// missing/partial `insets` means a caller forgot to thread it through. Fall
// back to the pre-safe-area behavior rather than throwing (constitution
// Section 22): slightly tight spacing is a far better failure mode than a
// crashed screen.
function getBottomInset(insets) {
  return insets?.bottom ?? 0;
}

// The tab bar's CONTENT height — the band the icons and labels occupy. Fixed
// and not inset-dependent; the bar's total height grows by the inset instead
// (see getTabBarHeight), so the icons keep the same designed band on every
// device rather than being squashed.
export const TAB_BAR_HEIGHT = 64;

// Total height of the bar (navigation/MainTabs.jsx `tabBarStyle.height`).
// The bar is full-width and anchored to the physical screen bottom, so its
// fill extends underneath the bottom system bar and it pads itself by that
// inset from within — that way no screen content is ever visible in the strip
// behind the navigation bar.
export function getTabBarHeight(theme, insets) {
  return TAB_BAR_HEIGHT + getBottomInset(insets);
}

// Distance (px) from the screen bottom to the tab bar's bottom edge
// (navigation/MainTabs.jsx `tabBarStyle.bottom`) — zero: the bar is a
// full-width, square-cornered bar anchored to the physical bottom edge.
//
// It was previously a floating pill inset from the edges and raised by
// `theme.space.lg`. Both were removed deliberately: the strip below it and
// the margins beside it were outside the bar's touch target but still sat on
// top of the scrolling list, so taps near the bar fell through and opened
// whatever row happened to be underneath.
//
// Kept as a function (rather than inlining 0) so the geometry contract stays
// in one place and the composition below still reads correctly.
export function getTabBarBottomOffset(theme, insets) {
  return 0;
}

// Distance (px) from the screen bottom to the tab bar's top edge — the
// minimum any screen content behind it must clear. The bar is anchored at 0
// and is `getTabBarHeight` tall, so this is simply its height.
export function getTabBarTopEdge(theme, insets) {
  return getTabBarBottomOffset(theme, insets) + getTabBarHeight(theme, insets);
}

// FAB's collapsed diameter (components/FloatingActionButton.jsx
// `COLLAPSED_SIZE`). This is also its *height* in both the expanded and
// collapsed states — only width animates, so this is the correct constant
// to use for vertical clearance regardless of expand/collapse state.
export const FAB_COLLAPSED_SIZE = 56;

// Distance (px) from the screen bottom to the FAB's bottom edge
// (components/FloatingActionButton.jsx `glowWrapper.bottom`).
//
// Derived from the tab bar rather than from its own constant, so the FAB
// keeps a fixed `theme.space.lg` gap above the bar's top edge no matter how
// the bar itself is positioned. This used to be a standalone
// `theme.space.xxxl * 3`, which happened to produce the same 16px gap only
// while the bar floated 16px up; once the bar moved flush to the system bar
// that coincidence would have silently doubled the gap.
export function getFabBottomOffset(theme, insets) {
  return getTabBarTopEdge(theme, insets) + theme.space.lg;
}

// Distance (px) from the screen bottom to the FAB's top edge — the minimum
// any screen content behind it must clear.
export function getFabTopEdge(theme, insets) {
  return getFabBottomOffset(theme, insets) + FAB_COLLAPSED_SIZE;
}
