package com.myexpense.backend.dto.request;

import java.math.BigDecimal;
import java.util.UUID;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;

/**
 * One entry of {@code PUT /api/v1/budget/periods}' {@code categoryCaps} array
 * (api-overview.md §5.2).
 *
 * <p><strong>Two fields, and {@code categoryName} is deliberately NOT one of
 * them.</strong> §5.2 states it explicitly: "the server resolves and snapshots
 * it from {@code categoryId} at save time… the client should not be trusted to
 * supply, or be burdened with knowing, the current category name". It is the
 * same server-authoritative snapshot rule as {@code transactions}' five category
 * columns (ADR 0019 §5) and {@code split_expense_participants.name} (V11
 * contract item 5): accepting the name "helpfully", to save a lookup, is the
 * predictable shortcut.
 *
 * <p>No {@code currencyCode} either — {@code monthlyCap} is a plain figure in
 * the one unit of account (ADR 0017's Scope Narrowing banner).
 *
 * <p><strong>Two rules this record cannot express, both enforced in
 * {@code BudgetService}:</strong> that {@code categoryId} names a category the
 * caller <em>owns</em> ({@code 404 CATEGORY_NOT_FOUND}), and that it is
 * <em>top-level</em> ({@code 400 VALIDATION_ERROR} — ADR 0019 §4). Both need a
 * database lookup, which Bean Validation has no business doing.
 */
public record BudgetCategoryCapRequest(

        /*
         * Contract: "uuid, required". Owner-scoped and top-level-checked in the
         * service; the database's
         * fk_budget_period_category_caps_category_id guarantees only that the
         * category EXISTS, not that the caller owns it and not that it is
         * top-level (V14's own note on that FK).
         */
        @NotNull
        UUID categoryId,

        /*
         * Contract: "number, required, > 0", matched exactly by
         * chk_budget_period_category_caps_monthly_cap_positive. @Digits matches
         * numeric(12,2), so the value that reaches the column is the value the
         * client sent rather than a silently rounded one.
         *
         * A zero cap is NOT "no cap": §3.2's omission-over-null-entry
         * convention says a category with no cap simply has no entry in the
         * array, so zero would be a third, meaningless state.
         */
        @NotNull
        @DecimalMin(value = "0", inclusive = false)
        @Digits(integer = 10, fraction = 2)
        BigDecimal monthlyCap) {
}
