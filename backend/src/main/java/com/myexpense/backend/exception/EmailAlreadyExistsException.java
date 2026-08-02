package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/** 409 on {@code POST /auth/register} when the email is already registered. */
public class EmailAlreadyExistsException extends ApiException {

    public EmailAlreadyExistsException() {
        super(HttpStatus.CONFLICT, "EMAIL_ALREADY_EXISTS", "An account with this email already exists.");
    }
}
