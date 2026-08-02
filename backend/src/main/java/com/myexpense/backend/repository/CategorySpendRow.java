package com.myexpense.backend.repository;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One row of {@code GET /api/v1/statistics/categories}' aggregate: a
 * <strong>leaf</strong> category id and the total expense amount tagged to it
 * within the requested date range (api-overview.md §14.1).
 *
 * <p>Produced only by
 * {@link TransactionRepository#aggregateSpendByCategory(UUID, java.time.LocalDate, java.time.LocalDate)}
 * via a JPQL constructor expression, so the aggregate never travels as an
 * {@code Object[]} that a caller has to index by position and cast.
 *
 * <p><strong>Deliberately carries no display value and no parent id.</strong>
 * Both come from the one {@code categories} read that
 * {@code StatisticsService} performs — api-overview.md §14.1 requires the
 * emitted {@code categoryName}/{@code iconName}/{@code glyph} to be the
 * category row's values <em>as they are now</em> rather than a transaction
 * snapshot, and the parent→child roll-up is a property of the category tree,
 * not of a transaction. Keeping both out of this projection means there is
 * exactly one source for each (`docs/decisions/0022-statistics-expenses-by-parent-category.md`
 * §3/§8) rather than two that could disagree.
 *
 * <p>A {@code repository}-package type rather than a DTO: this is the shape a
 * query returns, never a wire shape. The API's own shape is
 * {@code dto/response/CategoryStatisticsResponse}.
 *
 * @param categoryId the leaf category — a top-level category or a subcategory
 *                   (ADR 0019 §5). Never {@code null}: the query's join to
 *                   {@code categories} cannot match a row whose
 *                   {@code category_id} is {@code NULL}
 * @param amount     {@code sum(amount)} over {@code numeric(12,2)} values, so
 *                   exact decimal and never {@code null} — a group exists only
 *                   because at least one row fell into it
 */
public record CategorySpendRow(UUID categoryId, BigDecimal amount) {
}
