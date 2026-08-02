package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One entry of {@link BudgetPeriodResponse}'s {@code categoryCaps} array
 * (api-overview.md §5.1's response shape).
 *
 * <p>{@code categoryName} and {@code monthlyCap} are read straight off the frozen
 * {@code budget_period_category_caps} row — <strong>no join that reads a display
 * value from {@code categories} anywhere in this domain</strong> ({@code V14}
 * contract item 7, as amended by ADR 0024 §4.6). The name on the row is what
 * renders, which is the whole point of the snapshot: a historical period keeps
 * reading "Food ₹3,000" after Food is renamed or deleted, because that is what
 * the user actually decided. Do not "freshen" it with a read-time join — whether
 * a rename should reach a saved cap is ADR 0021's Open Question 3, and a join
 * would answer it silently on every read.
 *
 * <p><strong>{@code categoryId} is nullable, and the key is always
 * present.</strong> A {@code null} means exactly one thing: the capped category
 * has since been deleted. <strong>How the {@code null} is produced changed on
 * 2026-11-03</strong> (ADR 0024 §4.6; the contract did not): categories are
 * soft-deleted now, so the cap row's stored {@code category_id} is kept, never
 * nulled, and the budget read returns it only when that category is live —
 * through one liveness-only left join
 * ({@code BudgetPeriodCategoryCapRepository#findCapRowsByBudgetPeriodId}). If
 * the category is ever restored, the id reappears on the next read with no
 * write. The key is deliberately not omitted when null, per this project's
 * "uniform key set, present-but-null" convention, so a client renders the cap as
 * a historical figure with no live drill-down rather than discovering a missing
 * key.
 *
 * <p>No {@code parentCategoryName}: only top-level categories can carry a cap
 * this phase (ADR 0019 §4), so the frozen name is unambiguous without one. No
 * {@code spent} and no {@code remaining} either — see
 * {@link BudgetPeriodResponse}.
 */
public record BudgetCategoryCapResponse(
        UUID categoryId,
        String categoryName,
        BigDecimal monthlyCap) {
}
