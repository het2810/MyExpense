package com.myexpense.backend.dto.request;

import jakarta.validation.constraints.NotBlank;

/** Request body for {@code POST /api/v1/auth/refresh} (authentication-api.md §3). */
public record RefreshTokenRequest(

        @NotBlank
        String refreshToken) {
}
