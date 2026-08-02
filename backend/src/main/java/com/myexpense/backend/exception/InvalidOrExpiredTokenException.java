package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 400 on {@code POST /auth/reset-password} and {@code POST /auth/verify-email}
 * when the token is not found, expired, already used, or of the wrong type.
 */
public class InvalidOrExpiredTokenException extends ApiException {

    public InvalidOrExpiredTokenException() {
        super(HttpStatus.BAD_REQUEST, "INVALID_OR_EXPIRED_TOKEN",
                "This token is invalid, expired, or has already been used.");
    }
}
