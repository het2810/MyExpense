package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 401 on {@code POST /auth/login}. Deliberately generic — never reveals
 * whether the email or the password was wrong
 * (docs/architecture/authentication.md §3).
 */
public class InvalidCredentialsException extends ApiException {

    public InvalidCredentialsException() {
        super(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password.");
    }
}
