package com.myexpense.backend.sync;

import java.util.UUID;

import com.myexpense.backend.exception.WriteRequestValidationException;

/**
 * ADR 0027 §3.3 step 1 for a client-supplied id: any well-formed UUID except the
 * nil UUID (version 4 is not required). Jackson has already rejected a
 * malformed value as {@code 400}.
 */
public final class ClientIds {

    private ClientIds() {
    }

    /** @return {@code id} unchanged ({@code null} allowed = server-generated). */
    public static UUID requireNotNil(UUID id, String field) {
        if (id != null && id.getMostSignificantBits() == 0L && id.getLeastSignificantBits() == 0L) {
            throw WriteRequestValidationException.nilId(field);
        }
        return id;
    }
}
