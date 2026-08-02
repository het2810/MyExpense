package com.myexpense.backend.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Query parameters for {@code GET /api/v1/notifications} (api-overview.md §12.1)
 * — all optional, with the contract's own defaults for {@code page} and
 * {@code size}.
 *
 * <p>A bound DTO for the same reason {@link ListActivitiesQuery} and
 * {@link ListTransactionsQuery} are: Bean Validation reaches query parameters
 * through {@code @ModelAttribute} binding and reports a failure as the API-wide
 * {@code 400 VALIDATION_ERROR} already produced by
 * {@code GlobalExceptionHandler#handleBinding}. <strong>No second mechanism is
 * introduced.</strong>
 *
 * <h2>{@link #read} is a boxed {@link Boolean}, deliberately</h2>
 *
 * <p>Three states have to be distinguishable here and a primitive can only
 * express two: <em>absent</em> (return every notification), {@code false}
 * (unread only) and {@code true} (read only). {@code null} is therefore a real,
 * meaningful value on this DTO — which is the exact opposite of
 * {@code Notification#isRead()}, where the column is {@code NOT NULL} and a box
 * would invite a null write that {@code SQLSTATE 23502} rejects ({@code V13}
 * contract item 5). The two decisions are consistent, not contradictory: one is a
 * filter, the other is a column.
 *
 * <p>Spring binds only {@code "true"}/{@code "false"} (and the usual
 * {@code on}/{@code 1} synonyms) to a {@link Boolean}; anything else is a
 * {@link org.springframework.validation.BindException} and therefore a
 * {@code 400}, never a silently-ignored filter.
 *
 * <h2>The unread badge reads {@code totalElements} from this endpoint</h2>
 *
 * <p>ADR 0012 §4's {@code 1}–{@code 9} / {@code "9+"} badge renders on three
 * screens and <strong>§12 defines no count endpoint</strong> ({@code V13}
 * FLAG 3). The only contract-supported source is this endpoint with
 * {@code read=false}, reading {@code PageResponse.totalElements} and discarding
 * {@code content}. That is correct and it is indexed —
 * {@code idx_notifications_user_id_read} covers both columns — but it ships a
 * page of notification rows the badge throws away. A client that only wants the
 * count should send {@code size=1} to make the waste one row instead of twenty;
 * it cannot send {@code size=0}, which is a {@code 400} by the cap below. The
 * dedicated endpoint is <strong>recommended, not implemented</strong>
 * (backend/README.md §17.8) — inventing {@code GET /notifications/unread-count}
 * here would be inventing API (constitution §15/§30).
 *
 * <h2>Injection hardening (security-architecture.md §12.2)</h2>
 *
 * <p>One typed boolean and two bounded integers, bound as parameters against two
 * fixed derived queries on {@code NotificationRepository}. Nothing a client sends
 * becomes a field name, a table name or a SQL fragment, and <strong>there is no
 * {@code sort} parameter</strong> — the contract defines none, so the ordering is
 * part of the repository method names and cannot be influenced from outside.
 */
public class ListNotificationsQuery {

    /** Same cap, same reason, as {@link ListActivitiesQuery}. */
    private static final int MAX_PAGE_SIZE = 100;

    /**
     * {@code null} means <em>no filter</em>; see the class Javadoc. Served by
     * {@code idx_notifications_user_id_read} for either value and by
     * {@code idx_notifications_user_id_notif_date_time} when absent — the two
     * indexes {@code V13} created for exactly this split.
     */
    private Boolean read;

    @Min(0)
    private int page = 0;

    @Min(1)
    @Max(MAX_PAGE_SIZE)
    private int size = 20;

    public Boolean getRead() {
        return read;
    }

    public void setRead(Boolean read) {
        this.read = read;
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
