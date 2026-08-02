package com.myexpense.backend.dto.request;

import com.myexpense.backend.dto.validation.PasswordComplexity;

import jakarta.validation.constraints.NotBlank;

/** Request body for {@code POST /api/v1/auth/reset-password} (authentication-api.md §6). */
public record ResetPasswordRequest(

        @NotBlank
        String token,

        @NotBlank
        @PasswordComplexity
        String newPassword) {
}
