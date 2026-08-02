package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * The {@code settlement} half of a {@link SplitFeedItemResponse} (ADR 0028 §7.5,
 * api-overview.md §9.6). {@code payer}/{@code payee} are {@code null} only on
 * settlements recorded before {@code settlements.initiator_is_payer} existed.
 */
public record SplitFeedSettlementResponse(
        UUID id,
        UUID groupId,
        UUID individualBalanceId,
        UUID initiatedByUserId,
        SettlementPartySummary payer,
        SettlementPartySummary payee,
        BigDecimal amount,
        String method,
        OffsetDateTime settledAt) {
}
