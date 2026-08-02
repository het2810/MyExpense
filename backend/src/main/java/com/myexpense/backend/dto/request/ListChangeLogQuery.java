package com.myexpense.backend.dto.request;

import java.util.UUID;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Query parameters for {@code GET /api/v1/change-log} (api-overview.md §15.6).
 * Same bound-DTO shape as {@link ListActivitiesQuery}: a malformed uuid or an
 * out-of-range page/size is a {@code BindException}, answered API-wide as
 * {@code 400 VALIDATION_ERROR}. The "both or neither" and known-type rules are
 * cross-field and live in {@code ChangeLogService}.
 */
public class ListChangeLogQuery {

    private static final int MAX_PAGE_SIZE = 100;

    private String entityType;

    private UUID entityId;

    @Min(0)
    private int page = 0;

    @Min(1)
    @Max(MAX_PAGE_SIZE)
    private int size = 20;

    public String getEntityType() {
        return entityType;
    }

    public void setEntityType(String entityType) {
        this.entityType = entityType;
    }

    public UUID getEntityId() {
        return entityId;
    }

    public void setEntityId(UUID entityId) {
        this.entityId = entityId;
    }

    public int getPage() {
        return page;
    }

    public void setPage(int page) {
        this.page = page;
    }

    public int getSize() {
        return size;
    }

    public void setSize(int size) {
        this.size = size;
    }
}
