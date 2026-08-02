package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 400 VALIDATION_ERROR} for the Budget domain's cross-field rules that
 * Bean Validation cannot express on a single field (api-overview.md §5.2,
 * security-architecture.md §3).
 *
 * <p>One parameterized class with named static factories, exactly as
 * {@link TransactionRuleViolationException} and
 * {@code SplitRuleViolationException} already do: each condition keeps its name
 * at the throw site while the messages live in one place where they can be
 * compared. §5.2's error table lists a single {@code 400 VALIDATION_ERROR} row
 * ("field constraints violated") plus the dedicated {@code PERIOD_OVERLAP}, so
 * inventing extra codes here would be inventing contract (constitution
 * §15/§30). Where a dedicated code <em>is</em> specified, a dedicated class
 * exists instead ({@link PeriodOverlapException},
 * {@link BudgetPeriodNotFoundException}, {@link NoActivePeriodException},
 * {@link CategoryNotFoundException}).
 *
 * <p>A cap on a <em>subcategory</em> deliberately has no factory here: it reuses
 * {@link SubcategoryCapNotSupportedException}, the exact exception
 * {@code POST}/{@code PATCH /categories} already throw for the same rule (ADR
 * 0019 §4). One rule, one message, one code — a second spelling of "caps are
 * top-level-only" would be drift (constitution §3.4).
 *
 * <p>The responses carry no {@code fieldErrors}, matching every other
 * {@code VALIDATION_ERROR} produced outside Bean Validation; each message names
 * the fields involved in prose instead.
 */
public class BudgetRuleViolationException extends ApiException {

    private BudgetRuleViolationException(String message) {
        super(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    /**
     * {@code endDate} earlier than {@code startDate}.
     *
     * <p><strong>A deliberate second line of defence, not duplication.</strong>
     * {@code UpsertBudgetPeriodRequest}'s {@code @AssertTrue} should reject this
     * first, with the richer {@code fieldErrors} shape. This factory exists
     * because the failure mode behind it is unusually bad: {@code V14}'s
     * exclusion constraint evaluates
     * {@code daterange(start_date, end_date, '[]')} on every row, and
     * {@code daterange()} <em>raises</em> on a reversed range with
     * {@code SQLSTATE 22000} and <strong>no constraint name</strong>, which is
     * unmappable onto any client error.
     * {@code chk_budget_periods_date_order} fires first and is named, so the
     * worst case is an honest {@code 500} rather than an unexplainable one — but
     * the right answer is for neither to be reached, so the service re-checks.
     *
     * <p>A single-day period ({@code endDate == startDate}) is legal, matching
     * the CHECK's {@code >=}: unusual, but nothing in §5.2 or ADR 0010 §5
     * forbids it, so the API must not.
     */
    public static BudgetRuleViolationException periodDatesReversed() {
        return new BudgetRuleViolationException("endDate must not be earlier than startDate.");
    }

    /**
     * The same category named twice in one {@code categoryCaps} array.
     *
     * <p>Backed by {@code uq_budget_period_category_caps_period_category}
     * ({@code V14}'s flagged addition, {@code SQLSTATE 23505}), but rejected here
     * first so the client gets this message instead of a translated constraint
     * violation. There is no legitimate reading of two caps on one category in
     * one period: the Budget Summary would list the category twice, and any
     * "spent vs cap" comparison would have two caps to choose between with no
     * rule for choosing.
     */
    public static BudgetRuleViolationException duplicateCategoryCap() {
        return new BudgetRuleViolationException(
                "categoryCaps must not name the same category more than once.");
    }
}
