package com.myexpense.backend.service;

import java.time.OffsetDateTime;

/**
 * What an {@link SmsInviteGateway} reports back about one send.
 *
 * <p>Two states only, and they map exactly onto the two terminal values
 * {@code contact_invites.status} may take after a {@code queued} row exists
 * ({@code 'sent'}/{@code 'failed'}) — which is the point: the gateway's answer
 * and the ledger's vocabulary cannot drift apart.
 *
 * <p><strong>{@link #dispatchedAt()} is the gateway's own timestamp and is
 * non-{@code null} only on a dispatch</strong>, because
 * {@code chk_contact_invites_sent_at_matches_status} enforces
 * {@code (status = 'sent') = (sent_at IS NOT NULL)}. A failed result carrying a
 * timestamp, or a dispatched result without one, would be a row the database
 * refuses — so the two factories make the pairing impossible to get wrong at a
 * call site.
 *
 * @param dispatched   whether the gateway accepted the message for delivery.
 *                     <strong>Not</strong> whether it was delivered or read:
 *                     delivery receipts are not part of this design and no
 *                     column exists for one
 * @param dispatchedAt the gateway's accept time, or {@code null} on failure
 */
public record SmsDispatchResult(boolean dispatched, OffsetDateTime dispatchedAt) {

    /** Accepted for delivery at {@code dispatchedAt} (must not be {@code null}). */
    public static SmsDispatchResult dispatched(OffsetDateTime dispatchedAt) {
        if (dispatchedAt == null) {
            throw new IllegalArgumentException("A dispatched SMS must carry a dispatch timestamp");
        }
        return new SmsDispatchResult(true, dispatchedAt);
    }

    /**
     * Not accepted. {@code sent_at} stays {@code null}, so no cooldown starts
     * for the recipient and the explicit resend endpoint (§6.3) is the recovery
     * path — exactly what ADR 0015 §4's fail-gracefully rule describes.
     */
    public static SmsDispatchResult failed() {
        return new SmsDispatchResult(false, null);
    }
}
