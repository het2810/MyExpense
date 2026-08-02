package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 429, thrown when a per-account rate-limit bucket is exhausted
 * (security-architecture.md §11). Not part of the endpoint-level error
 * tables in authentication-api.md, which predate the API-wide rate-limiting
 * requirement added 2026-08-17 — flagged back to the System Architect in
 * the handoff report as a natural, low-risk extension of the same
 * {@code ApiErrorResponse} shape.
 */
public class RateLimitExceededException extends ApiException {

    public RateLimitExceededException() {
        super(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.");
    }
}
