package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.myexpense.backend.dto.request.CreateSplitExpenseRequest;
import com.myexpense.backend.dto.request.SplitPayerRequest;
import com.myexpense.backend.exception.SplitRuleViolationException;

/**
 * The request-shape half of ADR 0025's payer rules
 * (docs/decisions/0025-multiple-payers-per-split-expense.md §3, §5.1): which payer
 * form was used, each entry's identity XOR, duplicates as sent, the payer sum, and
 * the primary-payer choice.
 *
 * <p>Extracted from {@code SplitExpenseService} as ADR 0025's Backend follow-up
 * item 4 asks, so that service does not grow further past constitution §26's
 * guideline. Everything here is a pure function of the request: no repository, no
 * state. The rules that need the database or the resolved target stay in the
 * service: group membership (R6), pair normalisation (R7) and the post-normalisation
 * duplicate check (R3's second half).
 *
 * <p>Every failure is a {@link SplitRuleViolationException}, so every one is
 * {@code 400 VALIDATION_ERROR} and every one is decided before the first write.
 */
final class SplitPayerResolver {

    private SplitPayerResolver() {
    }

    /**
     * One payer as the client named them: exactly one of {@code userId} /
     * {@code contactId}, plus what they paid.
     */
    record RequestedPayer(UUID userId, UUID contactId, BigDecimal amount) {
    }

    /**
     * ADR 0025 §5.1 R1-R3 (the as-sent duplicate check), in that order.
     *
     * <p>A legacy request becomes a one-element list carrying the whole
     * {@code amount}, which is what makes "a single-element {@code payers[]} is
     * exactly equivalent to the legacy form" true by construction: from here on
     * there is one code path.
     *
     * @return the payers in request order, never empty
     */
    static List<RequestedPayer> resolve(CreateSplitExpenseRequest request) {
        return resolve(request.paidByUserId(), request.paidByContactId(), request.payers(), request.amount());
    }

    /**
     * The same rules over the payer fields alone — shared by create and by
     * {@code PUT /split-expenses/{id}}, whose payer contract is create's,
     * unchanged (ADR 0028 §6.2).
     */
    static List<RequestedPayer> resolve(
            UUID paidByUserId, UUID paidByContactId, List<SplitPayerRequest> requestedPayers, BigDecimal amount) {
        boolean legacyByUser = paidByUserId != null;
        boolean legacyByContact = paidByContactId != null;

        if (requestedPayers == null) {
            // R1b — the legacy form, unchanged from before ADR 0025.
            if (legacyByUser == legacyByContact) {
                throw SplitRuleViolationException.exactlyOnePayerRequired();
            }
            return List.of(new RequestedPayer(paidByUserId, paidByContactId, amount));
        }

        // R1a. R1c (payers: []) never reaches here: @Size(min = 1) rejects it.
        if (legacyByUser || legacyByContact) {
            throw SplitRuleViolationException.payerFormsAreMutuallyExclusive();
        }

        List<RequestedPayer> payers = new ArrayList<>(requestedPayers.size());
        Set<RequestedPayerKey> seen = new HashSet<>();
        for (SplitPayerRequest entry : requestedPayers) {
            boolean byUser = entry.payerUserId() != null;
            boolean byContact = entry.payerContactId() != null;
            if (byUser == byContact) {
                throw SplitRuleViolationException.exactlyOnePayerIdentityRequired(); // R2
            }
            if (!seen.add(new RequestedPayerKey(entry.payerUserId(), entry.payerContactId()))) {
                throw SplitRuleViolationException.duplicatePayer(); // R3, as sent
            }
            payers.add(new RequestedPayer(entry.payerUserId(), entry.payerContactId(), entry.amount()));
        }
        return List.copyOf(payers);
    }

    /**
     * ADR 0025 §5.1 R4. Exact {@link BigDecimal#compareTo}, no tolerance: every
     * amount is already limited to two decimals by {@code @Digits(fraction = 2)}.
     * Trivially true for the legacy form, so it is safe to call for both.
     */
    static void requireSumEquals(BigDecimal amount, List<BigDecimal> payerAmounts) {
        BigDecimal sum = BigDecimal.ZERO;
        for (BigDecimal payerAmount : payerAmounts) {
            sum = sum.add(payerAmount);
        }
        if (sum.compareTo(amount) != 0) {
            throw SplitRuleViolationException.payerAmountsDoNotSumToAmount();
        }
    }

    /**
     * ADR 0025 §3: the index of the <strong>primary payer</strong>, the entry with
     * the largest amount. On a tie, the first such entry in request order, which is
     * why the comparison is a strict {@code >}.
     */
    static int primaryIndex(List<BigDecimal> payerAmounts) {
        int primary = 0;
        for (int i = 1; i < payerAmounts.size(); i++) {
            if (payerAmounts.get(i).compareTo(payerAmounts.get(primary)) > 0) {
                primary = i;
            }
        }
        return primary;
    }

    /** The identity half of a payer entry, so a {@link Set} is the duplicate check. */
    private record RequestedPayerKey(UUID userId, UUID contactId) {
    }
}
