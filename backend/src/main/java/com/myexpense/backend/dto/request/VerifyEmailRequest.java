package com.myexpense.backend.dto.request;

import jakarta.validation.constraints.NotBlank;

/** Request body for {@code POST /api/v1/auth/verify-email} (authentication-api.md §7). */
public record VerifyEmailRequest(

        @NotBlank
        String token) {
}
