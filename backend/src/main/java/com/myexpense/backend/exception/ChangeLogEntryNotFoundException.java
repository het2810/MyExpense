package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 404 CHANGE_LOG_ENTRY_NOT_FOUND} (api-overview.md §15.7). Unknown and
 * another user's entry are one identical answer, never a 403.
 */
public class ChangeLogEntryNotFoundException extends ApiException {

    public ChangeLogEntryNotFoundException() {
        super(HttpStatus.NOT_FOUND, "CHANGE_LOG_ENTRY_NOT_FOUND", "Change log entry not found.");
    }
}
