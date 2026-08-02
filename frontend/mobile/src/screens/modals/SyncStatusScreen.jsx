import React, { useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { describeOpFailure } from '../../store/useSyncStore';
import { describeNotice, describeOp, pluralizeChanges } from '../../utils/syncDisplay';
import { formatDateTimeLabel } from '../../utils/dateDisplay';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import TextButton from '../../components/TextButton';
import PrimaryButton from '../../components/PrimaryButton';
import ConfirmationDialog from '../../components/ConfirmationDialog';

/**
 * Sync Status — docs/decisions/0027-offline-first-local-cache-and-replay-sync.md
 * §8.6/§8.9. A root modal beside AddExpense, opened from the offline banner.
 *
 * Shows the last successful sync, the queue in order, failed and blocked
 * changes with their reason and Retry / Discard, the notices (superseded,
 * failed, discarded) with Dismiss, and "Sync now" (disabled offline).
 *
 * "Edit" on a failed transaction op (§8.6) is not offered yet: the engine's
 * in-place replacement (`replaceOpPayload`) exists, but Add Expense has no
 * "edit a queued op" mode. Discard + re-enter covers the case meanwhile.
 */
function SyncStatusScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme, insets);
  const navigation = useNavigation();
  const {
    isOnline,
    isFlushing,
    ops,
    notices,
    lastSuccessfulSyncAt,
    syncNow,
    retryOp,
    discardOp,
    getDependentsOf,
    dismissNotice,
  } = useSyncStatus();
  const [discardTarget, setDiscardTarget] = useState(null);

  const problemOps = ops.filter((op) => op.status === 'failed' || op.status === 'blocked');
  const waitingOps = ops.filter((op) => op.status === 'pending' || op.status === 'inflight');
  const dependents = discardTarget ? getDependentsOf(discardTarget.opId) : [];

  async function handleConfirmDiscard() {
    const target = discardTarget;
    setDiscardTarget(null);
    if (target) {
      await discardOp(target.opId);
    }
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Sync Status" onClose={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <Text style={styles.label}>LAST SYNCED</Text>
          <Text style={styles.value}>
            {lastSuccessfulSyncAt ? formatDateTimeLabel(lastSuccessfulSyncAt) : 'Not yet'}
          </Text>
          <Text style={styles.caption}>
            {isOnline ? 'Online' : "You're offline. Changes sync when you reconnect."}
          </Text>
          <PrimaryButton
            label="Sync now"
            onPress={syncNow}
            disabled={!isOnline}
            loading={isFlushing}
            glow={false}
            style={styles.syncButton}
          />
        </Card>

        <Text style={styles.sectionHeader}>NEEDS ATTENTION</Text>
        {problemOps.length === 0 ? (
          <Text style={styles.empty}>Nothing needs attention.</Text>
        ) : (
          problemOps.map((op) => (
            <Card key={op.opId} style={styles.card}>
              <Text style={styles.opTitle}>{describeOp(op)}</Text>
              <Text style={styles.problem}>{describeOpFailure(op)}</Text>
              <View style={styles.actions}>
                <TextButton label="Retry" inline onPress={() => retryOp(op.opId)} />
                <TextButton
                  label="Discard"
                  inline
                  tone="negative"
                  onPress={() => setDiscardTarget(op)}
                  style={styles.actionGap}
                />
              </View>
            </Card>
          ))
        )}

        <Text style={styles.sectionHeader}>
          WAITING TO SYNC{waitingOps.length > 0 ? ` · ${waitingOps.length}` : ''}
        </Text>
        {waitingOps.length === 0 ? (
          <Text style={styles.empty}>All changes are synced.</Text>
        ) : (
          <Card style={styles.card}>
            {waitingOps.map((op) => (
              <Text key={op.opId} style={styles.queueRow}>
                {describeOp(op)}
                {op.status === 'inflight' ? ' · sending' : ''}
              </Text>
            ))}
          </Card>
        )}

        <Text style={styles.sectionHeader}>NOTICES</Text>
        {notices.length === 0 ? (
          <Text style={styles.empty}>No notices.</Text>
        ) : (
          notices.map((notice) => (
            <Card key={notice.id} style={styles.card}>
              <Text style={styles.noticeText}>{describeNotice(notice)}</Text>
              <TextButton label="Dismiss" inline onPress={() => dismissNotice(notice.id)} />
            </Card>
          ))
        )}
      </ScrollView>

      <ConfirmationDialog
        visible={Boolean(discardTarget)}
        title="Discard this change?"
        message={
          dependents.length > 0
            ? `It will be removed from this device, together with ${pluralizeChanges(
                dependents.length,
              )} that depend on it: ${dependents.map(describeOp).join('; ')}.`
            : 'It will be removed from this device and never synced.'
        }
        confirmLabel="Discard"
        onConfirm={handleConfirmDiscard}
        onCancel={() => setDiscardTarget(null)}
      />
    </View>
  );
}

function createStyles(theme, insets) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    content: {
      paddingHorizontal: theme.space.lg,
      paddingBottom: insets.bottom + theme.space.xxxl,
    },
    card: {
      marginBottom: theme.space.md,
    },
    label: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      letterSpacing: theme.type.label.letterSpacing,
    },
    value: {
      marginTop: theme.space.xs,
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    caption: {
      marginTop: theme.space.xs,
      color: theme.color.text.secondary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.caption.lineHeight,
    },
    syncButton: {
      marginTop: theme.space.md,
    },
    sectionHeader: {
      marginTop: theme.space.lg,
      marginBottom: theme.space.sm,
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      letterSpacing: theme.type.label.letterSpacing,
    },
    empty: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginBottom: theme.space.sm,
    },
    opTitle: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
    problem: {
      marginTop: theme.space.xs,
      color: theme.color.status.negative,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    actions: {
      flexDirection: 'row',
      marginTop: theme.space.sm,
    },
    actionGap: {
      marginLeft: theme.space.lg,
    },
    queueRow: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight + theme.space.xs,
    },
    noticeText: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.xs,
    },
  });
}

export default SyncStatusScreen;
