package com.myexpense.backend.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/**
 * Query parameters of both split feeds (ADR 0028 §7.1): {@code page} (default
 * {@code 0}), {@code size} (default {@code 30}, max {@code 100} — the API's
 * shared page cap) and {@code timeZone} (IANA id, default {@code UTC}).
 *
 * <p>A bound DTO, so a malformed value is the API-wide {@code 400
 * VALIDATION_ERROR} from {@code GlobalExceptionHandler#handleBinding}.
 * {@code timeZone}'s vocabulary is checked by the service against the IANA
 * region ids ({@code SplitFeedService#requireTimeZone}) and is only ever a bound
 * SQL parameter, never concatenated.
 */
public class SplitFeedQuery {

    private static final int MAX_PAGE_SIZE = 100;

    @Min(0)
    private int page = 0;

    @Min(1)
    @Max(MAX_PAGE_SIZE)
    private int size = 30;

    @Size(max = 64)
    private String timeZone = "UTC";

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

    public String getTimeZone() {
        return timeZone;
    }

    public void setTimeZone(String timeZone) {
        this.timeZone = timeZone;
    }
}
