package com.myexpense.backend.dto.response;

import java.time.OffsetDateTime;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

/**
 * One {@code change_log} entry (api-overview.md §15.6, ADR 0027 §6.5).
 *
 * <p>{@code changes} is the stored JSON array of
 * {@code {"field","before","after"}} returned as-is: values are already in API
 * form, written server-side. Every key is always present ({@code null} allowed),
 * matching the contract's example.
 */
public record ChangeLogEntryResponse(
        UUID id,
        String entityType,
        UUID entityId,
        String operation,
        String outcome,
        String supersededReason,
        UUID supersededByChangeLogId,
        JsonNode changes,
        String origin,
        UUID deviceId,
        OffsetDateTime clientUpdatedAt,
        OffsetDateTime effectiveWriteAt,
        OffsetDateTime createdAt) {
}
