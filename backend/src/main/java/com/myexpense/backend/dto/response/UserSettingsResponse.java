package com.myexpense.backend.dto.response;

/**
 * {@code UserSettingsResponse} (api-overview.md §2.3/§2.4) — exactly three
 * fields since 2026-10-22.
 *
 * <p>Returned with the documented default values when the caller has no
 * {@code user_settings} row yet; that read never creates one (see
 * {@code UserSettingsService}).
 *
 * <p><strong>{@code subcategoriesEnabled} added 2026-10-22</strong> (ADR 0019
 * §6, api-overview.md §2.3) — default {@code false}, following
 * {@code paymentModeEnabled}'s precedent in every respect. It is a
 * <em>client</em> affordance and gates nothing in this API: no endpoint's
 * accept/reject behaviour and no response shape anywhere depends on it, and in
 * particular {@code GET /categories} always returns the complete tree. Setting
 * it to {@code false} writes one boolean and touches no other row.
 *
 * <p>All three fields are always present, so a client writes the response body
 * rather than the value it asked for (§2.4) — which is also why the frontend's
 * {@code isSettingsResponse} guard needs a third boolean check before this
 * ships.
 *
 * <p>{@code themeMode} is not part of this shape and never will be — theme
 * is device-local (AsyncStorage) only, confirmed 2026-08-17.
 */
public record UserSettingsResponse(
        boolean overspendingAlertsEnabled,
        boolean paymentModeEnabled,
        boolean subcategoriesEnabled) {
}
