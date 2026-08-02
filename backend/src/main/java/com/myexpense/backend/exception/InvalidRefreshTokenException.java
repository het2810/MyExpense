package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/** 401 on {@code POST /auth/refresh} when the token is not found or expired. */
public class InvalidRefreshTokenException extends ApiException {

    public InvalidRefreshTokenException() {
        super(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "The refresh token is invalid or has expired.");
    }
}
