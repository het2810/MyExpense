package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One entry of {@code SplitExpenseResponse.counterparts[]} (api-overview.md §9.3,
 * docs/decisions/0026-multi-contact-individual-splits.md §5.2).
 *
 * <p>One entry per pair row an individual split moved. Never empty for an
 * individual split, always empty for a group split.
 *
 * <p>{@link #counterpartUserId} / {@link #counterpartContactId}: the counterpart
 * <strong>relative to the split's creator</strong>, exactly one non-null. Not
 * viewer-relative, so one response is valid for every reader and for sync. Both
 * keys are always present, the same "present-but-null" convention as
 * {@link SplitPayerSummary}.
 *
 * <p>{@link #name} is resolved <strong>live</strong>, like
 * {@code payers[].name}.
 *
 * <p>{@link #netAmount} = this counterpart's {@code paid − share} in this split.
 * <strong>Positive = the creator owes this counterpart; negative = this
 * counterpart owes the creator.</strong> Computed from the split's own payer and
 * participant rows, never stored. A viewer who is this counterpart sees the effect
 * on the pair as {@code +netAmount}; the creator sees {@code −netAmount}.
 */
public record SplitCounterpartSummary(
        UUID individualBalanceId,
        UUID counterpartUserId,
        UUID counterpartContactId,
        String name,
        BigDecimal netAmount) {
}
