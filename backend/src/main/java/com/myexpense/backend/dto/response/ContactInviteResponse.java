package com.myexpense.backend.dto.response;

import java.time.OffsetDateTime;

/**
 * {@code POST /api/v1/contacts/{id}/invite}'s {@code 200 OK} body
 * (api-overview.md §6.3).
 *
 * <p>Two fields, and both are deliberately all this endpoint returns:
 * <ul>
 *   <li>{@code status} — one of
 *       {@code 'sent' | 'failed' | 'cooldown_active' | 'rate_limited' |
 *       'already_linked'} (see {@code service/InviteOutcome});</li>
 *   <li>{@code nextAllowedAt} — "populated <strong>only</strong> when
 *       {@code status='cooldown_active'} or {@code 'rate_limited'}", and
 *       present-and-{@code null} otherwise, per this API's uniform key-set
 *       convention.</li>
 * </ul>
 *
 * <p><strong>{@code 200}, not {@code 201}, and the status code does not vary
 * with the outcome.</strong> Four of the five outcomes created no row at all;
 * the contract specifies one success code for the whole set, so a client reads
 * {@code status} rather than branching on HTTP. A genuine error — an unknown or
 * other-user contact, or a contact with no phone — is still an error
 * ({@code 404 CONTACT_NOT_FOUND}, {@code 400 NO_PHONE_ON_CONTACT}).
 *
 * <p><strong>No invite count and no invite history.</strong> "How many times was
 * this contact invited" is now {@code COUNT(*)} over {@code contact_id}
 * (ADR 0023 §5.3, replacing the dropped {@code attempt_count}), but no endpoint
 * exposes that number and V9 therefore declines the index that would serve it —
 * it arrives with the first surface that shows it, not here.
 *
 * <p><strong>{@code nextAllowedAt} is an estimate in exactly one case</strong>,
 * recorded so it is a known property: when a concurrent send to the same number
 * is in flight, the cooldown's own start instant is not yet committed anywhere
 * this transaction can read, so the value returned is
 * {@code now + cooldown} — the latest it could possibly be. See
 * {@code ContactInviteService}.
 */
public record ContactInviteResponse(
        String status,
        OffsetDateTime nextAllowedAt) {
}
