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
 */

// Tab bar height (navigation/MainTabs.jsx `tabBarStyle.height`) — fixed,
// not theme-dependent.
export const TAB_BAR_HEIGHT = 64;

// Distance (px) from the screen bottom to the tab bar's bottom edge
// (navigation/MainTabs.jsx `tabBarStyle.bottom`).
export function getTabBarBottomOffset(theme) {
  return theme.space.lg;
}

// Distance (px) from the screen bottom to the tab bar's top edge — the
// minimum any screen content behind it must clear.
export function getTabBarTopEdge(theme) {
  return getTabBarBottomOffset(theme) + TAB_BAR_HEIGHT;
}

// FAB's collapsed diameter (components/FloatingActionButton.jsx
// `COLLAPSED_SIZE`). This is also its *height* in both the expanded and
// collapsed states — only width animates, so this is the correct constant
// to use for vertical clearance regardless of expand/collapse state.
export const FAB_COLLAPSED_SIZE = 56;

// Distance (px) from the screen bottom to the FAB's bottom edge
// (components/FloatingActionButton.jsx `glowWrapper.bottom`).
export function getFabBottomOffset(theme) {
  return theme.space.xxxl * 3;
}

// Distance (px) from the screen bottom to the FAB's top edge — the minimum
// any screen content behind it must clear.
export function getFabTopEdge(theme) {
  return getFabBottomOffset(theme) + FAB_COLLAPSED_SIZE;
}
