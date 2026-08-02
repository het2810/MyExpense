package com.myexpense.backend.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/** Request body for {@code POST /api/v1/auth/resend-verification} (authentication-api.md §8). */
public record ResendVerificationRequest(

        @NotBlank
        @Email
        String email) {
}
