package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 409 IDEMPOTENCY_KEY_REUSED} (ADR 0027 §4.3/§4.4): a recorded
 * {@code Idempotency-Key} arrived on a different endpoint or entity. Only a
 * client bug produces it; nothing is written.
 */
public class IdempotencyKeyReusedException extends ApiException {

    public IdempotencyKeyReusedException() {
        super(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED",
                "This idempotency key was already used for a different change.");
    }
}
