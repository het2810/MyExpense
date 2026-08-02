package com.myexpense.backend.repository;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One saved cap as the budget read returns it — produced only by
 * {@link BudgetPeriodCategoryCapRepository#findCapRowsByBudgetPeriodId(UUID)}
 * via a JPQL constructor expression (ADR 0024 §4.6).
 *
 * <p>A {@code repository}-package type rather than a DTO, for the same reason
 * {@link CategorySpendRow} is: this is the shape a query returns, never a wire
 * shape. The API's own shape is {@code dto/response/BudgetCategoryCapResponse}.
 *
 * @param categoryId   the cap's stored {@code category_id} <strong>only when
 *                     that category is live</strong>; {@code null} when it has
 *                     been soft-deleted, and for a legacy row whose stored id
 *                     is already {@code NULL}. This is the read-time half of
 *                     api-overview.md §5.1's "{@code null} if and only if the
 *                     capped category has been deleted" rule. The stored column
 *                     itself is never nulled
 * @param categoryName the cap row's <strong>frozen</strong>
 *                     {@code category_name} — never the category's current name
 * @param monthlyCap   the cap amount, {@code numeric(12,2)}, never {@code null}
 */
public record BudgetCategoryCapRow(UUID categoryId, String categoryName, BigDecimal monthlyCap) {
}
