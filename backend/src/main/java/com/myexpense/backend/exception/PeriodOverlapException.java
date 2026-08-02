package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 400 PERIOD_OVERLAP} on {@code PUT /api/v1/budget/periods} — "the
 * requested {@code [startDate, endDate]} overlaps an existing period for this
 * user (excluding the period being edited, if {@code id} supplied)"
 * (api-overview.md §5.2's error table).
 *
 * <p><strong>A dedicated class because the contract defines a dedicated
 * code</strong>, the same test that gives {@code VersionConflictException} and
 * {@code CategoryProtectedException} their own classes while every unnamed
 * cross-field rule shares {@link BudgetRuleViolationException}'s generic
 * {@code VALIDATION_ERROR}. Nothing is invented here: the code already existed in
 * §5.2 before {@code V14} gave it a structural source.
 *
 * <p><strong>Two sources, one code.</strong>
 * <ol>
 *   <li>{@code BudgetService}'s own pre-check, which is the primary path and the
 *       one that produces this error in practice.</li>
 *   <li>{@code excl_budget_periods_user_period_overlap}, {@code V14}'s exclusion
 *       constraint, translated by constraint <em>name</em> — the race backstop
 *       for two concurrent saves that both passed the pre-check. That is
 *       {@code SQLSTATE 23P01}, a code this backend had never seen before
 *       Domain 5; see {@code BudgetService#translateBudgetPeriodViolation}.</li>
 * </ol>
 *
 * <p><strong>This is genuinely reachable from a screen that believes it cannot
 * happen</strong> ({@code V14} FLAG 4): ADR 0010 §5 compares a new period only
 * against the frontend's single stored {@code activePeriod}, while §5.2 — and
 * the constraint — compare against <em>all</em> of the user's periods. A user who
 * saves period A, then B, then edits A's dates forward into B gets a rejection
 * the client never predicted. The server is authoritative, so the message is
 * written to be shown to a user verbatim rather than treated as unreachable.
 *
 * <p>The message deliberately names no dates and no other period: a user editing
 * one period does not need the other one's details to fix this, and the response
 * reveals nothing about rows the request did not name.
 */
public class PeriodOverlapException extends ApiException {

    public PeriodOverlapException() {
        super(
                HttpStatus.BAD_REQUEST,
                "PERIOD_OVERLAP",
                "This period overlaps one of your existing budget periods. Choose dates that do not overlap.");
    }
}
