package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 409 SETTLEMENT_DIRECTION_CHANGED} (ADR 0027 §7.3): the request's
 * {@code expectedDirection} no longer matches the direction the ledger
 * implies, or the balance is now zero. Decided before any write.
 */
public class SettlementDirectionChangedException extends ApiException {

    public SettlementDirectionChangedException() {
        super(HttpStatus.CONFLICT, "SETTLEMENT_DIRECTION_CHANGED",
                "The balance changed direction since this settlement was recorded.");
    }
}
