package com.myexpense.backend.dto.request;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code POST /api/v1/split-expenses} (api-overview.md §9.1).
 *
 * <p>A record, like {@link CreateTransactionRequest}: on a create there is no
 * "field omitted vs. explicitly null" distinction to preserve, and §9 has no
 * PATCH at all.
 *
 * <h2>Five values this body deliberately does NOT carry</h2>
 *
 * <p>{@code categoryName}, {@code parentCategoryName}, {@code categoryIconName},
 * {@code categoryGlyph} and {@code categoryTone} are
 * <strong>server-authoritative</strong> and must never become request fields
 * ({@code V11} contract item 5, ADR 0018 §3, ADR 0019 §5). The server snapshots
 * them from the resolved leaf category — or, when {@code categoryId} is omitted,
 * from the caller's protected {@code Misc} row (ADR 0023 §3). "Helpfully"
 * accepting them to save a lookup is the predictable shortcut.
 *
 * <p>{@code participants[].name} is server-resolved too — see
 * {@link SplitParticipantRequest}.
 *
 * <h2>No {@code currencyCode}, and no {@code clientId}</h2>
 *
 * <p>Currency is a display symbol only and appears exactly once in this API, on
 * §2.1's {@code defaultCurrencyCode} (ADR 0017's Scope Narrowing banner).
 * {@code clientId} is not here either: {@code split_expenses} has no such column
 * ({@code V11} FLAG 6 records the Domain 8 ruling that would change that), so
 * accepting one would be accepting a value with nowhere to go.
 *
 * <h2>The payer contract (ADR 0025 §5.1, 2026-11-06)</h2>
 *
 * <p>Exactly one payer form per request: the legacy single-payer pair
 * {@code paidByUserId}/{@code paidByContactId}, <em>or</em> {@code payers[]}.
 * A legacy request is treated as a one-element {@code payers[]} carrying the whole
 * {@code amount}, so the two forms are equivalent for a single payer. Payers need
 * not be participants. The server writes the <strong>primary payer</strong>
 * (largest amount, tie: first in request order) to {@code split_expenses.paid_by_*}.
 *
 * <h2>Which cross-field rules are NOT here</h2>
 *
 * <p>Bean Validation can constrain one field at a time; everything of the form
 * "required iff" or "exactly one of" lives in {@code SplitExpenseService} as a
 * named {@link com.myexpense.backend.exception.SplitRuleViolationException}
 * factory, with {@code V11}'s CHECK constraints as backstops. That split is
 * deliberate and matches Domain 4 exactly: a {@code 400} naming a single field is
 * only honest when a single field is wrong.
 */
public record CreateSplitExpenseRequest(

        /*
         * Contract: "string, required, max 255". @NotBlank because
         * chk_split_expenses_title_not_blank exists for this input and V11 maps
         * reaching it to a 400 that Bean Validation should already have produced.
         * Trimmed in the service before persist.
         */
        @NotBlank
        @Size(max = 255)
        String title,

        /*
         * Contract: "uuid, optional — may be a subcategory id". OMITTING IT IS
         * LEGAL AND IS NOT "no category": the server resolves the caller's
         * PROTECTED Misc row and snapshots it, setting category_id to it
         * (ADR 0023 §3). The four snapshot columns stay NOT NULL and are never
         * written null.
         */
        UUID categoryId,

        /*
         * Contract: "YYYY-MM-DD, required". Jackson parses the ISO form into
         * LocalDate; a malformed value is a 400 from the message converter, not a
         * silent null.
         *
         * No upper bound and no future-date rule: §9.1 states none, and a split
         * can legitimately be back-dated or dated today. Inventing a bound here
         * would reject input the contract accepts (constitution §15).
         */
        @NotNull
        LocalDate splitDate,

        /*
         * Contract: "number, required, > 0", matched by
         * chk_split_expenses_amount_positive. Digits matches numeric(12,2)
         * exactly, which is what makes the participant-sum comparison exact
         * rather than approximate (V11 contract item 2).
         */
        @NotNull
        @DecimalMin(value = "0", inclusive = false)
        @Digits(integer = 10, fraction = 2)
        BigDecimal amount,

        /*
         * Contract: "'individual' | 'group', required".
         *
         * A validated String rather than the SplitMode enum, for the reason
         * ListTransactionsQuery records: Spring/Jackson enum binding is
         * case-sensitive on the CONSTANT NAME ('GROUP'), while the contract's
         * values are lowercase. Validating the exact contract literal here and
         * converting in the service keeps the accepted vocabulary identical to the
         * documented one.
         */
        @NotBlank
        @Pattern(regexp = "individual|group", message = "must be 'individual' or 'group'")
        String splitMode,

        /* Contract: "required iff splitMode='group'" — a cross-field rule; see the class Javadoc. */
        UUID groupId,

        /*
         * Contract: "required iff splitMode='individual' — the other party's
         * contact; the server resolves-or-creates the matching individual_balances
         * row".
         *
         * IT IS A CONTACT OF THE CALLER'S, NEVER A USER ID, and that is the whole
         * hinge of ADR 0023 §1.3: the server reads the contact's linked_user_id and
         * resolves either the shared canonical user-pair row or the caller's
         * private contact row. A client can never name a counterpart account
         * directly, which is what stops one user attaching an arbitrary stranger to
         * a pairwise ledger.
         */
        UUID individualCounterpartContactId,

        /*
         * Contract (added 2026-11-11, ADR 0026 §5.1): the MULTI-CONTACT form —
         * optional, 1-49 of the CALLER'S OWN contacts, in the order the user
         * selected them. Never user ids, for the same reason as the single field
         * above. The first entry is the PRIMARY counterpart, whose pair row is
         * written to split_expenses.individual_balance_id.
         *
         * EXACTLY ONE COUNTERPART FORM PER INDIVIDUAL REQUEST: this or
         * individualCounterpartContactId. Both is 400
         * counterpartFormsAreMutuallyExclusive; neither is the existing 400
         * counterpartContactRequiredForIndividualMode; this in group mode is 400
         * counterpartContactsNotAllowedForGroupMode. Cross-field rules, so they
         * live in the service (see the class Javadoc). A one-element array is
         * exactly equivalent to the single field, which is NOT deprecated.
         *
         * @Size passes on null, which keeps the field optional, while min = 1
         * makes `[]` a field error. max = 49 is a derived bound: participants is
         * capped at 50, and the creator plus 49 counterparts fills it. It also
         * bounds one request's write amplification (49 upserts, link rows and
         * deltas).
         */
        @Size(min = 1, max = 49)
        List<@NotNull UUID> individualCounterpartContactIds,

        /*
         * Contract: "'equally' | 'unequally' | 'percentage' | 'shares' |
         * 'adjustment', required" (ADR 0005 §5's five tabs).
         *
         * THE DATABASE DELIBERATELY HAS NO CHECK ON THIS COLUMN (V11), so this
         * @Pattern is the only vocabulary guard that exists. V11's reasoning: the
         * method records HOW the shares were derived in the UI, not what they are —
         * the participant amounts are already explicit — so an out-of-vocabulary
         * value produces no silent arithmetic and partitions no money.
         */
        @NotBlank
        @Pattern(regexp = "equally|unequally|percentage|shares|adjustment",
                message = "must be one of 'equally', 'unequally', 'percentage', 'shares', 'adjustment'")
        String splitMethod,

        /*
         * Contract: the LEGACY single-payer form — exactly one of
         * paidByUserId/paidByContactId, and only when `payers` is absent or null
         * (ADR 0025 §5.1). Still supported and not deprecated on the request: it
         * is shorthand for payers: [{ <that identity>, amount: <amount> }], so
         * existing clients and queued sync payloads keep working unchanged.
         */
        UUID paidByUserId,

        UUID paidByContactId,

        /*
         * Contract (added 2026-11-06, ADR 0025 §5.1): the MULTI-PAYER form —
         * optional, 1-50 entries, each with exactly one identity and an amount
         * > 0, identities distinct, amounts summing exactly to `amount`.
         *
         * EXACTLY ONE PAYER FORM PER REQUEST. Supplying both this and a paidBy*
         * field is 400 payerFormsAreMutuallyExclusive; supplying neither is the
         * existing 400 exactlyOnePayerRequired. Both are cross-field rules, so
         * they live in SplitPayerResolver, not here (see the class Javadoc).
         *
         * @Size passes on null, which is what keeps the field optional, while
         * min = 1 makes `payers: []` a field error (R1c). max = 50 is the same
         * derived bound as `participants`: a split cannot have more payers than a
         * group can have members.
         *
         * @Valid propagates each entry's own @NotNull/@DecimalMin/@Digits (R5).
         */
        @Size(min = 1, max = 50)
        List<@NotNull @Valid SplitPayerRequest> payers,

        /*
         * Contract: the participants and their shares, summing exactly to
         * `amount`.
         *
         * @NotEmpty rather than @NotNull: a split expense with no participants has
         * no balance impact at all, so an empty array could only ever be a client
         * bug, and the sum rule would reject it anyway with a less specific
         * message.
         *
         * @Valid propagates each entry's own constraints — without it the nested
         * record's @NotNull/@DecimalMin/@Digits are silently ignored, which is the
         * classic Bean Validation omission.
         *
         * THE SIZE CAP IS A DERIVED BOUND, NOT A CONTRACT FIGURE, and is flagged in
         * backend/README.md §16.6. §9.1 states no maximum. 50 matches
         * CreateGroupRequest#memberContactIds' cap exactly — a split cannot have
         * more participants than a group can have members, so one number for both
         * is consistent rather than two invented ones — and it is far above any
         * real group, so it can never bind a legitimate request. It bounds the
         * one request in this domain that writes an unbounded number of rows.
         */
        @NotEmpty
        @Size(max = 50)
        List<@NotNull @Valid SplitParticipantRequest> participants,

        /*
         * Contract: "boolean, required".
         *
         * A boxed Boolean with @NotNull, not a primitive: a primitive would default
         * a missing field to false and silently drop the caller's own
         * consumption-share transaction, which is the one effect of this endpoint a
         * user would notice immediately. The same reason CreateTransactionRequest's
         * required numbers are boxed.
         */
        @NotNull
        Boolean addToPersonalExpenses,

        /*
         * ADR 0027 §3.2: optional client-supplied primary key, not the nil UUID.
         * Created by the caller already -> 201 with the current split, nothing
         * written; someone else's -> 409 ID_CONFLICT.
         */
        UUID id,

        /*
         * ADR 0027 §3.2: the id the server gives the consumption-share
         * transaction it creates. Allowed only with addToPersonalExpenses: true
         * (else 400). Applied atomically with `id`; an id that already exists is
         * 409 ID_CONFLICT.
         */
        UUID personalTransactionId) {
}
