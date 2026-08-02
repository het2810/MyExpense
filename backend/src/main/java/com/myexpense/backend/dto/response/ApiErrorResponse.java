package com.myexpense.backend.dto.response;

import java.time.OffsetDateTime;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The single error response shape used across the entire API
 * (authentication-api.md "Common types", security-architecture.md §4).
 * {@code fieldErrors} is present only on Bean Validation 400s — omitted
 * (not {@code null}) on every other error.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiErrorResponse(
        OffsetDateTime timestamp,
        int status,
        String error,
        String message,
        String path,
        List<FieldErrorDetail> fieldErrors) {

    public record FieldErrorDetail(String field, String message) {
    }
}
