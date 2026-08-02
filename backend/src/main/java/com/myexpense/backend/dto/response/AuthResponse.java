package com.myexpense.backend.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * {@code AuthResponse} (authentication-api.md "Common types"), returned by
 * login and refresh. {@code user} is only populated on login — on refresh it
 * must be omitted from the JSON entirely (not sent as {@code null}), hence
 * the class-level {@code @JsonInclude(NON_NULL)}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuthResponse(
        String accessToken,
        String refreshToken,
        String tokenType,
        long expiresIn,
        UserResponse user) {
}
