package com.myexpense.backend.dto.request;

/**
 * Request body for {@code PATCH /api/v1/users/me/settings}
 * (api-overview.md §2.4) — partial update, all three fields optional.
 *
 * <p>Boxed {@code Boolean} rather than {@code boolean}: {@code null} means
 * "not sent, leave unchanged", which a primitive could not express (it would
 * silently default to {@code false} and turn every partial update into a
 * full overwrite). Unlike {@code phone} on §2.2, none of the three is nullable
 * in the data model, so there is no third "explicitly clear it" intent to
 * distinguish — a plain record is sufficient here.
 *
 * <p><strong>{@code subcategoriesEnabled} added 2026-10-22</strong> (ADR 0019
 * §6, follow-up item 1) — a third boxed {@code Boolean} under exactly the same
 * "null means not sent" rule, no new mechanism. Sending {@code false} hides
 * the second level in the client and <em>destroys nothing</em>: this endpoint
 * must never cascade into {@code categories}, and it does not — the writer
 * touches one column on one row (ADR 0019 §6.2).
 *
 * <p>A non-boolean JSON value for any field fails deserialization and is
 * reported as {@code 400 VALIDATION_ERROR} by the central handler, so no
 * further Bean Validation annotation is required.
 *
 * <p>{@code themeMode} is deliberately absent — theme is device-local only
 * and is never server-tracked (api-overview.md §2.3, data-model.md §1.5).
 */
public record UpdateUserSettingsRequest(
        Boolean overspendingAlertsEnabled,
        Boolean paymentModeEnabled,
        Boolean subcategoriesEnabled) {
}
