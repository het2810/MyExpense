package com.myexpense.backend.dto.request;

import java.math.BigDecimal;
import java.util.UUID;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;

/**
 * One entry of {@code POST /api/v1/split-expenses}' optional {@code payers[]}
 * (api-overview.md §9.1, docs/decisions/0025-multiple-payers-per-split-expense.md
 * §5.1).
 *
 * <p>The identity keys are prefixed with their role, {@code payerUserId} /
 * {@code payerContactId}, like every other identity pair in this API
 * ({@code participantUserId}, {@code paidByUserId}) and like the columns they land
 * in ({@code split_expense_payers.payer_user_id} / {@code payer_contact_id}).
 *
 * <p>There is no {@code name} field: a payer's name is resolved live in the
 * response (ADR 0025 §5.2), never supplied by the client.
 */
public record SplitPayerRequest(

        /*
         * Exactly one of payerUserId/payerContactId. The XOR is a cross-field rule
         * and lives in SplitPayerResolver (SplitRuleViolationException
         * #exactlyOnePayerIdentityRequired, ADR 0025 §5.1 R2), with
         * chk_split_expense_payers_user_xor_contact as the backstop.
         */
        UUID payerUserId,

        UUID payerContactId,

        /*
         * "number, required, > 0, at most 2 decimal places" (ADR 0025 §5.1 R5).
         *
         * STRICTLY positive, unlike SplitParticipantRequest#amount: a participant
         * with a zero share is meaningful, a payer who paid zero is not a payer.
         * chk_split_expense_payers_amount_paid_positive is the matching backstop.
         * Digits matches numeric(12,2), so the payer-sum comparison is exact.
         */
        @NotNull
        @DecimalMin(value = "0", inclusive = false)
        @Digits(integer = 10, fraction = 2)
        BigDecimal amount) {
}
