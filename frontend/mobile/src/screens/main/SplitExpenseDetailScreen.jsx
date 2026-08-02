import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useSplitExpenseDetail } from '../../hooks/useSplitExpenseDetail';
import { splitSummary } from '../../mocks/splitMocks';
import { formatCategoryPath } from '../../utils/categories';
import { formatSplitAmount } from '../../utils/currency';
import { getExactDateLabel } from '../../utils/dateDisplay';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import IconBadge from '../../components/IconBadge';
import InlineMessage from '../../components/InlineMessage';
import PrimaryButton from '../../components/PrimaryButton';
import FormMessage from '../../components/FormMessage';
import HeaderDeleteButton from '../../components/HeaderDeleteButton';
import ConfirmationDialog from '../../components/ConfirmationDialog';
import PendingSyncChip from '../../components/PendingSyncChip';

/**
 * Split Expense Detail — screen inventory #11, docs/decisions/
 * 0028-split-expense-edit-delete-feeds-and-balance-copy.md §11.3–§11.6.
 * Pushed from a Split Detail feed row with `{ splitExpenseId, target }`.
 *
 * Reads the split from the feed cache (works offline) and refreshes it once
 * online; a `404` reads "This expense was deleted." with a way back. Shows the
 * title, amount, category, date, who added it, one line per person
 * (`participantLine`) and the routing note for multi-contact splits.
 *
 * Header: Edit (✎, opens Split Add Expense with `editingSplitExpenseId`) and
 * Delete (🗑, through ConfirmationDialog) when permitted (§11.4); otherwise the
 * creator-only caption. Every sentence and rule lives in
 * `hooks/useSplitExpenseDetail.js` and `utils/balanceCopy.js`.
 */
function SplitExpenseDetailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme, insets);
  const { splitExpenseId, target } = route.params ?? {};
  const { currencySymbol } = splitSummary;

  const detail = useSplitExpenseDetail({ splitExpenseId, target, currencySymbol });
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const { splitExpense, details } = detail;

  async function handleConfirmDelete() {
    setIsConfirmingDelete(false);
    setDeleteError(null);
    const result = await detail.deleteSplitExpense();
    if (result.success) {
      navigation.goBack();
    } else if (result.error) {
      setDeleteError(result.error);
    }
  }

  if (detail.isDeleted || !splitExpense) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="Expense" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          {detail.isDeleted || detail.hasLoaded ? (
            <>
              <Text style={styles.centeredText}>
                {detail.isDeleted ? 'This expense was deleted.' : "This expense couldn't be found."}
              </Text>
              <PrimaryButton label="Go Back" onPress={() => navigation.goBack()} style={styles.backButton} />
            </>
          ) : detail.loadError ? (
            <InlineMessage message={detail.loadError} onRetry={detail.reload} />
          ) : (
            <Text style={styles.centeredText}>Loading…</Text>
          )}
        </View>
      </View>
    );
  }

  const headerActions = details.canEdit ? (
    <View style={styles.headerActions}>
      <Pressable
        onPress={() => navigation.navigate('SplitAddExpense', { editingSplitExpenseId: splitExpense.id })}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Edit expense"
        style={styles.editButton}
      >
        <Text style={styles.editGlyph}>✎</Text>
      </Pressable>
      <HeaderDeleteButton
        onPress={() => setIsConfirmingDelete(true)}
        accessibilityLabel="Delete expense"
        disabled={detail.isDeleting}
      />
    </View>
  ) : null;

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Expense" onBack={() => navigation.goBack()} rightSlot={headerActions} />
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.card}>
          <View style={styles.titleRow}>
            <IconBadge glyph={splitExpense.categoryGlyph} tone={splitExpense.categoryTone ?? 'neutral'} />
            <View style={styles.titleText}>
              <Text style={styles.title}>{splitExpense.title}</Text>
              <Text style={styles.meta}>
                {formatCategoryPath(splitExpense.parentCategoryName, splitExpense.categoryName)}
              </Text>
            </View>
          </View>
          <Text style={styles.amount}>
            {currencySymbol}
            {formatSplitAmount(splitExpense.amount)}
          </Text>
          <Text style={styles.meta}>{getExactDateLabel(splitExpense.splitDate)}</Text>
          {details.addedBy ? <Text style={styles.meta}>Added by {details.addedBy}</Text> : null}
          <PendingSyncChip status={detail.localSyncStatus} />
        </Card>

        <Card style={styles.card}>
          {details.lines.map((line) => (
            <Text key={line.key} style={styles.personLine}>
              {line.text}
            </Text>
          ))}
          {details.routing ? <Text style={styles.routing}>{details.routing}</Text> : null}
        </Card>

        {details.canEdit ? null : <Text style={styles.caption}>{details.creatorCaption}</Text>}
        <FormMessage message={deleteError} />
      </ScrollView>

      <ConfirmationDialog
        visible={isConfirmingDelete}
        title="Delete this expense?"
        message={details.deleteMessage}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsConfirmingDelete(false)}
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
    container: {
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      paddingBottom: getTabBarTopEdge(theme, insets) + theme.space.lg,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.space.xl,
    },
    centeredText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      marginBottom: theme.space.lg,
    },
    backButton: {
      minWidth: 160,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    editButton: {
      marginRight: theme.space.lg,
    },
    editGlyph: {
      color: theme.color.text.primary,
      fontSize: 20,
    },
    card: {
      marginBottom: theme.space.md,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: theme.space.md,
    },
    titleText: {
      flex: 1,
      marginLeft: theme.space.md,
    },
    title: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: '600',
    },
    amount: {
      color: theme.color.text.primary,
      fontSize: theme.type.h1.fontSize,
      lineHeight: theme.type.h1.lineHeight,
      fontWeight: theme.type.h1.fontWeight,
      marginBottom: theme.space.xs,
    },
    meta: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    personLine: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.xs,
    },
    routing: {
      marginTop: theme.space.sm,
      color: theme.color.text.secondary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.caption.lineHeight,
    },
    caption: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      textAlign: 'center',
      marginBottom: theme.space.md,
    },
  });
}

export default SplitExpenseDetailScreen;
