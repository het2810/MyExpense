package com.myexpense.backend.dto.request;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code POST /api/v1/transactions} (api-overview.md §4.2).
 *
 * <p>A record, unlike {@link UpdateTransactionRequest}: on a create there is no
 * "field omitted vs. explicitly null" distinction to preserve — absent and
 * {@code null} mean the same thing for every optional field here, which is
 * exactly what a {@code null} component expresses. The same call
 * {@link CreateCategoryRequest} made.
 *
 * <h2>What this DTO deliberately does NOT accept</h2>
 *
 * <ul>
 *   <li><strong>The five category snapshot fields</strong> —
 *       {@code categoryName}, {@code parentCategoryName},
 *       {@code categoryIconName}, {@code categoryGlyph}, {@code categoryTone}.
 *       They are server-authoritative, filled from the resolved category row or
 *       from {@code IncomeCategorySnapshot}, and a client-supplied copy is never
 *       trusted (ADR 0018 §3.1 + ADR 0019 §5, security-architecture.md §3).
 *       Stated explicitly so none is "helpfully" added later to save a
 *       lookup.</li>
 *   <li><strong>{@code version}</strong> — a new row always starts at
 *       {@code 1}, server-assigned.</li>
 *   <li><strong>{@code splitExpenseId}</strong> — only a split expense can set
 *       it (api-overview.md §4.2), and {@code POST /split-expenses} (§9.1) does
 *       exactly that on the consumption-share row it creates. It stays off this
 *       DTO deliberately: a client that could name one would be asserting a
 *       provenance the server never observed.</li>
 *   <li><strong>{@code id}, {@code userId}, {@code createdAt},
 *       {@code updatedAt}, {@code deletedAt}</strong> — server-owned. The owner
 *       comes from the JWT and never from the payload
 *       (security-architecture.md §2). Sending any of these is ignored, because
 *       nothing reads them.</li>
 * </ul>
 *
 * <p>{@code receiptSignedUrl} is not a field here either, and never will be —
 * it is a read-time derivation on {@code GET /transactions/{id}} alone
 * (api-overview.md §4.3).
 */
public record CreateTransactionRequest(

        /*
         * DEPRECATED by ADR 0027 §3.5. Kept for compatibility: sent without
         * `id` it is treated as `id`; sent with a different `id` it is a 400.
         * The server stores client_id = id on every new row and nothing reads
         * the column.
         */
        UUID clientId,

        @NotBlank
        @Size(max = 255)
        String title,

        /*
         * Contract: "required iff type='expense'; omitted/null iff
         * type='income'". Both halves are cross-field rules that Bean
         * Validation cannot express here, so CategorySnapshotResolver owns
         * them:
         *   * a non-null value with type='income' is a 400 VALIDATION_ERROR,
         *     never a silently ignored field (ADR 0018 §3);
         *   * a null value with type='expense' is a 400;
         *   * a value that does not resolve to a category owned by the caller
         *     is 404 CATEGORY_NOT_FOUND, never a 403.
         *
         * MAY name a subcategory (ADR 0019 §5) — it names the LEAF the user
         * chose, and nothing about resolution needs to know whether that row
         * has children.
         */
        UUID categoryId,

        /*
         * ISO "YYYY-MM-DD". A LocalDate rather than a pattern-validated String
         * because Jackson rejects both a malformed shape and an impossible
         * date ("2026-02-31"), which a regex cannot do.
         */
        @NotNull
        LocalDate txnDate,

        /*
         * Contract: "HH:mm, required — client-supplied device wall-clock time
         * at creation".
         *
         * A validated String rather than a LocalTime on purpose: the contract's
         * format is NOT LocalTime's default serialization, so a String keeps
         * the accepted shape independent of Jackson configuration and turns a
         * malformed value into a clean 400 VALIDATION_ERROR naming this field —
         * where a Jackson parse failure would be a 400 with no fieldErrors at
         * all. The service parses it with LocalTime.parse once validation has
         * guaranteed it cannot throw.
         *
         * The pattern accepts 00:00-23:59 only; seconds are deliberately not
         * accepted, matching the contract exactly.
         */
        @NotBlank
        @Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "must be a time of day in HH:mm format")
        String txnTime,

        /*
         * Contract: "number, required, > 0".
         *
         * Digits matches numeric(12,2) exactly, so an amount with more than two
         * decimal places is a 400 naming the field rather than a silent
         * rounding or a database error — the sub-paise guard
         * security-architecture.md §3 asks for. It is also what makes the
         * cash+online sum comparison exact rather than approximate.
         */
        @NotNull
        @DecimalMin(value = "0", inclusive = false)
        @Digits(integer = 10, fraction = 2)
        BigDecimal amount,

        @NotBlank
        @Pattern(regexp = "expense|income", message = "must be 'expense' or 'income'")
        String type,

        @NotBlank
        @Pattern(regexp = "personal|group", message = "must be 'personal' or 'group'")
        String scope,

        /*
         * Contract: "required iff scope='group'". Both directions are enforced
         * by the service, and the database agrees
         * (chk_transactions_group_id_matches_scope: scope='group' iff
         * group_id IS NOT NULL).
         *
         * A group-scoped write is accepted only from a REGISTERED MEMBER of the
         * named group, re-derived per request from group_members; anyone else —
         * including a caller naming a group that does not exist — gets
         * 403 NOT_GROUP_MEMBER. See TransactionService#requireScopeAndGroupAgree
         * and Transaction#groupId.
         */
        UUID groupId,

        @NotBlank
        @Pattern(regexp = "cash|online|both", message = "must be 'cash', 'online' or 'both'")
        String paymentMode,

        /*
         * Contract: "required iff paymentMode='both'", and
         * "cashAmount + onlineAmount must equal amount exactly, re-validated
         * server-side at paise granularity".
         *
         * DecimalMin is inclusive here, unlike `amount`: a zero portion is
         * arithmetically legal (it simply means the whole amount went the other
         * way), while a NEGATIVE portion is not — two portions of -100 and 350
         * would otherwise "sum correctly" to 250 and record nonsense. Flagged
         * as a derived reading: the contract gives the sum rule but says
         * nothing about each portion's own bounds.
         */
        @DecimalMin(value = "0")
        @Digits(integer = 10, fraction = 2)
        BigDecimal cashAmount,

        @DecimalMin(value = "0")
        @Digits(integer = 10, fraction = 2)
        BigDecimal onlineAmount,

        /*
         * Contract: "string, optional" — no length given, and the column is
         * PostgreSQL `text` with no cap, which the Database Architect asked
         * explicitly not to narrow (2026-10-24). So no @Size here: a DTO cap
         * would reject input the column accepts, and inventing a number is
         * exactly the kind of guess constitution §15 forbids. Flagged in
         * backend/README.md §13 as the one unbounded request field in this
         * domain.
         */
        String notes,

        /*
         * Contract: "string, optional, max 255 — a Cloudinary public_id for an
         * upload authorized by POST /receipts/upload-signature ... NEVER a URL
         * and never a local device URI".
         *
         * The only server-side validation of the value is the claim check
         * (ADR 0020 §3, ReceiptPublicIdPolicy): it must match the configured
         * root and carry the authenticated principal's own user id. Existence
         * is deliberately NOT verified against Cloudinary.
         */
        @Size(max = 255)
        String receiptPublicId,

        /*
         * ADR 0027 §3 (api-overview.md §15.2): optional client-supplied primary
         * key, a UUID that is not the nil UUID. Exists nowhere -> created with
         * it; created by the caller -> 201 with the current row, nothing
         * written; created by someone else -> 409 ID_CONFLICT. clientId sent
         * without id is treated as id; both sent and different -> 400.
         */
        UUID id) {
}
