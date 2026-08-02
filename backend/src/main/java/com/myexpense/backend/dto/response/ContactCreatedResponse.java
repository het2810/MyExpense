package com.myexpense.backend.dto.response;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * {@code POST /api/v1/contacts}' {@code 201 Created} body
 * (api-overview.md §6.2) — {@link ContactResponse}'s eight fields plus
 * {@code inviteStatus}, exactly as that section's shape shows it.
 *
 * <p><strong>{@code inviteStatus} is present-and-{@code null} rather than
 * omitted</strong> when no invite was applicable, which is the uniform key-set
 * convention this API has used since ADR 0003 §2: a client maps the shape once.
 * That is also why this is a separate record instead of
 * {@link ContactResponse} with a {@code @JsonInclude(NON_NULL)} field — field
 * level omission is what §4.3's single-resource enrichment needs, and it is the
 * opposite of what §6.2 specifies here.
 *
 * <p>{@code inviteStatus} is {@code null} whenever no invite was applicable
 * (§6.2): no {@code phone} was submitted, or the contact auto-linked to a real
 * account. Otherwise it carries the attempt's outcome — see
 * {@code service/InviteOutcome} for the values and
 * {@code ContactInviteService} for which rule produced which.
 *
 * <p><strong>A failed or blocked invite never fails this request</strong>
 * (ADR 0015 §4): the contact is created either way, and the outcome is reported
 * here rather than thrown. "A contact must never fail to be created merely
 * because a downstream SMS provider had a bad moment" — recovery is
 * {@code POST /contacts/{id}/invite} (§6.3).
 *
 * <p>One known contract gap, flagged in backend/README.md §15 rather than
 * resolved here: §6.2's enumeration is
 * {@code 'sent' | 'failed' | 'cooldown_active' | null} and omits
 * {@code 'rate_limited'}, which §6.3's does carry — yet the per-user daily cap
 * can block an invite triggered from this endpoint just as easily. This field is
 * never given a value outside §6.2's four; see
 * {@code ContactInviteService#toCreateResponseStatus} for how the fifth outcome
 * is folded into them and why.
 */
public record ContactCreatedResponse(
        UUID id,
        String name,
        String initials,
        String phone,
        String email,
        UUID linkedUserId,
        String inviteStatus,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {
}
