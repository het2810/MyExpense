package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * {@code TransactionResponse} (api-overview.md §4.1) — returned by all four
 * read/write transaction endpoints: the paginated list, the create (201), the
 * single read (200) and the update (200).
 *
 * <p>Never the {@code Transaction} entity: {@code userId} must not cross the
 * API boundary (every row in a response already belongs to the caller by
 * construction, so echoing an owner id would only invite a client to start
 * sending one back), and serializing a managed entity would couple the wire
 * shape to the schema (constitution §9).
 *
 * <h2>The five category snapshot fields</h2>
 *
 * <p>{@code categoryName}, {@code categoryIconName}, {@code categoryGlyph} and
 * {@code categoryTone} are <strong>never {@code null} for any transaction,
 * income or expense</strong> (api-overview.md §4.1). A client renders every row
 * from them directly and must never perform a category lookup to display a
 * transaction. {@code parentCategoryName} is the one nullable member of the
 * set — {@code null} for a top-level category and for every income row — and a
 * renderer that ignores it entirely still produces a complete, correct row.
 *
 * <p>{@code categoryId} holds <strong>the leaf</strong>: the most specific
 * category the user chose, which may be a subcategory. There is deliberately no
 * second category field — two fields that can disagree would be a second
 * representation of one fact (constitution §17, ADR 0019 §5).
 *
 * <h2>{@code groupId} and {@code splitExpenseId} — both now really populated,
 * by different writers</h2>
 *
 * <p>Both columns exist in {@code V7__transactions.sql} and are mapped by
 * {@code Transaction}, so both have always been genuine reads rather than
 * hardcoded nulls. What changed is that each now has a writer:
 *
 * <ul>
 *   <li><strong>{@code groupId}</strong> is written by
 *       {@code POST}/{@code PATCH /transactions} <em>as of 2026-11-03</em>, once
 *       the caller's membership of that group is verified against
 *       {@code group_members} (api-overview.md §4.2's
 *       {@code 403 NOT_GROUP_MEMBER}). Before that date the membership check was
 *       vacuously false, so no group-scoped row could be written at all and this
 *       field was {@code null} on every row;</li>
 *   <li><strong>{@code splitExpenseId}</strong> is written by
 *       {@code POST /split-expenses} alone, on the consumption-share row it
 *       creates. §4.2 permits only a split expense to set it, so no request DTO
 *       in Domain 4 carries the field and neither write path there touches
 *       it.</li>
 * </ul>
 *
 * <p>Both are carried as present-and-{@code null} when unset rather than
 * omitted, which is the uniform key-set convention this API has used since
 * ADR 0003 §2: a client maps the shape once and reads values, not keys.
 *
 * <h2>{@code receiptPublicId} is NOT a URL</h2>
 *
 * <p>It is a Cloudinary {@code public_id} (ADR 0020 §2/§3) and cannot be
 * navigated to, rendered, or handed to an {@code Image} component. A list row
 * can tell <em>that</em> a receipt exists from this field being non-null
 * without being handed the means to read it.
 *
 * <p><strong>{@code receiptSignedUrl} is deliberately absent from this type</strong>
 * — the signing/delivery half of ADR 0020 is not implemented yet (no Cloudinary
 * configuration exists), and when it lands it belongs only on
 * {@code GET /transactions/{id}} (api-overview.md §4.3), never on the list.
 *
 * <h2>No {@code currencyCode}</h2>
 *
 * <p>Removed from this contract on 2026-10-02
 * (docs/decisions/0017-per-currency-balances-and-partial-settlement.md's Scope
 * Narrowing banner). Currency is a display symbol only and lives in exactly one
 * place in this API: {@code defaultCurrencyCode} on §2.1's
 * {@code UserProfileResponse}. Do not add one here.
 *
 * <h2>The two single-resource enrichment fields</h2>
 *
 * <p>{@code paymentMethodDisplay} and {@code paymentMethodUpiId} are additive
 * to the base shape and populated <strong>only</strong> by
 * {@code GET /transactions/{id}} (api-overview.md §4.3). Both carry
 * field-level {@code @JsonInclude(NON_NULL)} so they are <em>omitted</em>
 * everywhere else, which is exactly what "present only on this single-resource
 * endpoint" means — and why the omission is scoped to these two components
 * instead of being a class-level setting that would also swallow the
 * legitimately-null {@code categoryId}, {@code notes} and
 * {@code receiptPublicId}.
 */
public record TransactionResponse(
        UUID id,
        UUID clientId,
        String title,
        UUID categoryId,
        String categoryName,
        String parentCategoryName,
        String categoryIconName,
        String categoryGlyph,
        String categoryTone,
        LocalDate txnDate,

        /*
         * "HH:mm" (api-overview.md §4.1), formatted explicitly in the service
         * rather than left to a Jackson date format. LocalTime's own
         * serialization would emit "HH:mm:ss" whenever seconds are non-zero,
         * and the contract's format is fixed — a String here makes the wire
         * shape unconditional and independent of any Jackson configuration.
         */
        String txnTime,

        BigDecimal amount,
        String type,
        String scope,

        /*
         * Read from the column, but null on every row this phase: Domain 4
         * never writes it and scope='group' is answered 403 NOT_GROUP_MEMBER.
         * See the class Javadoc and Transaction#groupId.
         */
        UUID groupId,

        String paymentMode,
        BigDecimal cashAmount,
        BigDecimal onlineAmount,

        /*
         * Read from the column, but null on every row this phase: only a split
         * expense can set it, and §9 is unbuilt.
         */
        UUID splitExpenseId,

        String notes,
        String receiptPublicId,
        int version,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,

        /*
         * GET /transactions/{id} only (api-overview.md §4.3) — "Cash" /
         * "Online" / "Both" for a free account, with the online line upgraded
         * to "Unified Payments Interface" for a premium one. Gated
         * server-side on users.is_premium: a client-side premium flag is never
         * trusted to decide what to render (security-architecture.md §2).
         */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        String paymentMethodDisplay,

        /*
         * GET /transactions/{id} only, premium only — and ALWAYS null today.
         *
         * The contract sources it from "{profile's mock/real UPI id}"
         * (api-overview.md §4.3, ADR 0007 §3.3), which today exists solely as
         * the frontend mock profileMocks.js#profileUser.mockUpiId. There is no
         * users.upi_id column in data-model.md §1.1 and inventing one is
         * exactly what constitution §15/§30 forbids, so the key is declared to
         * fix the response shape while the value awaits a schema column (or a
         * decision to drop the field). Flagged in backend/README.md §13.
         */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        String paymentMethodUpiId) {
}
