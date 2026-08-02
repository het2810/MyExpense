package com.myexpense.backend.service;

import com.myexpense.backend.dto.response.BudgetPeriodResponse;

/**
 * What {@code BudgetService#upsertPeriod} hands back: the saved period plus the
 * one fact the HTTP layer needs that the body does not carry — whether the row
 * was <strong>created</strong> or <strong>edited in place</strong>.
 *
 * <p>§5.2 answers {@code 201 Created} for a new period and {@code 200 OK} for an
 * edit, so the status code depends on something only the service knows (whether
 * the request's {@code id} resolved to one of the caller's rows). A service-layer
 * value object keeps that decision out of the controller's hands while leaving
 * the status code — an HTTP concern — in the controller, where constitution §9
 * puts it. The same shape as {@code InviteOutcome} and {@code SmsDispatchResult}
 * in this package.
 *
 * <p>Deliberately not a {@code ResponseEntity} from the service: a service that
 * returns HTTP types is a service that cannot be called from anywhere else
 * (constitution §5's layer separation).
 */
public record BudgetPeriodUpsertResult(BudgetPeriodResponse period, boolean created) {
}
