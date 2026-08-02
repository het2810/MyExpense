import React from 'react';
import { Modal, Pressable, Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import Card from './Card';
import TextButton from './TextButton';
import PrimaryButton from './PrimaryButton';

/**
 * Reusable, themed confirmation dialog — replaces OS-default `Alert.alert`
 * confirmations with an on-brand `Modal` (the first use of React Native
 * core `Modal` anywhere in this app; no new dependency, exactly like `Alert`
 * before it). See docs/decisions/0013-confirmation-dialog-and-free-tier-polish.md
 * §2 and docs/ui/design-system.md §16.
 *
 * Genuinely generic, not Transaction-Detail-specific: any future
 * destructive/confirming action (deleting a group, a contact, a category)
 * can reuse this with zero new component work — it holds no
 * Transaction-Detail knowledge of any kind, only the props below. Wired
 * this round to TransactionDetailScreen's Delete flow only; Settle Up does
 * NOT use this component (its confirmation is a dedicated, richer screen —
 * see the ADR).
 *
 * `destructive` (default `true`) controls the confirm button's tone:
 * `PrimaryButton`'s `status.negative` `tone="negative"` when true, the
 * normal accent fill (`tone="default"`) when false — so this same component
 * also serves future non-destructive confirmations.
 *
 * Tap-outside-to-dismiss: the full-bleed backdrop `Pressable` calls
 * `onCancel`. The `Card` itself is wrapped in its own non-dismissing
 * `Pressable` (an empty no-op `onPress`) so a tap on the card doesn't bubble
 * up and trigger the backdrop's cancel — RN's `Pressable` doesn't bubble
 * touch events like DOM `stopPropagation`, so an intercepting `onPress` on
 * the inner Pressable is what actually prevents that here.
 * `onRequestClose` is wired to `onCancel` as well, for Android's hardware
 * back button.
 */
function ConfirmationDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityRole="none">
        <Pressable onPress={() => {}}>
          <Card style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>
            <View style={styles.actions}>
              <TextButton label={cancelLabel} onPress={onCancel} />
              <PrimaryButton
                label={confirmLabel}
                onPress={onConfirm}
                tone={destructive ? 'negative' : 'default'}
              />
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: theme.color.overlay.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.space.xl,
    },
    card: {
      width: '100%',
      maxWidth: 360,
    },
    title: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      marginBottom: theme.space.sm,
    },
    message: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.xl,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
  });
}

export default ConfirmationDialog;
