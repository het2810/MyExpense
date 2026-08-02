package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 409 ID_CONFLICT} (ADR 0027 §3.3/§4.4): a create's client-supplied
 * {@code id} already exists and was created by someone else. Nothing is
 * written, and the other row is never touched.
 */
public class IdConflictException extends ApiException {

    public IdConflictException() {
        super(HttpStatus.CONFLICT, "ID_CONFLICT", "This id is already in use.");
    }
}
