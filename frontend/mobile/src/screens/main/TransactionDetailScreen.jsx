import React, { useState } from 'react';
import { View, Text, ScrollView, Image, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useTransactionsStore } from '../../store/useTransactionsStore';
import { useSplitExpensesStore } from '../../store/useSplitExpensesStore';
import { useProfileStore } from '../../store/useProfileStore';
import { useActivityLogStore } from '../../store/useActivityLogStore';
import { profileUser } from '../../mocks/profileMocks';
import { dashboardSummary } from '../../mocks/dashboardMocks';
import { getExactDateLabel, getTimeLabel } from '../../utils/dateDisplay';
import ScreenHeader from '../../components/ScreenHeader';
import IconBadge from '../../components/IconBadge';
import Card from '../../components/Card';
import PrimaryButton from '../../components/PrimaryButton';
import ActivityLogItem from '../../components/ActivityLogItem';
import ConfirmationDialog from '../../components/ConfirmationDialog';

/**
 * Transaction Detail — MyExpense tab stack push (docs/architecture/
 * frontend-navigation.md §2.3/§11, docs/decisions/
 * 0007-transaction-detail-screen.md). Reached by tapping a Dashboard
 * transaction row (navigation.navigate('TransactionDetail', {
 * transactionId })). Mock data only — reads/writes useTransactionsStore, no
 * backend call.
 *
 * "PAID" tag semantics (ADR 0007 §4, correctness-critical — reads real
 * "who paid" split data): shown only when this transaction came from Split
 * Add Expense's "add to my expenses" checkbox (splitExpenseId != null) AND
 * the linked split record's paidById === 'self' (the user fronted the whole
 * split; this transaction records their own consumption share of it). A
 * split-originated transaction where someone else paid shows no tag at all
 * — the existing SPLIT badge on the Dashboard row already signals split
 * origin; PAID narrows that further to the subset the user personally
 * fronted.
 *
 * Payment Method card premium gating (ADR 0007 §3.4/§11.5): free vs.
 * premium display, gated on useProfileStore().isPremiumUser. Rendered
 * unconditionally — NOT gated on useSettingsStore().paymentModeEnabled,
 * which only controls the Dashboard row's compact chip — since every
 * transaction always carries a real, non-null paymentMode value.
 *
 * Edit navigates to the existing AddExpenseScreen in edit mode
 * (editingTransactionId param) rather than an inline-editing surface here —
 * ADR 0007 §6's explicit reuse decision, avoiding a second, parallel
 * editing UI (constitution §25). Delete confirms via the shared, themed
 * ConfirmationDialog (docs/decisions/0013-confirmation-dialog-and-free-tier-polish.md
 * §2) before calling deleteTransaction and navigating back — replaces the
 * OS-default Alert.alert this screen used previously; exact copy unchanged.
 *
 * Delete button placement (ADR 0007's 2026-08-13 "second same-day
 * follow-up" amendment, Part B): Delete lives in ScreenHeader's rightSlot
 * as a plain icon (HeaderDeleteButton, below) — no circular tint container,
 * matching every other header rightSlot icon's bare layout, but keeping
 * color.status.negative since it remains a genuinely destructive action.
 * Edit is the sole, full-width PrimaryButton at the end of the scrollable
 * content — the actionsRow this screen originally shared between Edit and
 * Delete no longer exists.
 *
 * ACTIVITY card (docs/decisions/0008-activity-log-system.md §2.7/§3):
 * filters useActivityLogStore().activities down to this transaction's own
 * entries (relatedTransactionId === transaction.id), most-recent-first by
 * construction (the store always prepends). Fully omitted — not a
 * placeholder — when there are zero matching entries, the same convention
 * already used for NOTES/RECEIPT ATTACHMENT above. Positioned after RECEIPT
 * ATTACHMENT, before the Edit button.
 *
 * Receipt Attachment card is read-only display here (an Image when
 * transaction.receiptUri is present, fully omitted otherwise) — per ADR
 * 0007 §5/§11.3, this card has no tap-to-pick/replace interaction of its
 * own on this screen; picking/replacing a receipt photo happens only
 * through Edit -> AddExpenseScreen's RECEIPT ATTACHMENT field (§6.8),
 * consistent with the ADR's explicit "Edit navigates to AddExpenseScreen...
 * not an inline-editing surface on the Detail screen itself" decision.
 *
 * Neither Edit nor Delete cascades into useSplitExpensesStore's participant
 * amounts or yourBalance — explicitly out of scope per ADR 0007.
 */
function TransactionDetailScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme);

  const transactions = useTransactionsStore((state) => state.transactions);
  const deleteTransaction = useTransactionsStore((state) => state.deleteTransaction);
  const splitExpenses = useSplitExpensesStore((state) => state.splitExpenses);
  const isPremiumUser = useProfileStore((state) => state.isPremiumUser);
  const activities = useActivityLogStore((state) => state.activities);
  const [isDeleteDialogVisible, setIsDeleteDialogVisible] = useState(false);

  // Reactive lookup (not a one-time snapshot) — ADR 0007 §8 — so this
  // screen reflects an Edit's changes on return from AddExpense, and
  // reflects Delete's removal immediately if it somehow re-renders before
  // unmounting.
  const transaction = transactions.find((item) => item.id === route.params?.transactionId);

  // Defensive case (constitution §22) — a stale/deep-link/already-deleted
  // id must not crash on an undefined transaction's fields.
  if (!transaction) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="Transaction Details" onBack={() => navigation.goBack()} />
        <View style={styles.notFoundContainer}>
          <Text style={styles.notFoundText}>
            This transaction couldn&apos;t be found. It may have already been deleted.
          </Text>
          <PrimaryButton
            label="Go Back"
            onPress={() => navigation.goBack()}
            style={styles.notFoundButton}
          />
        </View>
      </View>
    );
  }

  // "PAID" tag — ADR 0007 §4's exact condition.
  const splitExpense = transaction.splitExpenseId
    ? splitExpenses.find((split) => split.id === transaction.splitExpenseId)
    : null;
  const showPaidTag = splitExpense != null && splitExpense.paidById === 'self';

  // ACTIVITY card — ADR 0008 §3. Filtered to this transaction only,
  // most-recent-first by construction (the store always prepends) — no
  // separate sort needed.
  const transactionActivities = activities.filter(
    (activity) => activity.relatedTransactionId === transaction.id,
  );

  const { currencySymbol } = dashboardSummary;
  const isIncome = transaction.type === 'income';
  const amountColor = isIncome ? theme.color.status.positive : theme.color.status.negative;
  const amountSign = isIncome ? '+' : '-';

  function handleEdit() {
    navigation.navigate('AddExpense', { editingTransactionId: transaction.id });
  }

  function handleDelete() {
    setIsDeleteDialogVisible(true);
  }

  function handleConfirmDelete() {
    deleteTransaction(transaction.id);
    setIsDeleteDialogVisible(false);
    navigation.goBack();
  }

  function handleCancelDelete() {
    setIsDeleteDialogVisible(false);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Transaction Details"
        onBack={() => navigation.goBack()}
        rightSlot={<HeaderDeleteButton onPress={handleDelete} />}
      />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <IconBadge
            glyph={transaction.glyph}
            tone={transaction.tone}
            size="large"
            style={styles.heroIcon}
          />
          <Text style={styles.heroTitle}>{transaction.title}</Text>
          <Text style={[styles.heroAmount, { color: amountColor }]}>
            {amountSign}
            {currencySymbol}
            {transaction.amount.toLocaleString('en-IN')}
          </Text>
          <View style={styles.tagRow}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{transaction.category.toUpperCase()}</Text>
            </View>
            {showPaidTag ? (
              <View style={styles.tag}>
                <Text style={styles.tagText}>PAID</Text>
              </View>
            ) : null}
          </View>
        </View>

        <Card style={styles.card}>
          <Text style={styles.cardLabel}>DATE & TIME</Text>
          <Text style={styles.cardValuePrimary}>{getExactDateLabel(transaction.date)}</Text>
          <Text style={styles.cardValueSecondary}>{getTimeLabel(transaction.time)}</Text>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardLabel}>PAYMENT METHOD</Text>
          <PaymentMethodContent
            styles={styles}
            transaction={transaction}
            isPremiumUser={isPremiumUser}
            currencySymbol={currencySymbol}
          />
        </Card>

        {transaction.notes ? (
          <Card style={styles.card}>
            <Text style={styles.cardLabel}>NOTES</Text>
            <Text style={styles.notesText}>{transaction.notes}</Text>
          </Card>
        ) : null}

        {transaction.receiptUri ? (
          <Card style={styles.card}>
            <Text style={styles.cardLabel}>RECEIPT ATTACHMENT</Text>
            <Image
              source={{ uri: transaction.receiptUri }}
              style={styles.receiptImage}
              resizeMode="cover"
            />
          </Card>
        ) : null}

        {transactionActivities.length > 0 ? (
          <Card style={styles.card}>
            <Text style={styles.cardLabel}>ACTIVITY</Text>
            {transactionActivities.map((activity, index) => (
              <ActivityLogItem
                key={activity.id}
                activity={activity}
                isLast={index === transactionActivities.length - 1}
              />
            ))}
          </Card>
        ) : null}

        <PrimaryButton label="Edit" onPress={handleEdit} style={styles.editButton} />
      </ScrollView>

      <ConfirmationDialog
        visible={isDeleteDialogVisible}
        title="Delete Transaction"
        message={`Are you sure you want to delete "${transaction.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </View>
  );
}

/**
 * Delete control — composed into ScreenHeader's rightSlot (ADR 0007's
 * 2026-08-13 amendment, Part B). A plain icon, no circular tint container —
 * matching every other header rightSlot icon's bare layout (the split/
 * adjust-split header checkmark, AdjustSplitScreen's pencil) — but keeping
 * color.status.negative since this remains a genuinely destructive action,
 * unlike those neutral header icons. hitSlop={8} matches ScreenHeader's own
 * onBack/onClose convention exactly.
 */
function HeaderDeleteButton({ onPress }) {
  const theme = useTheme();
  const styles = createHeaderDeleteButtonStyles(theme);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Delete transaction"
    >
      {/* Placeholder Text glyph standing in for Ionicons `trash-outline`
          (design-system.md §6/§11) — the real icon library isn't
          installed/linked in this codebase yet, matching the same
          glyph-fallback convention already used throughout this app
          (ScreenHeader's ←/✕, AddExpenseScreen's ▦, etc). Swap for a real
          <Icon> once the library is wired in.
          Corrected 2026-08-14 (docs/decisions/
          0013-confirmation-dialog-and-free-tier-polish.md §1.1): the
          previous glyph, ⌧ (U+232B), read as an "X" and risked colliding
          with ScreenHeader's own close/X (✕) concept — reported by the
          Project Owner. 🗑 (U+1F5D1, WASTEBASKET) is the only glyph in this
          app's fallback vocabulary that actually depicts a trash can.
          Flagged risk: unlike every other glyph here (←, ✕, ✓, ⇄, ✎), 🗑
          sits in an emoji-heavy Unicode block and may render in full color
          on some platform/font combinations, ignoring the `color` style
          below. Visually verify on-device; if it renders off-tone, the
          ADR's suggested fallback is a plain abstract non-X symbol (▥) —
          worse at depicting "trash" but still not misleading. */}
      <Text style={styles.icon}>🗑</Text>
    </Pressable>
  );
}

function createHeaderDeleteButtonStyles(theme) {
  return StyleSheet.create({
    icon: {
      color: theme.color.status.negative,
      fontSize: 20,
      fontWeight: '700',
    },
  });
}

/**
 * Payment Method card content — ADR 0007 §3.4/§11.5's exact free/premium
 * table. A small presentational subcomponent (not inline JSX in the parent)
 * purely to keep the branching readable; it holds no state/lifecycle of its
 * own and reads everything from props.
 */
function PaymentMethodContent({ styles, transaction, isPremiumUser, currencySymbol }) {
  const { paymentMode, cashAmount, onlineAmount } = transaction;

  if (!isPremiumUser) {
    // Free tier: plain Title Case wording — "Cash"/"Online"/"Both" — same
    // words the Dashboard's ALL-CAPS badge uses, just not chip-styled (this
    // is a labeled value block, not a compact list-row tag). Falls back to
    // "Cash" for the defensive absent/undefined case.
    const label =
      paymentMode === 'online' ? 'Online' : paymentMode === 'both' ? 'Both' : 'Cash';
    return <Text style={styles.cardValuePrimary}>{label}</Text>;
  }

  if (paymentMode === 'online') {
    return (
      <>
        <Text style={styles.cardValuePrimary}>Unified Payments Interface</Text>
        <Text style={styles.cardValueCaption}>UPI ID: {profileUser.mockUpiId}</Text>
      </>
    );
  }

  if (paymentMode === 'both') {
    return (
      <>
        <View style={styles.paymentRow}>
          <Text style={styles.paymentRowLabel}>Cash</Text>
          <Text style={styles.paymentRowValue}>
            {currencySymbol}
            {(cashAmount ?? 0).toLocaleString('en-IN')}
          </Text>
        </View>
        <View style={styles.paymentRow}>
          <Text style={styles.paymentRowLabel}>Unified Payments Interface</Text>
          <Text style={styles.paymentRowValue}>
            {currencySymbol}
            {(onlineAmount ?? 0).toLocaleString('en-IN')}
          </Text>
        </View>
        <Text style={styles.cardValueCaption}>UPI ID: {profileUser.mockUpiId}</Text>
      </>
    );
  }

  // 'cash', or absent/undefined (defensive fallback, constitution §22 —
  // should not occur, every transaction has a real paymentMode).
  return <Text style={styles.cardValuePrimary}>Cash</Text>;
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      // No FAB on this screen (getFabTopEdge doesn't apply here, per ADR
      // 0007 §9) — only the floating tab bar needs clearing, same helper
      // ProfileScreen.jsx already uses for an equivalent screen shape.
      paddingBottom: getTabBarTopEdge(theme) + theme.space.lg,
    },
    notFoundContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.space.xl,
    },
    notFoundText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      marginBottom: theme.space.lg,
    },
    notFoundButton: {
      minWidth: 160,
    },
    hero: {
      alignItems: 'center',
      marginBottom: theme.space.xl,
    },
    heroIcon: {
      marginBottom: theme.space.md,
    },
    heroTitle: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      textAlign: 'center',
      marginBottom: theme.space.sm,
    },
    heroAmount: {
      fontSize: theme.type.display.fontSize,
      lineHeight: theme.type.display.lineHeight,
      fontWeight: theme.type.display.fontWeight,
      textAlign: 'center',
      marginBottom: theme.space.md,
    },
    tagRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: theme.space.sm,
    },
    tag: {
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      backgroundColor: theme.color.background.surfaceAlt,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.xs,
    },
    tagText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
    },
    card: {
      marginBottom: theme.space.md,
    },
    cardLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.sm,
    },
    cardValuePrimary: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      lineHeight: theme.type.bodyLg.lineHeight,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    cardValueSecondary: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginTop: theme.space.xs,
    },
    cardValueCaption: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.caption.lineHeight,
      marginTop: theme.space.xs,
    },
    paymentRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: theme.space.xs,
    },
    paymentRowLabel: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    paymentRowValue: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    notesText: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    receiptImage: {
      width: '100%',
      height: 200,
      borderRadius: theme.radius.md,
    },
    // Sole, full-width bottom action (ADR 0007's 2026-08-13 amendment, Part
    // B) — the row wrapper it previously shared with the now-header-relocated
    // Delete control is gone; matches AddExpenseScreen's/NewGroupScreen's own
    // "lone primary CTA as the last scrollable item" pattern.
    editButton: {
      marginTop: theme.space.md,
      marginBottom: theme.space.lg,
    },
  });
}

export default TransactionDetailScreen;
