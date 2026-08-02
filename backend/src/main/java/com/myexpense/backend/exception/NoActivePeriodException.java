package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 404 on {@code GET /api/v1/budget/active-period} when the caller has never
 * saved a budget period (api-overview.md §5.1).
 *
 * <p><strong>This is a NORMAL answer, not an error condition</strong>
 * ({@code V14} contract item 2, ADR 0011). A user with no period is in a
 * first-class, correct state: ADR 0011's post-auth gate calls this endpoint
 * before it can route anywhere, and this {@code 404} is the signal that sends a
 * brand-new account to Budget Settings. Immediately after {@code V14} is
 * applied, <strong>every existing user</strong> gets this answer, because nothing
 * is backfilled — inventing a period would fabricate a financial commitment the
 * user never made.
 *
 * <p>So it is deliberately <strong>not logged as a failure</strong>:
 * {@code GlobalExceptionHandler} logs nothing for an {@link ApiException}, and
 * {@code BudgetService} does not log it either. A {@code WARN} per app launch
 * for the app's own happy path would be noise that trains a reader to ignore the
 * log (constitution §23).
 *
 * <p>§5.1 chooses a real {@code 404} over a {@code 200} with a null body,
 * "consistent with this document's general resource-existence conventions" — so
 * the client's {@code activePeriod: null} state is expressed by the status code,
 * not by a nullable payload.
 */
public class NoActivePeriodException extends ApiException {

    public NoActivePeriodException() {
        super(HttpStatus.NOT_FOUND, "NO_ACTIVE_PERIOD", "No budget period has been set.");
    }
}
