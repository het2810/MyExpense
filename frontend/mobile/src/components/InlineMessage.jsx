import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import FormMessage from './FormMessage';
import TextButton from './TextButton';

/**
 * A failed request's message, with an optional Retry — constitution §22's
 * "meaningful message, recovery action where appropriate" for a block of a
 * screen that is backed by its own request, rather than for a form's submit
 * button (which is what `FormMessage` alone covers).
 *
 * Renders nothing when there is no message, so every call site can be
 * unconditional.
 *
 * **Promoted from ProfileScreen on 2026-10-23, not newly invented.** It lived
 * there as a local component with the note "two call sites in one file is not
 * yet constitution §25's threshold for promoting it to src/components/";
 * ManageCategoriesScreen adds two more (a failed settings read and a failed
 * categories read), which crosses it. The markup, the styles and therefore the
 * rendering are unchanged — Profile looks exactly as it did.
 *
 * It reuses the shared `FormMessage` for the text rather than introducing a
 * second error-text treatment (ADR 0016 §9.4), with the bottom margin
 * tightened so the Retry sits with its message instead of a form field.
 *
 * Not adopted by CategoryPickerScreen's own load-failure block, deliberately:
 * that one is a full-width "the list could not load" state with its own
 * spacing inside the list area, and that screen is verified working on device.
 * Flagged for a later pass rather than changed as a drive-by (constitution
 * §20).
 *
 * @param {{
 *   message: string | null,
 *   onRetry?: (() => void) | null,
 *   style?: object,
 * }} props
 */
function InlineMessage({ message, onRetry, style }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  if (!message) {
    return null;
  }

  return (
    <View style={[styles.block, style]}>
      <FormMessage message={message} style={styles.message} />
      {onRetry ? <TextButton label="Retry" onPress={onRetry} style={styles.retry} /> : null}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    block: {
      marginBottom: theme.space.lg,
    },
    message: {
      marginBottom: theme.space.xs,
    },
    retry: {
      alignSelf: 'center',
    },
  });
}

export default InlineMessage;
