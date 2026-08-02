package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * Base type for every domain-level error that {@link GlobalExceptionHandler}
 * maps directly onto {@code ApiErrorResponse} (security-architecture.md §4).
 * Each subclass fixes its own HTTP status and {@code error} code so the
 * mapping table lives next to the condition it represents, not duplicated
 * in the handler.
 */
public abstract class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String errorCode;

    protected ApiException(HttpStatus status, String errorCode, String message) {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getErrorCode() {
        return errorCode;
    }
}
