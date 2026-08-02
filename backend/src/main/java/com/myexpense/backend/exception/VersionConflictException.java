package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 409 on {@code PATCH /api/v1/transactions/{id}} when the submitted
 * {@code version} does not match the stored row (api-overview.md §4.4,
 * security-architecture.md §9's optimistic-concurrency note).
 *
 * <p><strong>Retryable, and that is why it is a separate code from
 * {@link ReceiptAlreadyAttachedException}</strong> — the two {@code 409}s on
 * this one endpoint need opposite client behaviour. This one means <em>re-fetch
 * the transaction and apply the edit again</em>; a duplicate receipt claim must
 * never be retried, because retrying re-sends the same reference. Collapsing
 * them into one code would make the correct client reaction unknowable
 * (api-overview.md §4.2 rule 4 says so explicitly, and the Database Architect
 * restated it on 2026-10-24).
 *
 * <p>The message deliberately does not state the current version. A client that
 * needs it re-fetches the row, which is the action it has to take anyway, and
 * echoing it back would make the error body a second, divergent source of truth
 * for the row's state.
 */
public class VersionConflictException extends ApiException {

    public VersionConflictException() {
        super(
                HttpStatus.CONFLICT,
                "VERSION_CONFLICT",
                "This transaction was changed elsewhere. Reload it and try again.");
    }
}
