package com.myexpense.backend.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/** Request body for {@code POST /api/v1/auth/login} (authentication-api.md §2). */
public record LoginRequest(

        @NotBlank
        @Email
        String email,

        @NotBlank
        String password) {
}
