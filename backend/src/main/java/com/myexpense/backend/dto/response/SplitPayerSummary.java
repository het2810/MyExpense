package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One entry of {@code SplitExpenseResponse.payers[]} (api-overview.md §9.3,
 * docs/decisions/0025-multiple-payers-per-split-expense.md §5.2).
 *
 * <p>Both id keys are <strong>always present</strong> and exactly one is non-null,
 * the same "uniform key set, present-but-null" convention as
 * {@link SplitParticipantSummary}.
 *
 * <p>{@link #name} is resolved <strong>live</strong>, exactly as the deprecated
 * {@code paidByName} is: {@code split_expense_payers} has no name column, so a
 * payer's rename shows up here. That is the opposite of
 * {@code participants[].name}, which is a frozen snapshot (ADR 0025 §2.2).
 *
 * <p>{@link #amount} is what this payer actually paid
 * ({@code split_expense_payers.amount_paid}). Across one response the amounts sum
 * exactly to the split's {@code amount}.
 */
public record SplitPayerSummary(
        UUID payerUserId,
        UUID payerContactId,
        String name,
        BigDecimal amount) {
}
