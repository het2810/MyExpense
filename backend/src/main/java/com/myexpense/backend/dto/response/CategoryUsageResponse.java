package com.myexpense.backend.dto.response;

import java.util.UUID;

/**
 * {@code CategoryUsageResponse} (api-overview.md §3.5) — the body of
 * {@code GET /api/v1/categories/{id}/usage}, the delete pre-flight.
 *
 * <p><strong>Why this endpoint exists at all</strong> (ADR 0021 §2.2): the app
 * must warn <em>before</em> the user confirms a delete, so the client needs the
 * affected count up front. Three cheaper-looking sources were rejected, and the
 * one that matters here is the second — <strong>a client must never derive a
 * total from a paginated list.</strong> {@code GET /transactions} is paginated
 * and the client holds one filtered page, so a count derived from it is wrong
 * by construction and wrong in the dangerous direction: a category with 300
 * transactions, none of them on the current page, would delete with no warning
 * at all. Adding a {@code transactionCount} to {@code GET /categories} was
 * rejected too (it would put an aggregate over {@code transactions} on the
 * app's most-read structural endpoint), and {@code DELETE}'s own counts
 * ({@link CategoryDeletionResponse}) arrive after the irreversible act.
 *
 * <p><strong>Advisory, never authoritative.</strong> It may be stale by the
 * time the {@code DELETE} runs (another device). If this call fails — offline
 * or otherwise — the client must fall back to the unconditional warning wording
 * and <strong>must not suppress the warning</strong>: failing closed is the only
 * safe direction for a destructive act (constitution §22).
 *
 * <p>Side-effect-free, owner-scoped, and <strong>legal for the protected row</strong>
 * — asking about {@code Misc} is a legal question with a legal answer, so there
 * is no {@code CATEGORY_PROTECTED} here; only deleting it is refused (§3.5).
 *
 * @param categoryId the id that was asked about, echoed so a client holding
 *        several in-flight pre-flights cannot mismatch a response to a dialog.
 * @param transactionCount how many of the caller's <strong>live</strong>
 *        transactions a delete would reassign — computed over exactly the id
 *        set §3.4 step 2 reassigns ({@code id} plus its subcategory ids when
 *        {@code id} is top-level), which is the same roll-up
 *        {@code GET /transactions?categoryId=} matches, so the user cannot be
 *        warned about one number and have another happen. <strong>The contract's
 *        job is to make {@code transactionCount > 0} correct</strong> — the
 *        Project Owner's copy says "some transactions" and names no number, so
 *        the dialog needs a boolean and this is how it is obtained.
 *        Soft-deleted transactions are excluded (they are excluded from every
 *        other read, and the user cannot see them), and income rows cannot
 *        match because their {@code category_id} is {@code NULL}.
 * @param subcategoryCount how many subcategories the cascade would delete —
 *        what lets the dialog say that subcategories go too. Always {@code 0}
 *        for a subcategory.
 */
public record CategoryUsageResponse(
        UUID categoryId,
        long transactionCount,
        long subcategoryCount) {
}
