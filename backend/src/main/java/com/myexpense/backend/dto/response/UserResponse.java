package com.myexpense.backend.dto.response;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * {@code UserResponse} (authentication-api.md "Common types"). Never the
 * {@code User} entity itself — {@code passwordHash} and every other internal
 * column never cross the API boundary.
 */
public record UserResponse(
        UUID id,
        String email,
        String firstName,
        String lastName,
        boolean emailVerified,
        List<String> roles,
        OffsetDateTime createdAt) {
}
