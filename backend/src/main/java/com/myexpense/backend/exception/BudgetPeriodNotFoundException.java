package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 404 on {@code GET /api/v1/budget/periods/{id}} (api-overview.md §5.3), and on
 * {@code PUT /api/v1/budget/periods} when the supplied {@code id} is not one of
 * the caller's own periods (§5.2's edit-in-place path).
 *
 * <p><strong>Returned both when the period does not exist and when it exists but
 * belongs to a different user</strong> — identically, never a {@code 403}. A
 * {@code 403} would confirm to a non-owner that the id is real
 * (security-architecture.md §2/§4's owner-scoped convention). The message is
 * deliberately the same in both cases for the same reason.
 *
 * <p>Distinct from {@link NoActivePeriodException} and not interchangeable with
 * it: that one answers "you have no periods at all" on an endpoint that names no
 * id, this one answers "that id is not yours or does not exist". §5.1 and §5.3
 * define different codes, so they get different classes.
 *
 * <p>§5.2's error table does not list this code, because it describes the create
 * path; an {@code id} that resolves to nothing is the only honest answer the
 * edit path has, and silently creating a new period under a client-chosen id
 * would let a caller pick its own primary keys.
 */
public class BudgetPeriodNotFoundException extends ApiException {

    public BudgetPeriodNotFoundException() {
        super(HttpStatus.NOT_FOUND, "BUDGET_PERIOD_NOT_FOUND", "Budget period not found.");
    }
}
