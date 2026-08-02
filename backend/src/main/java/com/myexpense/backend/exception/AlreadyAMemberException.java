package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 409 ALREADY_A_MEMBER} — {@code POST /api/v1/groups/{id}/members}
 * (api-overview.md §7.4).
 *
 * <p><strong>Two database constraints map onto this one code</strong>
 * ({@code V10__groups.sql}'s contract item 1, which calls them "the two
 * load-bearing names in this file"), and <em>which</em> one arrives depends on
 * the member's kind rather than on anything the service chooses:
 * <ul>
 *   <li>{@code uq_group_members_group_id_invited_contact_id} — the submitted
 *       contact is already in the group as a placeholder;</li>
 *   <li>{@code uq_group_members_group_id_user_id} — the submitted contact's
 *       {@code linked_user_id} is already a member, because §7.2/§7.4 write
 *       {@code user_id} instead of {@code invited_contact_id} once a contact is
 *       linked. <strong>This is also the constraint hit when a caller adds a
 *       contact that is linked to themselves</strong> (V9's FLAG 1), since the
 *       creator is already a member.</li>
 * </ul>
 * Both mean the same thing to a client, which is why they share one code —
 * exactly as V6's two name indexes both map to
 * {@code CATEGORY_NAME_ALREADY_EXISTS}.
 *
 * <p><strong>The service pre-checks and returns this cleanly; the constraints
 * are the backstop for the concurrent case a pre-check cannot cover</strong>
 * (two members adding the same contact at the same moment, each passing a check
 * taken before the other committed). Both halves are kept on purpose.
 *
 * <p><strong>It is deliberately NOT raised by {@code POST /groups}</strong>
 * (§7.2), whose error table defines no {@code 409}: a duplicate inside one
 * {@code memberContactIds} array is de-duplicated by member key instead, because
 * "these people are in the group" is satisfied either way and inventing an
 * undocumented error for a create-time convenience would be worse than
 * honouring the request. See {@code GroupService#createGroup}.
 */
public class AlreadyAMemberException extends ApiException {

    public AlreadyAMemberException() {
        super(HttpStatus.CONFLICT, "ALREADY_A_MEMBER", "That person is already a member of this group.");
    }
}
