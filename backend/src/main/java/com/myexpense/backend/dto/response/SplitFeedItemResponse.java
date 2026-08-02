package com.myexpense.backend.dto.response;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One item of {@code GET /groups/{id}/feed} and
 * {@code GET /splits/individuals/{id}/feed} (ADR 0028 §7.5, api-overview.md §9.6).
 *
 * <p>Exactly one of {@link #splitExpense}/{@link #settlement} is non-null.
 * {@code occurredOn}: a split's {@code split_date}, or a settlement's
 * {@code settled_at} date in the request's {@code timeZone}. {@code occurredAt}:
 * a split's {@code created_at}, or {@code settled_at}. A deleted split is a
 * tombstone ({@code splitExpense.deletedAt} set). <strong>No viewer-relative
 * status is sent</strong> — the client derives it (§7.8).
 */
public record SplitFeedItemResponse(
        String itemType,
        UUID id,
        LocalDate occurredOn,
        OffsetDateTime occurredAt,
        SplitExpenseResponse splitExpense,
        SplitFeedSettlementResponse settlement) {

    public static final String TYPE_SPLIT_EXPENSE = "split_expense";
    public static final String TYPE_SETTLEMENT = "settlement";
}
