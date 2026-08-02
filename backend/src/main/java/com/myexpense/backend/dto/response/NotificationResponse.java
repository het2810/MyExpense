package com.myexpense.backend.dto.response;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * {@code NotificationResponse} (api-overview.md §12.1) — returned by the
 * paginated list (inside a {@link PageResponse}) and by §12.2's mark-one-read,
 * which answers with the same shape and {@code read: true}.
 *
 * <p>Never the {@code Notification} entity, for the usual reason ({@code userId}
 * must not cross the boundary; constitution §9) and for one specific to this
 * table: {@code updatedAt} is <strong>not</strong> in §12.1's field list and is
 * not exposed. It is the sync/last-write-wins column ({@code V13}'s own note on
 * Domain 8), not a display value, and publishing it would make a client's
 * mark-read behaviour depend on a timestamp whose only job is conflict
 * resolution.
 *
 * <h2>Seven fields, and deliberately no entity ids at all</h2>
 *
 * <p>§12.1 specifies exactly {@code id}, {@code type}, {@code message},
 * {@code notifDate}, {@code notifTime}, {@code read} and {@code createdAt}.
 * {@code notifications} carries no {@code related_*} column and no FK except
 * {@code user_id} — the snapshot pattern taken to its limit, not an omission:
 * {@code message} is a complete, frozen sentence, so nothing can dangle and no
 * delete flow can ever make a notification unreadable.
 *
 * <p><strong>The recorded cost ({@code V13} FLAG 3): a notification is NOT
 * NAVIGABLE.</strong> Tapping one cannot open the group or the split expense it
 * describes, because the row does not know which they were. That is a property of
 * the schema, not of this DTO — adding an id field here would have nothing to
 * read it from.
 *
 * <h2>{@code message} already contains its amount and currency symbol</h2>
 *
 * <p>Same rule as {@link ActivityResponse}: this domain stores sentences, not
 * amounts. There is no amount field, no currency field, and the symbol baked into
 * the sentence will not re-render if the user later switches currency.
 */
public record NotificationResponse(
        UUID id,

        /*
         * 'overspending' | 'group_expense' | 'settlement' | 'reminder'
         * (ADR 0012 §3) — extensible, returned verbatim, with no vocabulary
         * CHECK behind it. 'group_expense' is written for BOTH split modes,
         * including a pairwise one, so the name is narrower than the meaning
         * (Notification#TYPE_GROUP_EXPENSE records why it is kept).
         */
        String type,

        /* The full sentence, already rendered. Never blank
         * (chk_notifications_message_not_blank), never composed client-side. */
        String message,

        LocalDate notifDate,

        /*
         * "HH:mm" (api-overview.md §12.1), formatted explicitly in the service —
         * identical decision and identical FLAG 2 caveats as
         * ActivityResponse#activityTime.
         */
        String notifTime,

        /* The one mutable column in this entire domain (§12.2, §12.3). */
        boolean read,

        OffsetDateTime createdAt) {
}
