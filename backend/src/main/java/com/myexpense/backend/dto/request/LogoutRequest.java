package com.myexpense.backend.dto.request;

import jakarta.validation.constraints.NotBlank;

/** Request body for {@code POST /api/v1/auth/logout} (authentication-api.md §4). */
public record LogoutRequest(

        @NotBlank
        String refreshToken) {
}
