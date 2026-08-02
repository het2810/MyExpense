package com.myexpense.backend.dto.request;

import java.math.BigDecimal;
import java.util.UUID;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * Request body for {@code POST /api/v1/splits/settle} (api-overview.md §10.1).
 *
 * <h2>⚠ The two counterpart fields are required by ADR 0023 §4 and are NOT yet in
 * §10.1's request block — flagged for the System Architect, not resolved
 * unilaterally</h2>
 *
 * <p>ADR 0023 §4 adds {@code settlements.counterpart_user_id} /
 * {@code counterpart_contact_id}, makes exactly one of them <strong>required for
 * a group settlement</strong>, and {@code V12} implements
 * {@code chk_settlements_counterpart_matches_target} to enforce it. That ADR's
 * Consequences list says api-overview.md §10.1 gains "the counterpart fields" —
 * <strong>but the request block in that document still shows only
 * {@code target}/{@code groupId}/{@code individualBalanceId}/{@code amount}/{@code method}.</strong>
 *
 * <p>This is the <em>same class of contradiction</em> ADR 0023 §3 fixed for
 * {@code categoryId}: without a counterpart, every group settlement would fail
 * with a {@code 23514} from a CHECK the approved schema requires, so the endpoint
 * would be unimplementable for group targets. The fields are therefore accepted
 * here, named exactly as the columns and as ADR 0023 §4's table names them
 * ({@code V12} FLAG 1 candidate (a) states it in those words:
 * "{@code POST /splits/settle} gains a request field"). <strong>Please amend
 * §10.1's request block to match, or tell me to take a different shape.</strong>
 *
 * <p>Nothing else is invented: the response keeps §10.1's documented shape
 * exactly and does <em>not</em> echo the counterpart back — see
 * {@link com.myexpense.backend.dto.response.SettlementResponse}.
 *
 * <h2>What this body deliberately does NOT carry</h2>
 *
 * <p><strong>No payer and no direction field.</strong> ADR 0023 §4 bullet 2: the
 * direction is <em>derived from the two balances</em>, never supplied, because an
 * explicit payer lets a client assert a direction the ledger denies and then
 * something has to decide which is true.
 *
 * <p><strong>No {@code currencyCode}, and {@code 400 CURRENCY_MISMATCH} does not
 * exist.</strong> Added and removed on 2026-10-02 (ADR 0017's Scope Narrowing
 * banner): there is one unit of account, so a settlement is always in the same
 * denomination as the balance it settles and there is nothing to match.
 *
 * <p><strong>No {@code settledAt}.</strong> §10.1 has no back-dating field, so
 * the service supplies it; the column carries no default precisely so the
 * distinction from {@code created_at} stays maintainable if back-dating is ever
 * designed ({@code V12}).
 */
public record CreateSettlementRequest(

        /*
         * Contract: "'group' | 'individual', required — discriminator".
         *
         * A validated String rather than an enum, same reason as
         * CreateSplitExpenseRequest#splitMode. The service re-checks that the ids
         * supplied actually match this discriminator rather than trusting it
         * (SplitRuleViolationException#targetIdsContradictTarget), which is what
         * V12 says keeps chk_settlements_target_xor unreachable.
         */
        @NotBlank
        @Pattern(regexp = "group|individual", message = "must be 'group' or 'individual'")
        String target,

        /* Contract: "required iff target='group'". Cross-field; see the service. */
        UUID groupId,

        /* Contract: "required iff target='individual'". */
        UUID individualBalanceId,

        /*
         * ADR 0023 §4 — required (exactly one of the two) iff target='group',
         * forbidden otherwise. See the ⚠ note in the class Javadoc.
         *
         * A CONTACT counterpart is permitted because ADR 0023 §2 gives
         * unregistered members real balance rows, and forbidding them here would
         * create balances that can never be cleared. ADR 0023 Open Question 2
         * leaves the Project Owner the option of refusing it — "that is one
         * validation rule, not a schema change" — so if the answer is no, the
         * change is one guard in SettlementService and this field stays unused.
         */
        UUID counterpartUserId,

        UUID counterpartContactId,

        /*
         * Contract: "number, required — must be > 0 and must NOT exceed the
         * outstanding balance".
         *
         * Only the > 0 half is expressible here (and in
         * chk_settlements_amount_positive). The <= half is pure service-layer
         * validation because the outstanding balance lives on another table —
         * V12 contract item 1: "400 AMOUNT_EXCEEDS_BALANCE has no constraint
         * behind it and never can".
         *
         * Digits matches numeric(12,2) exactly. That is load-bearing here, not
         * cosmetic: this number is compared against a balance for <= and
         * subtracted from it to produce a residual, so a sub-paise value would
         * make "settled in full" a state that is sometimes not reached.
         */
        @NotNull
        @DecimalMin(value = "0", inclusive = false)
        @Digits(integer = 10, fraction = 2)
        BigDecimal amount,

        /*
         * Contract: "'marked_paid' | 'upi', required" — and
         * chk_settlements_method_valid enforces the same two values in the
         * database, unusually for this schema. V12's reason: a settlement row is
         * an immutable audit record with no UPDATE path, so a junk value here
         * would be permanent in the one table whose entire purpose is to be
         * independently verifiable by both parties later.
         */
        @NotBlank
        @Pattern(regexp = "marked_paid|upi", message = "must be 'marked_paid' or 'upi'")
        String method,

        /*
         * ADR 0027 §3.2: optional client-supplied primary key, not the nil UUID.
         * Created by the caller already -> 201 with the CURRENT remainingBalance,
         * nothing written; someone else's -> 409 ID_CONFLICT.
         */
        UUID id,

        /*
         * ADR 0027 §7.2: with target 'individual', exactly one of
         * individualBalanceId / individualCounterpartContactId (both or neither
         * -> 400). One of the caller's own contacts; resolved to its pair by the
         * same rule POST /split-expenses uses. Not the caller's -> 404
         * CONTACT_NOT_FOUND; no pair row -> 400 AMOUNT_EXCEEDS_BALANCE.
         */
        UUID individualCounterpartContactId,

        /*
         * ADR 0027 §7.3: the direction the user saw when they confirmed. If the
         * ledger now implies the other direction, or the balance is zero ->
         * 409 SETTLEMENT_DIRECTION_CHANGED, nothing written. Absent: unchanged
         * behaviour.
         */
        @Pattern(regexp = "caller_pays|caller_receives", message = "must be 'caller_pays' or 'caller_receives'")
        String expectedDirection) {
}
