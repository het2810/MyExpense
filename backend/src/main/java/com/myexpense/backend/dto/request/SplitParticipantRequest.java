package com.myexpense.backend.dto.request;

import java.math.BigDecimal;
import java.util.UUID;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;

/**
 * One entry of {@code POST /api/v1/split-expenses}' {@code participants[]}
 * (api-overview.md §9.1).
 *
 * <p>A separate file rather than a nested record, matching
 * {@link com.myexpense.backend.dto.response.GroupMemberSummary}'s precedent for
 * the response side: the type is referenced from a service and from a validation
 * annotation, and a nested type buys nothing here.
 *
 * <p><strong>There is no {@code name} field and there must never be one.</strong>
 * {@code split_expense_participants.name} is a server-resolved frozen snapshot
 * ({@code V11} contract item 5): the service reads it off the {@code users} or
 * {@code contacts} row it has already resolved, so a client cannot label someone
 * else's share.
 */
public record SplitParticipantRequest(

        /*
         * Contract: "exactly one of participantUserId/participantContactId
         * required". The XOR itself is a cross-field rule and lives in
         * SplitExpenseService (SplitRuleViolationException
         * #exactlyOneParticipantIdentityRequired), with
         * chk_split_expense_participants_user_xor_contact as the backstop — Bean
         * Validation cannot express "exactly one of two" on either field alone.
         */
        UUID participantUserId,

        UUID participantContactId,

        /*
         * Contract: "number, required" — with no positivity rule, deliberately.
         *
         * DecimalMin is INCLUSIVE here, unlike split_expenses.amount: a ZERO
         * share is legitimate (ADR 0005 §5.7's zero-share person, and §5.8's
         * unadjusted participant when the remainder is exactly consumed), while a
         * NEGATIVE share is not — -100 and 350 would "sum correctly" to 250 while
         * moving one participant's balance the wrong way.
         * chk_split_expense_participants_amount_non_negative is the matching
         * backstop, and ADR 0005 §5.8 confirms it can never bind a legitimate
         * request: adjustments are constrained to >= 0 and confirmation is blocked
         * whenever the remainder would go negative.
         *
         * Digits matches numeric(12,2) exactly, so a sub-paise share is a 400
         * naming the field rather than a silent rounding that then fails the sum
         * check (V11 contract item 2).
         */
        @NotNull
        @DecimalMin(value = "0")
        @Digits(integer = 10, fraction = 2)
        BigDecimal amount) {
}
