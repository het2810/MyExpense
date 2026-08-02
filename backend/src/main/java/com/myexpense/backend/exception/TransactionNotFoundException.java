package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 404 on {@code GET}, {@code PATCH} and {@code DELETE /api/v1/transactions/{id}}
 * (api-overview.md §4.3/§4.4/§4.5).
 *
 * <p><strong>Returned identically in four cases</strong>, which is the point —
 * the response must not let a caller distinguish them
 * (security-architecture.md §2's owner-scoped convention):
 *
 * <ol>
 *   <li>the id does not exist at all;</li>
 *   <li>the id exists but belongs to a different user — never a {@code 403},
 *       which would confirm the id is real;</li>
 *   <li>the row has been soft-deleted ({@code deleted_at} set) — a deleted
 *       transaction must not appear in a single read (api-overview.md §4), so
 *       to a client it is simply gone;</li>
 *   <li>a repeat {@code DELETE} of an already-deleted transaction, which is
 *       case 3 by another route.</li>
 * </ol>
 *
 * <p>Case 4 means {@code DELETE} is <strong>not</strong> idempotent-{@code 204}:
 * the second call is a {@code 404}. That follows from the contract rather than
 * being a separate choice — §4.5 lists {@code 404 TRANSACTION_NOT_FOUND} as its
 * only error, and §4 says deleted rows are excluded from reads, so there is no
 * row left for a second delete to address. {@code POST /auth/logout}'s
 * idempotent {@code 204} is a different case: nothing there is addressed by id.
 */
public class TransactionNotFoundException extends ApiException {

    public TransactionNotFoundException() {
        super(HttpStatus.NOT_FOUND, "TRANSACTION_NOT_FOUND", "Transaction not found.");
    }
}
