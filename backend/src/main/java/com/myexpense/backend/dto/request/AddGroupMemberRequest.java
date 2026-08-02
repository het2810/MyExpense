package com.myexpense.backend.dto.request;

import java.util.UUID;

import jakarta.validation.constraints.NotNull;

/**
 * Request body for {@code POST /api/v1/groups/{id}/members}
 * (api-overview.md §7.4).
 *
 * <p>One field. The group comes from the path, the caller from the JWT, and
 * everything else about the resulting member row is derived:
 * <ul>
 *   <li>{@code role} is always {@code 'member'} — there is no {@code 'owner'}
 *       role this phase and no field to request one;</li>
 *   <li><strong>which column the row fills is the server's decision</strong>,
 *       not the client's: {@code user_id} when the contact's
 *       {@code linked_user_id} is populated, {@code invited_contact_id}
 *       otherwise (§7.2/§7.4). A client cannot name a {@code userId} here, which
 *       is what stops a caller adding an arbitrary account to a group.</li>
 * </ul>
 *
 * <p>{@code contactId} is re-resolved <strong>owner-scoped</strong> server-side
 * (security-architecture.md §3): an id that is not one of the caller's own
 * contacts is {@code 400 CONTACT_NOT_FOUND} — a {@code 400} on this endpoint
 * specifically, where §7.2's equivalent is a {@code 404}; see
 * {@link com.myexpense.backend.exception.ContactNotFoundException}.
 *
 * <p>A record with no presence tracking: {@code contactId} is required, so
 * "omitted" and "explicitly null" are both simply invalid and
 * {@link NotNull} answers both as one {@code 400 VALIDATION_ERROR} naming the
 * field.
 */
public record AddGroupMemberRequest(

        /* Contract: "uuid, required — one of the caller's own contacts". */
        @NotNull
        UUID contactId) {
}
