package com.myexpense.backend.sync;

import java.time.OffsetDateTime;

import com.myexpense.backend.entity.ChangeLog;

/**
 * ADR 0027 §5.2's rule as a pure function: row-level, deterministic, ties lose.
 * Called after the row is locked and resolved under the endpoint's owner check.
 */
public final class LastWriteWins {

    private LastWriteWins() {
    }

    /**
     * @return {@code null} when the write applies; otherwise the superseded reason
     *         ({@code deleted} or {@code newer_write})
     */
    public static String supersededReason(boolean rowDeleted, OffsetDateTime lastClientWriteAt,
            OffsetDateTime effectiveWriteAt) {
        if (rowDeleted) {
            return ChangeLog.REASON_DELETED;
        }
        if (lastClientWriteAt != null && !effectiveWriteAt.isAfter(lastClientWriteAt)) {
            return ChangeLog.REASON_NEWER_WRITE;
        }
        return null;
    }
}
