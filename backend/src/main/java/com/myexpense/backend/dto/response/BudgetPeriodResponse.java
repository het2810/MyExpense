package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * The one response shape of the Budget domain — returned by all three endpoints
 * (api-overview.md §5.1, §5.2 and §5.3).
 *
 * <p>A DTO, never the {@code BudgetPeriod} entity (constitution §9). The two
 * tables behind it are assembled in {@code BudgetService}: one read for the
 * period, one for its complete cap list, never one query per cap
 * (constitution §10).
 *
 * <p>{@code categoryCaps} is <strong>always present and never null</strong> — an
 * empty array for a period that caps nothing, which is a normal state (§3.2's
 * omission-over-null-entry convention). A client that treats {@code []} as
 * missing data renders a broken Budget Summary.
 *
 * <p>{@code amount} and each {@code monthlyCap} are {@link BigDecimal}, so they
 * serialize as exact decimals ({@code 20000.00}) rather than as floats. There is
 * <strong>no currency field</strong> on either: currency is a display symbol the
 * client applies from §2.1's {@code defaultCurrencyCode} (ADR 0017's Scope
 * Narrowing banner).
 *
 * <p><strong>No {@code spent}, no {@code remaining} and no {@code savings} field,
 * and that is a contract boundary rather than an oversight.</strong> §5.1's
 * response shape defines none of them, so adding one would be inventing contract
 * (constitution §15/§30). The Dashboard currently derives {@code spent} by
 * summing the transaction rows it has loaded, which understates the figure past
 * the first page of {@code GET /transactions} — a real, reported gap. A
 * server-computed period total is cheap and already indexed
 * ({@code idx_transactions_user_id_txn_date}), but it is an API contract change
 * and therefore the System Architect's call; it is written up, not built, in
 * backend/README.md §18.7.
 *
 * <p><strong>Nothing here says whether the period has ended.</strong> That
 * comparison is explicitly the client's ({@code endDate} vs. today — §5's intro,
 * ADR 0011's {@code getPostAuthDestination}), so there is no {@code isEnded} or
 * {@code isActive} field to disagree with the client's own clock.
 */
public record BudgetPeriodResponse(
        UUID id,
        String periodType,
        LocalDate startDate,
        LocalDate endDate,
        BigDecimal amount,
        List<BudgetCategoryCapResponse> categoryCaps,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {
}
