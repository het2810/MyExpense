import React, { useState } from 'react';
import { View, Text, ScrollView, Image, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useSplitExpensesStore } from '../../store/useSplitExpensesStore';
import { useTransactionDetail } from '../../hooks/useTransactionDetail';
import { useUserIdentity } from '../../hooks/useUserIdentity';
import { dashboardSummary } from '../../mocks/dashboardMocks';
import { getExactDateLabel, getTimeLabel } from '../../utils/dateDisplay';
import { formatCategoryPath } from '../../utils/categories';
import { findCallerPaid } from '../../utils/splitParticipants';
import ScreenHeader from '../../components/ScreenHeader';
import IconBadge from '../../components/IconBadge';
import Card from '../../components/Card';
import PrimaryButton from '../../components/PrimaryButton';
import InlineMessage from '../../components/InlineMessage';
import ChangeLogCard from '../../components/ChangeLogCard';
import ConfirmationDialog from '../../components/ConfirmationDialog';
import HeaderDeleteButton from '../../components/HeaderDeleteButton';

/**
 * Transaction Detail — MyExpense tab stack push (docs/architecture/
 * frontend-navigation.md §2.3/§11, docs/decisions/
 * 0007-transaction-detail-screen.md). Reached by tapping a Dashboard
 * transaction row (navigation.navigate('TransactionDetail', {
 * transactionId })).
 *
 * **Server-backed as of Domain 4's wiring step.** It reads the held
 * `TransactionResponse` row and, through `useTransactionDetail`, the
 * single-resource `GET /api/v1/transactions/{id}` (docs/api/api-overview.md
 * §4.3) for the two things only that endpoint carries: the premium
 * payment-method wording and `receiptSignedUrl`. Delete is a real
 * `DELETE /transactions/{id}` (§4.5, a soft delete server-side).
 *
 * Every displayed value comes from the server: the category path from
 * `parentCategoryName` + `categoryName`, the badge from `categoryGlyph`/
 * `categoryTone`, the date and time from `txnDate`/`txnTime`. Nothing is
 * re-derived locally, and income — which carries `categoryId: null` with
 * server-supplied snapshot constants — needs no special case here at all.
 *
 * "PAID" tag semantics (ADR 0007 §4, correctness-critical — reads real
 * "who paid" split data): shown only when this transaction came from Split
 * Add Expense's "add to my expenses" checkbox (splitExpenseId != null) AND
 * the user appears in the linked split record's `payers[]` with any amount
 * (docs/decisions/0025-multiple-payers-per-split-expense.md §8.7 — "fronted
 * part of it" generalises ADR 0007's "fronted the whole split" once a split
 * can have several payers; this transaction still records only their own
 * consumption share). A
 * split-originated transaction where someone else paid shows no tag at all
 * — the existing SPLIT badge on the Dashboard row already signals split
 * origin; PAID narrows that further to the subset the user personally
 * fronted.
 *
 * Payment Method card premium gating (ADR 0007 §3.4/§11.5): **the wording now
 * comes from the server** — `paymentMethodDisplay`/`paymentMethodUpiId` on
 * §4.3, gated server-side on the account's real `is_premium`, which replaces
 * this screen's previous client-side branch on `useCurrentUserProfile()
 * .isPremium` plus the mock UPI id. A client-held premium flag decides what to
 * offer, never what an entitled response contains
 * (docs/architecture/security-architecture.md §2). Rendered unconditionally —
 * NOT gated on useSettingsStore().paymentModeEnabled, which only controls the
 * Dashboard row's compact chip — since every transaction always carries a
 * real, non-null paymentMode value.
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
 * ACTIVITY card (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md
 * §6.6): `ChangeLogCard`, reading `GET /change-log?entityType=transaction&
 * entityId={id}` — field-level diffs, offline/synced times, "on another
 * device", superseded edits — plus this transaction's queued changes when
 * offline. It replaced the local-only `useActivityLogStore` history as this
 * card's source (ADR 0008 §1's last local remnant; the store itself is deleted
 * in ADR 0027's Phase C). Fully omitted when there is nothing to show, the same
 * convention as NOTES/RECEIPT ATTACHMENT. Positioned after RECEIPT ATTACHMENT,
 * before the Edit button. Tapping an entry opens Change Detail.
 *
 * Receipt Attachment card is read-only display here — per ADR 0007 §5/§11.3,
 * this card has no tap-to-pick/replace interaction of its own; that happens
 * only through Edit -> AddExpenseScreen's RECEIPT ATTACHMENT field (§6.8).
 * **It renders from `receiptSignedUrl` (§4.3), the only way to read a receipt
 * at all** — `receiptPublicId` is a Cloudinary reference, not a URL, and
 * cannot be handed to an `Image`. When a receipt is attached but no signed URL
 * is available (offline, or a failed detail read) the card says the receipt
 * exists and could not be loaded, rather than disappearing: its absence is
 * **not** "no receipt" (docs/decisions/0020-receipt-upload-cloudinary-signed-direct.md
 * §10.5).
 *
 * Neither Edit nor Delete cascades into useSplitExpensesStore's participant
 * amounts or yourBalance — explicitly out of scope per ADR 0007.
 */
function TransactionDetailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme, insets);

  const splitExpenses = useSplitExpensesStore(state => state.splitExpenses);
  // Read for one comparison only — "did I pay (part of) the split this came
  // from" is now "am I in `payers[]`" (§9.3, ADR 0025 §8.7). Triggers no
  // request: it reads the session
  // and the already-loaded profile (see the hook).
  const identity = useUserIdentity();
  const [isDeleteDialogVisible, setIsDeleteDialogVisible] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // The held row plus §4.3's detail-only enrichment. The hook owns the fetch,
  // its failure handling, and the rule that a signed receipt URL is never
  // cached beyond this screen's lifetime (ADR 0020 §7).
  const {
    transaction,
    detail,
    detailError,
    hasUnreadableReceipt,
    isDeleting,
    deleteTransaction,
  } = useTransactionDetail(route.params?.transactionId);

  // A stale id, a deep link, a transaction deleted on another device, or one
  // the server soft-deleted out from under us: §4.3 answers `404
  // TRANSACTION_NOT_FOUND` and the store drops the row, so this is the state
  // that catches all of them rather than crashing on an undefined row's
  // fields (constitution §22). It offers the only action that makes sense.
  if (!transaction) {
    return (
      <View style={styles.flex}>
        <ScreenHeader
          title="Transaction Details"
          onBack={() => navigation.goBack()}
        />
        <View style={styles.notFoundContainer}>
          <Text style={styles.notFoundText}>
            This transaction couldn&apos;t be found. It may have already been
            deleted.
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

  // "PAID" tag — ADR 0007 §4's condition, in the API's field names now that
  // split expenses are server-backed, and generalised by ADR 0025 §8.7: shown
  // when the caller is any of the split's `payers[]` (api-overview.md §9.3),
  // not only the deprecated primary `paidByUserId`. If the Project Owner wants
  // PAID only for someone who paid the whole bill, compare the amount here.
  //
  // **Structurally unreachable today, and that is the contract rather than a
  // bug on this screen.** `POST /transactions` accepts no `splitExpenseId`
  // (§4.2 — only a split expense may set it) and Split Add Expense writes its
  // own personal transaction, so a split-originated row carries no link back
  // and this lookup finds nothing. Two further caveats, recorded so the next
  // reader does not mistake them for defects: `useSplitExpensesStore` holds one
  // **target's** history at a time (§9.3 has no "all my split expenses" read),
  // so even with a link this would only match while the right group or pair was
  // the one last viewed. Both halves close together when the personal
  // transaction moves server-side (`backend/README.md` §15.8/§16.8).
  const splitExpense = transaction.splitExpenseId
    ? splitExpenses.find(split => split.id === transaction.splitExpenseId)
    : null;
  const showPaidTag =
    splitExpense != null && findCallerPaid(splitExpense, identity.userId) > 0;

  const { currencySymbol } = dashboardSummary;
  const isIncome = transaction.type === 'income';
  const amountColor = isIncome
    ? theme.color.status.positive
    : theme.color.status.negative;
  const amountSign = isIncome ? '+' : '-';

  function handleEdit() {
    navigation.navigate('AddExpense', { editingTransactionId: transaction.id });
  }

  function handleDelete() {
    setDeleteError(null);
    setIsDeleteDialogVisible(true);
  }

  /**
   * `DELETE /transactions/{id}` (§4.5). **Navigates back only when the server
   * has confirmed it** — the mock version removed the row and left
   * synchronously, which against a real API would have shown the user a
   * transaction "deleted" that still existed on the next read. A failure keeps
   * them here with the reason and the row intact, which is the only state from
   * which they can retry.
   *
   * A `404` counts as success in the store: a row the server says is gone
   * should not stay on screen because the request to remove it arrived second.
   */
  async function handleConfirmDelete() {
    setIsDeleteDialogVisible(false);
    const result = await deleteTransaction();
    if (result.success) {
      navigation.goBack();
      return;
    }
    setDeleteError(result.error);
  }

  function handleCancelDelete() {
    setIsDeleteDialogVisible(false);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Transaction Details"
        onBack={() => navigation.goBack()}
        rightSlot={
          <HeaderDeleteButton
            onPress={handleDelete}
            accessibilityLabel="Delete transaction"
          />
        }
      />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <IconBadge
            glyph={transaction.categoryGlyph}
            tone={transaction.categoryTone}
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
              {/* The full path when the transaction is tagged to a
                  subcategory — `FOOD > SNACKS` — composed from the server's
                  own two snapshot fields and **never gated on the
                  subcategories setting**
                  (docs/decisions/0019-subcategories-one-optional-level.md
                  §6.2). A history row that read differently depending on a
                  mutable preference would be unstable history: the same
                  transaction would look different on two devices. For income
                  this is simply `INCOME`, the server's own constant — no
                  branch needed. */}
              <Text style={styles.tagText}>
                {formatCategoryPath(
                  transaction.parentCategoryName,
                  transaction.categoryName,
                ).toUpperCase()}
              </Text>
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
          <Text style={styles.cardValuePrimary}>
            {getExactDateLabel(transaction.txnDate)}
          </Text>
          {/* `txnTime` is frozen at creation and is not updatable (§4.4) —
              there is no time field on the edit form, and the server ignores
              the key. */}
          <Text style={styles.cardValueSecondary}>
            {getTimeLabel(transaction.txnTime)}
          </Text>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardLabel}>PAYMENT METHOD</Text>
          <PaymentMethodContent
            styles={styles}
            transaction={transaction}
            detail={detail}
            currencySymbol={currencySymbol}
          />
          {/* The detail read is what carries the premium wording, so when it
              fails this card is genuinely showing less than it should and says
              so. The free-tier wording below it is still correct, not a
              placeholder, which is why this is a note rather than an error
              state replacing the card. */}
          <InlineMessage message={detailError} style={styles.cardMessage} />
        </Card>

        {transaction.notes ? (
          <Card style={styles.card}>
            <Text style={styles.cardLabel}>NOTES</Text>
            <Text style={styles.notesText}>{transaction.notes}</Text>
          </Card>
        ) : null}

        {transaction.receiptPublicId ? (
          <Card style={styles.card}>
            <Text style={styles.cardLabel}>RECEIPT ATTACHMENT</Text>
            {detail?.receiptSignedUrl ? (
              <Image
                source={{ uri: detail.receiptSignedUrl }}
                style={styles.receiptImage}
                resizeMode="cover"
              />
            ) : null}
            {hasUnreadableReceipt ? (
              <Text style={styles.cardValueSecondary}>
                A receipt is attached to this transaction but couldn&apos;t be
                loaded right now.
              </Text>
            ) : null}
          </Card>
        ) : null}

        {/* ACTIVITY — the server change log for this transaction, plus its
            queued changes offline (ADR 0027 §6.6). Replaces the local-only
            useActivityLogStore history as this card's source. */}
        <ChangeLogCard
          transactionId={transaction.id}
          currencySymbol={currencySymbol}
          onOpenEntry={changeLogId =>
            navigation.navigate('ChangeDetail', { changeLogId })
          }
          style={styles.card}
        />

        {/* A failed delete reports itself here, next to the content it failed
            to remove, with the row still intact and still deletable. */}
        <InlineMessage message={deleteError} />

        <PrimaryButton
          label="Edit"
          onPress={handleEdit}
          // Editing a row whose delete is in flight would open a form on a
          // record that may not exist by the time it is saved.
          disabled={isDeleting}
          style={styles.editButton}
        />
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
 * The free-tier wording, which is also the fallback while §4.3's response has
 * not arrived. Title Case — the same words the Dashboard's ALL-CAPS badge
 * uses, just not chip-styled, since this is a labeled value block rather than
 * a compact list-row tag (ADR 0007 §3.4's table).
 */
const PAYMENT_MODE_LABELS = { cash: 'Cash', online: 'Online', both: 'Both' };

/**
 * Payment Method card content — ADR 0007 §3.4/§11.5's exact free/premium
 * table, **now driven by the server's own `paymentMethodDisplay` /
 * `paymentMethodUpiId`** (api-overview.md §4.3) instead of a client-side
 * branch on a premium flag. A small presentational subcomponent (not inline
 * JSX in the parent) purely to keep the branching readable; it holds no
 * state/lifecycle of its own and reads everything from props.
 *
 * `paymentMethodUpiId` is present only for a premium account on an `online` or
 * `both` transaction, so its presence — not a local entitlement check — is
 * what selects the enriched layout. The honest consequence, worth stating: a
 * premium user whose detail read failed (offline) sees the free-tier wording
 * for that render, because the enrichment lives in the response that did not
 * arrive. Under-claiming an entitlement is the safe direction to fail; the
 * amounts themselves, which come from the list row, are unaffected.
 *
 * `cashAmount`/`onlineAmount` are non-null **iff** `paymentMode` is `'both'`
 * (§4.1), so the two-row layout can read them directly; the `?? 0` is a
 * defensive guard only (constitution §22).
 */
function PaymentMethodContent({ styles, transaction, detail, currencySymbol }) {
  const { paymentMode, cashAmount, onlineAmount } = transaction;
  const display =
    detail?.paymentMethodDisplay ?? PAYMENT_MODE_LABELS[paymentMode] ?? 'Cash';
  const upiId = detail?.paymentMethodUpiId ?? null;

  // Premium + 'both': the two rows ADR 0007 §3.4 describes as "implied by the
  // existing cashAmount/onlineAmount fields plus paymentMethodUpiId for the
  // online portion".
  if (paymentMode === 'both' && upiId) {
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
        <Text style={styles.cardValueCaption}>UPI ID: {upiId}</Text>
      </>
    );
  }

  return (
    <>
      <Text style={styles.cardValuePrimary}>{display}</Text>
      {upiId ? (
        <Text style={styles.cardValueCaption}>UPI ID: {upiId}</Text>
      ) : null}
    </>
  );
}

function createStyles(theme, insets) {
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
      paddingBottom: getTabBarTopEdge(theme, insets) + theme.space.lg,
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
    // An InlineMessage sitting inside a Card: its own bottom margin is meant
    // for a form field below it, so it is traded for a top gap here.
    cardMessage: {
      marginTop: theme.space.sm,
      marginBottom: 0,
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
