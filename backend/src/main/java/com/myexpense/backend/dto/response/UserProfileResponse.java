package com.myexpense.backend.dto.response;

import java.time.OffsetDateTime;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * {@code UserProfileResponse} (api-overview.md §2.1) — returned by
 * {@code GET}/{@code PATCH /users/me} and {@code PATCH /users/me/premium}.
 *
 * <p>Distinct from {@code UserResponse} (authentication-api.md's shape) on
 * purpose: this one carries {@code phone}, {@code isPremium} and
 * {@code defaultCurrencyCode} but no {@code roles}. Neither is derived from
 * the other — each matches its own contract exactly.
 *
 * <p>Never the {@code User} entity: {@code passwordHash},
 * {@code failedLoginAttempts} and {@code lockedUntil} must never cross the
 * API boundary (constitution §9).
 *
 * <p>{@code phone} is serialized as {@code null} when unset — the contract
 * declares it {@code "string | null"}, so it is present-and-null rather than
 * omitted.
 */
public record UserProfileResponse(
        UUID id,
        String email,
        String phone,
        String firstName,
        String lastName,
        boolean emailVerified,

        // Explicit wire name — see UpdatePremiumRequest for why isXxx
        // properties are never left to Jackson's default naming here.
        @JsonProperty("isPremium")
        boolean isPremium,

        String defaultCurrencyCode,
        OffsetDateTime createdAt) {
}
