import { useCallback, useEffect, useState } from 'react';
import { useTransactionsStore } from '../store/useTransactionsStore';
import { useTransactionsView } from './useTransactionsView';

/**
 * One transaction, for Transaction Detail — the held list row plus the two
 * enrichments that exist **only** on `GET /api/v1/transactions/{id}`
 * (docs/api/api-overview.md §4.3) and are deliberately absent from §4.1's list
 * rows:
 *
 * - **`paymentMethodDisplay` / `paymentMethodUpiId`** — the premium
 *   payment-method wording, gated server-side on the account's real
 *   `is_premium`. Rendering the server's answer rather than deriving it from a
 *   client-held premium flag is the point (security-architecture.md §2): a
 *   client flag decides what to *offer*, never what an entitled response
 *   contains.
 * - **`receiptSignedUrl`** — a short-lived signed Cloudinary delivery URL,
 *   the only way to read a receipt at all.
 *
 * **Neither is written into the store, and that is a hard rule for the second
 * one** (docs/decisions/0020-receipt-upload-cloudinary-signed-direct.md
 * §5.2/§7): for its lifetime a signed URL is a bearer credential for financial
 * PII, so it must not be cached, persisted, logged or put in an activity row.
 * It lives in this hook's state for as long as the screen is mounted and
 * nowhere else.
 *
 * Why a hook rather than the screen doing it: the fetch, its failure handling
 * and the "this id is gone" case are business logic, and Transaction Detail is
 * a presentation surface (constitution §8). It also keeps the one genuinely
 * subtle rule in one place — see `hasUnreadableReceipt`.
 *
 * @param {string | null | undefined} transactionId
 * @returns {{
 *   transaction: object | null,
 *   detail: object | null,
 *   isLoadingDetail: boolean,
 *   detailError: string | null,
 *   hasUnreadableReceipt: boolean,
 *   isDeleting: boolean,
 *   deleteTransaction: () => Promise<{ success: boolean, error: string | null }>,
 * }}
 */
export function useTransactionDetail(transactionId) {
  // Snapshot + queued writes (ADR 0027 §8.8), so a transaction still waiting
  // to sync opens too.
  const transactions = useTransactionsView();
  const isDeleting = useTransactionsStore((state) => state.isDeleting);
  const refreshTransaction = useTransactionsStore((state) => state.refreshTransaction);
  const deleteFromStore = useTransactionsStore((state) => state.deleteTransaction);

  // Reactive lookup, not a one-time snapshot (ADR 0007 §8): the screen must
  // reflect an edit on return from Add Expense, and must stop rendering a row
  // the store has dropped.
  const transaction = transactions.find((held) => held.id === transactionId) ?? null;
  const version = transaction?.version ?? null;

  const [detail, setDetail] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // A queued create the server has not seen yet (ADR 0027 §8.8): there is no
  // detail to read, and a `GET` would only `404`.
  const isLocalOnly = Boolean(transaction?.localSyncStatus) && version === 0;

  useEffect(() => {
    if (!transactionId || isLocalOnly) {
      return undefined;
    }

    // `version` is in the dependency list so that an edit — which bumps it
    // (§4.4) — re-reads the enrichment rather than leaving a signed URL for a
    // receipt that was just cleared, or premium wording for a payment mode
    // that just changed. A `GET` never bumps it, so this cannot loop.
    let isCurrent = true;
    setIsLoadingDetail(true);
    setDetailError(null);

    refreshTransaction(transactionId).then((result) => {
      if (!isCurrent) {
        return;
      }
      setIsLoadingDetail(false);
      if (result.success) {
        setDetail(result.transaction);
        return;
      }
      // A `404` has already dropped the row from the store, so the screen is
      // about to render its own "couldn't be found" state — a second message
      // under it would be noise. Any other failure (offline, timeout, 5xx)
      // leaves the list row on screen and reports itself, because the detail
      // card really is missing something (constitution §22).
      setDetail(null);
      setDetailError(result.notFound ? null : result.error);
    });

    return () => {
      isCurrent = false;
    };
  }, [transactionId, version, refreshTransaction, isLocalOnly]);

  const deleteTransaction = useCallback(
    () => deleteFromStore(transactionId),
    [deleteFromStore, transactionId],
  );

  return {
    transaction,
    detail,
    isLoadingDetail,
    detailError,
    /**
     * **A receipt exists but cannot be shown right now — not "there is no
     * receipt"** (ADR 0020 §10.5). The row says a receipt is attached
     * (`receiptPublicId` is non-null) while the signed URL that would render it
     * is absent, which is what offline, a failed detail read, or a read still
     * in flight all look like. Telling the user "no receipt" in that state
     * would be a lie about their own record.
     */
    hasUnreadableReceipt: Boolean(transaction?.receiptPublicId) && !detail?.receiptSignedUrl,
    isDeleting,
    deleteTransaction,
  };
}
