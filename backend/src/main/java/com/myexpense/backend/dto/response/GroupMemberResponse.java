package com.myexpense.backend.dto.response;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * {@code GroupMemberResponse} (api-overview.md §7.4) —
 * {@code POST /api/v1/groups/{id}/members}' {@code 201 Created} body.
 *
 * <p>It describes <strong>the row that was just created</strong>, which is why
 * it carries {@code id} and {@code createdAt} where
 * {@link GroupMemberSummary} (§7.1's nested member entry) carries neither: a
 * create response identifies what it created, while a membership list has
 * nothing that addresses a member by id (§7 has no member DELETE or PATCH).
 *
 * <p>Exactly one of {@code userId}/{@code invitedContactId} is non-null, and
 * <strong>which one is the server's decision, not the request's</strong>:
 * {@code user_id} when the submitted contact's {@code linked_user_id} is
 * populated, {@code invited_contact_id} otherwise (§7.2/§7.4). A client that
 * sent a {@code contactId} and reads back a {@code userId} is seeing auto-link
 * at work, not an error.
 *
 * <p>{@code name} is resolved server-side exactly as in §7.1 — the linked user's
 * {@code firstName + lastName}, else the contact's {@code name} — and
 * {@code role} is always {@code "member"}.
 *
 * <p><strong>No {@code inviteStatus} here, deliberately.</strong> §7.4's shape
 * does not carry one even though it fires the same invite trigger as §6.2
 * ("Same invite-send trigger as §7.2's {@code memberContactIds} applies here for
 * the single added contact"), so the outcome is logged server-side and is
 * observable through {@code POST /contacts/{id}/invite} (§6.3) rather than
 * returned. Adding a field the contract does not define would be inventing one
 * (constitution §15/§30) — flagged in backend/README.md §15 as a real
 * asymmetry with §6.2 rather than silently filled in.
 *
 * <p>No {@code updatedAt}: §7.4's shape stops at {@code createdAt}. A membership
 * row is never updated, so the two would be equal for the life of every row
 * anyway.
 */
public record GroupMemberResponse(
        UUID id,
        UUID userId,
        UUID invitedContactId,
        String name,
        String role,
        OffsetDateTime createdAt) {
}
