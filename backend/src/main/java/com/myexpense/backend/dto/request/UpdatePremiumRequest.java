package com.myexpense.backend.dto.request;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.NotNull;

/**
 * Request body for {@code PATCH /api/v1/users/me/premium}
 * (api-overview.md §2.5): {@code { "isPremium": boolean }} — required, a
 * plain boolean flip with no billing behind it.
 *
 * <p>{@code @JsonProperty("isPremium")} is explicit rather than relying on
 * the component name: Jackson's is-getter naming rules make the wire name of
 * an {@code isXxx} property ambiguous, and the contract's field is
 * {@code isPremium}, not {@code premium}.
 *
 * <p>Boxed {@code Boolean} so that a missing field is {@code null} and fails
 * {@code @NotNull} with a {@code 400 VALIDATION_ERROR}, instead of silently
 * defaulting to {@code false} and switching premium off.
 */
public record UpdatePremiumRequest(

        @NotNull
        @JsonProperty("isPremium")
        Boolean isPremium) {
}
