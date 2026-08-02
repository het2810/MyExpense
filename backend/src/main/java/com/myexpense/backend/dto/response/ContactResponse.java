package com.myexpense.backend.dto.response;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * {@code ContactResponse} (api-overview.md §6.1) — one entry of
 * {@code GET /api/v1/contacts}.
 *
 * <p>Never the {@code Contact} entity (constitution §9): {@code ownerUserId}
 * must not cross the API boundary. Every contact in this response belongs to the
 * caller by construction, so echoing an owner id would only invite a client to
 * start sending one back — the same reasoning
 * {@link TransactionResponse} records for {@code userId}.
 *
 * <p><strong>{@code initials} is returned but never accepted</strong>
 * (§6.2 takes name/phone/email only). It is derived server-side so that every
 * surface renders the same badge for one contact — the frontend's
 * {@code Avatar} component already expects the field, and deriving it per client
 * would let two clients disagree about one row.
 *
 * <p><strong>{@code linkedUserId} is the only thing this response says about
 * linking, deliberately.</strong> §6.2's auto-link never explains <em>why</em> a
 * link did or did not happen (ADR 0015 §7, security-architecture.md §2): the
 * caller learns that this contact is some registered account, which they
 * necessarily already knew the phone or email of. There is no counterpart name,
 * no email echo of the matched account and no "matched by phone/email" field,
 * because each would widen a bounded enumeration surface into a lookup.
 *
 * <p><strong>No {@code inviteStatus} on this type.</strong> §6.1's shape does not
 * carry it — an invite is an event, not a property of the address-book entry, and
 * V9 stores no status on {@code contacts} to read one from.
 * {@link ContactCreatedResponse} is §6.2's shape, which does. Two records rather
 * than one nullable field is what keeps {@code GET /contacts} from gaining a key
 * that would always be {@code null} (constitution §25 — a single duplication is
 * acceptable; a response field that is structurally always null is not).
 */
public record ContactResponse(
        UUID id,
        String name,
        String initials,
        String phone,
        String email,
        UUID linkedUserId,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {
}
