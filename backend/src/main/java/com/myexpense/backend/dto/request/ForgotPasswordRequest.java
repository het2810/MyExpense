package com.myexpense.backend.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/** Request body for {@code POST /api/v1/auth/forgot-password} (authentication-api.md §5). */
public record ForgotPasswordRequest(

        @NotBlank
        @Email
        String email) {
}
