package com.myexpense.backend.sync;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import com.myexpense.backend.exception.WriteSupersededException;

/**
 * The committed outcome of one logged write (ADR 0027 §4.3), returned by a
 * service <em>as a value</em> so that a superseded outcome commits its
 * {@code change_log} row, activity and notification before the controller
 * turns it into {@code 409 WRITE_SUPERSEDED}. Throwing inside the transaction
 * would roll those rows back.
 */
public record WriteResult<T>(T body, Outcome outcome) {

    public enum Outcome { CREATED, OK, NO_CONTENT, SUPERSEDED }

    public static <T> WriteResult<T> created(T body) {
        return new WriteResult<>(body, Outcome.CREATED);
    }

    public static <T> WriteResult<T> ok(T body) {
        return new WriteResult<>(body, Outcome.OK);
    }

    public static <T> WriteResult<T> noContent() {
        return new WriteResult<>(null, Outcome.NO_CONTENT);
    }

    public static <T> WriteResult<T> superseded() {
        return new WriteResult<>(null, Outcome.SUPERSEDED);
    }

    public boolean isSuperseded() {
        return outcome == Outcome.SUPERSEDED;
    }

    /**
     * Controller-side mapping. Runs after the service's transaction committed, so
     * the {@link WriteSupersededException} thrown here rolls nothing back.
     */
    public ResponseEntity<T> toResponseEntity() {
        return switch (outcome) {
            case CREATED -> ResponseEntity.status(HttpStatus.CREATED).body(body);
            case OK -> ResponseEntity.ok(body);
            case NO_CONTENT -> ResponseEntity.noContent().build();
            case SUPERSEDED -> throw new WriteSupersededException();
        };
    }
}
