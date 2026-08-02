package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 400 VALIDATION_ERROR} for the cross-field rules ADR 0027 adds to
 * existing write endpoints (§3.3, §3.5, §5.3, §7.2) and to the change-log read
 * (§6.5) — rules Bean Validation cannot express on its own.
 */
public class WriteRequestValidationException extends ApiException {

    private WriteRequestValidationException(String message) {
        super(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    public static WriteRequestValidationException nilId(String field) {
        return new WriteRequestValidationException(field + " must not be the nil UUID.");
    }

    public static WriteRequestValidationException idAndClientIdDiffer() {
        return new WriteRequestValidationException("id and clientId must be equal when both are sent.");
    }

    public static WriteRequestValidationException versionRequired() {
        return new WriteRequestValidationException(
                "version is required unless the X-Client-Updated-At header is sent.");
    }

    public static WriteRequestValidationException personalTransactionIdNotAllowed() {
        return new WriteRequestValidationException(
                "personalTransactionId is allowed only when addToPersonalExpenses is true.");
    }

    public static WriteRequestValidationException personalTransactionIdEqualsId() {
        return new WriteRequestValidationException("personalTransactionId must differ from id.");
    }

    public static WriteRequestValidationException individualTargetExactlyOne() {
        return new WriteRequestValidationException(
                "Provide exactly one of individualBalanceId or individualCounterpartContactId.");
    }

    public static WriteRequestValidationException changeLogFilterPair() {
        return new WriteRequestValidationException("entityType and entityId must be sent together.");
    }

    public static WriteRequestValidationException unknownEntityType() {
        return new WriteRequestValidationException("entityType is not a known change-log entity type.");
    }
}
