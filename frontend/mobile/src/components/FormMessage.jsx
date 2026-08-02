import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Form-level message block — the slot for errors that belong to no single
 * field. Sits directly above a form's primary button.
 *
 * Added by docs/decisions/0016-frontend-api-integration.md §9.4, following
 * docs/decisions/0001-shared-component-library.md's conventions (theme-aware
 * via useTheme, no hardcoded colors or spacing). Extracted up front rather
 * than after the third copy because all three auth screens need it — the
 * constitution §25 "duplicate three times -> extract" threshold is met before
 * the first line is written.
 *
 * `tone`:
 * - `'negative'` (default) — INVALID_CREDENTIALS, ACCOUNT_LOCKED,
 *   RATE_LIMIT_EXCEEDED, offline/timeout. Renders in `status.negative`.
 * - `'neutral'` — informational, not an error. Renders in `text.secondary`.
 *   Covers ADR 0016 §9.2's "Your account was created. Please sign in."
 *
 * Renders nothing when `message` is empty, so callers can pass state
 * directly without their own conditional.
 */
function FormMessage({ message, tone = 'negative', style }) {
  const theme = useTheme();
  const styles = createStyles(theme, tone);

  if (!message) {
    return null;
  }

  return (
    <Text style={[styles.message, style]} accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

function createStyles(theme, tone) {
  return StyleSheet.create({
    message: {
      color: tone === 'neutral' ? theme.color.text.secondary : theme.color.status.negative,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      marginBottom: theme.space.lg,
    },
  });
}

export default FormMessage;
