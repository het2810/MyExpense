package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 409 WRITE_SUPERSEDED} (ADR 0027 §4.4/§5.2). An LWW update lost, or
 * targeted a row the caller had soft-deleted.
 *
 * <p><strong>Thrown only by controllers, after the service has returned and
 * its transaction has committed</strong> — the superseded {@code change_log}
 * row, activity and {@code sync_conflict} notification must survive the 409
 * (ADR 0027 §4.3). A service must never throw this inside a transaction.
 */
public class WriteSupersededException extends ApiException {

    public WriteSupersededException() {
        super(HttpStatus.CONFLICT, "WRITE_SUPERSEDED",
                "This change was not applied because a newer change was kept.");
    }
}
