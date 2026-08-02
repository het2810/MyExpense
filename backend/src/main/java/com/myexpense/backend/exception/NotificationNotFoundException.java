package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 404 NOTIFICATION_NOT_FOUND} on
 * {@code PATCH /api/v1/notifications/{id}/read} (api-overview.md §12.2) — the
 * <strong>only client-facing error either endpoint set in this domain
 * defines</strong>. {@code V13}'s contract block says so in as many words:
 * everything the schema itself can reject is a server-side bug, because every
 * column in both tables is server-composed.
 *
 * <p><strong>Returned identically in two cases</strong>, which is the point:
 *
 * <ol>
 *   <li>the id does not exist at all;</li>
 *   <li>the id exists but belongs to a different user — <strong>never a
 *       {@code 403}</strong>, which would confirm to a non-owner that the id is
 *       real (security-architecture.md §2, api-overview.md's owner-scoped
 *       convention).</li>
 * </ol>
 *
 * <p>There is no third case. A notification is never soft-deleted (there is no
 * {@code deleted_at} column and §12 defines no delete endpoint), so a row the
 * caller owns is always resolvable, and marking an <em>already-read</em>
 * notification read is a {@code 200} rather than this error — it is idempotent,
 * which is why the column needs no optimistic concurrency.
 *
 * <p>Ownership is the <em>whole</em> access control here, and that is unusual
 * enough to state: {@code notifications} is fanned out one row per member, each
 * privately owned, so unlike Domain 6's shared-ledger tables there is no
 * membership question to ask and no row is ever shared between two readers.
 * {@code user_id} is the correct authorization test, not a shortcut for one.
 */
public class NotificationNotFoundException extends ApiException {

    public NotificationNotFoundException() {
        super(HttpStatus.NOT_FOUND, "NOTIFICATION_NOT_FOUND", "Notification not found.");
    }
}
