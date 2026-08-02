package com.myexpense.backend.dto.response;

/**
 * {@code CategoryDeletionResponse} (api-overview.md §3.4) — the body of
 * {@code DELETE /api/v1/categories/{id}}'s {@code 200 OK}.
 *
 * <p><strong>{@code 200} with a body rather than {@code 204}, deliberately</strong>
 * (ADR 0021 §2.3). This is the one delete in the API that departs from
 * {@code DELETE /transactions/{id}}'s {@code 204} (§4.5), and the reason is on
 * the record rather than left as a preference: <strong>this delete mutates rows
 * the caller did not name.</strong> A {@code 204} would leave the client with
 * nothing but its own possibly-stale pre-flight number
 * ({@link CategoryUsageResponse}) to describe what happened, and no way to know
 * whether its cached transaction pages are now wrong. Both counts are free —
 * the service already holds them — and together they let a client invalidate
 * exactly what changed.
 *
 * <p><strong>Additive and ignorable:</strong> a client that reads the status
 * code and nothing else is correct. Both numbers are <em>after-the-fact
 * facts</em>, <strong>not a confirmation protocol</strong> — there is no
 * two-phase delete, no confirmation token, and §3.5's pre-flight count is never
 * sent back to the server.
 *
 * <p>No echoed {@code CategoryResponse} and no {@code miscCategoryId}: the
 * client already holds the whole tree from §3.1, including which row is
 * protected.
 *
 * @param reassignedTransactionCount how many {@code transactions} rows were
 *        moved to the caller's protected {@code Misc} category — the
 *        reassigning {@code UPDATE}'s own affected-row count, so it includes
 *        rows tagged to cascaded subcategories. {@code 0} is a perfectly
 *        normal answer. <strong>It may exceed §3.5's {@code transactionCount}
 *        by design:</strong> that pre-flight excludes soft-deleted
 *        transactions (it describes what the user will see change) while the
 *        reassignment deliberately does not (a soft-deleted row is still the
 *        user's data, still reaches clients through {@code /sync/pull}, and
 *        would otherwise be left pointing at a deleted category).
 *        <strong>Transactions only</strong>: split expenses the delete
 *        reassigns (ADR 0024 §4.8) are not counted here and no field was added
 *        for them, so a client refreshes its split data after any successful
 *        delete.
 * @param deletedSubcategoryCount how many subcategory rows the cascade
 *        <strong>soft-deleted</strong> (ADR 0024 §4.3 — the name is kept
 *        because renaming a response field would be a breaking change for no
 *        gain). Always {@code 0} when the deleted row was itself a subcategory
 *        — a subcategory can have no children (ADR 0019 §2), which is
 *        structural rather than a filter.
 */
public record CategoryDeletionResponse(
        int reassignedTransactionCount,
        int deletedSubcategoryCount) {
}
