package com.myexpense.backend.sync;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * The delivery metadata of one queued write (ADR 0027 §4.1, api-overview.md
 * §15.1), parsed once per request by {@link WriteContextFilter} from four
 * optional headers and handed to controllers through
 * {@link WriteContextArgumentResolver}.
 *
 * <p>These are headers, not body fields, because they describe how a write was
 * delivered rather than the entity it changes, so no domain DTO carries them.
 *
 * <p><strong>Never log {@link #idempotencyKey} or {@link #deviceId} values</strong>
 * (the Backend Engineer's brief, stricter than security-architecture.md §8,
 * which calls them safe). Neither is ever written to an application log here.
 *
 * @param idempotencyKey  {@code Idempotency-Key}; {@code null} = no dedup
 * @param clientUpdatedAt {@code X-Client-Updated-At} exactly as reported, with
 *                        the device's own offset; {@code null} = legacy mode
 * @param origin          {@code X-Client-Origin}: {@code live} (default) or {@code replay}
 * @param deviceId        {@code X-Device-Id}; {@code null} when absent
 */
public record WriteContext(UUID idempotencyKey, OffsetDateTime clientUpdatedAt, String origin, UUID deviceId) {

    /** Request attribute under which the filter stores the parsed context. */
    public static final String REQUEST_ATTRIBUTE = WriteContext.class.getName();

    public static final String ORIGIN_LIVE = "live";
    public static final String ORIGIN_REPLAY = "replay";

    /** A request with none of the four headers: no dedup, legacy mode, origin {@code live}. */
    public static final WriteContext NONE = new WriteContext(null, null, ORIGIN_LIVE, null);

    /**
     * {@code true} when {@code X-Client-Updated-At} was sent. Its presence is what
     * selects LWW mode on the four updatable entities (ADR 0027 §5.3).
     */
    public boolean lwwMode() {
        return clientUpdatedAt != null;
    }

    /**
     * {@code least(X-Client-Updated-At, serverNow)} in UTC (ADR 0027 §5.2). A
     * device clock running ahead cannot win every conflict; a future timestamp
     * means "now". Without the header the server clock is used.
     */
    public OffsetDateTime effectiveWriteAt(OffsetDateTime serverNow) {
        OffsetDateTime now = serverNow.withOffsetSameInstant(ZoneOffset.UTC);
        if (clientUpdatedAt == null || clientUpdatedAt.isAfter(now)) {
            return now;
        }
        return clientUpdatedAt.withOffsetSameInstant(ZoneOffset.UTC);
    }
}
