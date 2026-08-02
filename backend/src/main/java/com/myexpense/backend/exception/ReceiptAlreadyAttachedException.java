package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 409 on {@code POST} and {@code PATCH /api/v1/transactions} when the submitted
 * {@code receiptPublicId} is already attached to another transaction
 * (api-overview.md §4.2 rule 4 / §4.4,
 * docs/decisions/0020-receipt-upload-cloudinary-signed-direct.md §3).
 *
 * <p><strong>One asset, one transaction.</strong> Enforced structurally by the
 * partial unique index {@code uq_transactions_receipt_public_id}
 * ({@code WHERE receipt_public_id IS NOT NULL}), because without it removing or
 * replacing one transaction's receipt could later destroy or orphan an asset
 * another row still renders. <strong>A soft-deleted transaction keeps its
 * reference and therefore keeps its slot</strong> — correct, since the row still
 * points at that asset.
 *
 * <p><strong>NOT retryable, which is the whole reason it has its own code</strong>
 * rather than sharing {@code VERSION_CONFLICT}'s: retrying re-sends the same
 * reference and will fail identically forever. The correct client behaviour is
 * to obtain a fresh signature and upload again — the opposite of
 * {@link VersionConflictException}'s re-fetch-and-retry. The Database Architect
 * restated this on 2026-10-24 specifically as "do not collapse these two".
 */
public class ReceiptAlreadyAttachedException extends ApiException {

    public ReceiptAlreadyAttachedException() {
        super(
                HttpStatus.CONFLICT,
                "RECEIPT_ALREADY_ATTACHED",
                "That receipt is already attached to another transaction.");
    }
}
