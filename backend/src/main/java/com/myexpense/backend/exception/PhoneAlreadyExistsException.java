package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 409 on {@code PATCH /users/me} when the submitted {@code phone} is already
 * claimed by a different account (api-overview.md §2.2) — the same pattern
 * {@link EmailAlreadyExistsException} establishes for registration, backed by
 * the partial unique index {@code uq_users_phone}.
 */
public class PhoneAlreadyExistsException extends ApiException {

    public PhoneAlreadyExistsException() {
        super(HttpStatus.CONFLICT, "PHONE_ALREADY_EXISTS", "This phone number is already in use by another account.");
    }
}
