package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * {@code SplitExpenseResponse} (api-overview.md §9.3) — returned by
 * {@code POST /api/v1/split-expenses} ({@code 201}),
 * {@code GET /api/v1/split-expenses/{id}} ({@code 200}) and
 * {@code GET /api/v1/split-expenses} (as an array element), the same shape in all
 * three.
 *
 * <p>Never the {@code SplitExpense} entity (constitution §9).
 *
 * <h2>The five category fields are a SNAPSHOT, and {@link #categoryId} is always
 * populated</h2>
 *
 * <p>{@link #categoryName} is always the <strong>leaf's own name</strong>, never a
 * composed path — a separator is a presentation choice, and freezing one into
 * financial history would make every past row wrong the moment the UI changed it.
 * The client composes {@code Food › Snacks} from {@link #categoryName} +
 * {@link #parentCategoryName} at render time (ADR 0019 §5).
 *
 * <p><strong>{@link #categoryId} is non-null on every row this endpoint
 * creates</strong>, including when the request omitted {@code categoryId}: ADR
 * 0023 §3 resolves the caller's protected {@code Misc} row and sets it, rather
 * than leaving a row that renders as {@code Misc} but matches no {@code Misc}
 * filter. §9.3's shape keeps it nullable because
 * {@code fk_split_expenses_category_id} is {@code ON DELETE SET NULL} — a null
 * here never means "none was chosen". That action is dormant since ADR 0024:
 * deleting a category now <strong>reassigns</strong> its creator's split
 * expenses to the creator's {@code Misc} (§4.8), so this row then reads
 * {@code Misc} for every member. ADR 0023 confirms §9.3 needs no shape change
 * for this, and the internal {@code reassigned_from_category_id} marker is
 * deliberately not part of this response.
 *
 * <p>{@link #categoryTone} is derived from the record kind and from nothing else
 * — a split expense is always an expense, so it is always
 * {@code CategorySnapshot#EXPENSE_TONE}. It cannot come from the category,
 * because {@code CategoryResponse} carries no tone field, deliberately
 * (ADR 0018 §4).
 *
 * <h2>{@link #addedToPersonalExpenses} reports what HAPPENED, not what was asked</h2>
 *
 * <p>It is read back off the stored column, which {@code SplitExpenseService}
 * writes as "a consumption-share transaction was actually created". The one case
 * where it differs from the request is a caller whose own share is zero (or who is
 * not a participant at all): the shipped frontend skips the transaction in exactly
 * that case, and storing {@code false} is what keeps §4.6's
 * "{@code personal_transaction_id} set iff the flag is true" true in both
 * directions — the half no CHECK can hold ({@code V11} FLAG 5(b)). Flagged in
 * backend/README.md §16.6.
 *
 * <h2>No {@code currencyCode}</h2>
 *
 * <p>Removed on 2026-10-02 — it was a snapshot of {@code split_expenses.currency_code},
 * which no longer exists (§4.6 says "Do not create this column"). Currency appears
 * once in this API, on §2.1's {@code defaultCurrencyCode}.
 *
 * <p>{@link #paidByName} is resolved server-side, the same convention as
 * §7.1's {@code members[].name}. It is <strong>not</strong> snapshotted on the
 * row — only participants' names are — so a payer's rename shows up here; the
 * asymmetry is §4.6/§4.7's, not this type's.
 *
 * <h2>{@link #payers} — added 2026-11-06 (ADR 0025 §5.2)</h2>
 *
 * <p>Always populated, never empty: a split saved with one payer, including every
 * row from before ADR 0025, returns one entry. Order: the primary payer first,
 * then by amount descending, ties by row id (PostgreSQL's unsigned uuid order), so
 * {@code payers[0]} always matches the {@code paidBy*} fields.
 *
 * <p><strong>{@link #paidByUserId}, {@link #paidByContactId} and
 * {@link #paidByName} are DEPRECATED.</strong> They are still populated, with the
 * primary payer (largest amount, tie: first in request order). For a multi-payer
 * split they describe one payer only, so clients must read {@link #payers} to know
 * who paid and how much. Removing them needs its own ADR.
 *
 * <h2>{@link #counterparts} — added 2026-11-11 (ADR 0026 §5.2)</h2>
 *
 * <p>One entry per pair row an individual split moved, never empty; {@code []}
 * for a group split. Order: the primary counterpart first (so
 * {@code counterparts[0].individualBalanceId} equals {@link #individualBalanceId}),
 * then by {@code individualBalanceId} ascending (PostgreSQL's unsigned uuid
 * order). A one-contact split keeps every other field's value and gains a
 * one-element array.
 *
 * <p><strong>{@link #individualBalanceId} is DEPRECATED</strong> (2026-11-11). It
 * is still populated, with the primary (first) counterpart's pair. For a
 * multi-contact split it names one pair only, so clients must read
 * {@link #counterparts}.
 */
public record SplitExpenseResponse(
        UUID id,
        String title,
        UUID categoryId,
        String categoryName,
        String parentCategoryName,
        String categoryIconName,
        String categoryGlyph,
        String categoryTone,
        LocalDate splitDate,
        BigDecimal amount,
        String splitMode,
        UUID groupId,
        UUID individualBalanceId,
        List<SplitCounterpartSummary> counterparts,
        String splitMethod,
        UUID paidByUserId,
        UUID paidByContactId,
        String paidByName,
        List<SplitPayerSummary> payers,
        boolean addedToPersonalExpenses,
        UUID personalTransactionId,
        List<SplitParticipantSummary> participants,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        /*
         * ADR 0028 §6.4 (2026-11-12, additive). createdByName and deletedByName
         * are resolved live, like payers[].name. deletedAt is non-null only in a
         * feed item and in the idempotent replay of an edit whose split was
         * deleted since; GET /split-expenses/{id} and the list never return a
         * deleted split. participants/payers are always the CURRENT revision's.
         */
        UUID createdByUserId,
        String createdByName,
        OffsetDateTime deletedAt,
        UUID deletedByUserId,
        String deletedByName) {
}
