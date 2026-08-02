package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 404 GROUP_NOT_FOUND} — api-overview.md §7.3/§7.4.
 *
 * <p><strong>Returned both when the group does not exist and when it exists but
 * the caller is not a member</strong> — identically, never a {@code 403}. This
 * is the membership-gated form of the owner-scoped rule
 * {@link CategoryNotFoundException} documents: a {@code 403} would confirm to a
 * non-member that the group id is real (security-architecture.md §2, ADR 0014
 * §2 Consequence 1). §7.3's own error table says so in those words: "doesn't
 * exist, or the caller isn't a member".
 *
 * <p>The check is "does a {@code group_members} row exist for (groupId,
 * principal)", re-derived per request from
 * {@code GroupMemberRepository#existsByGroupIdAndUserId} — never cached, and
 * never substituted with {@code groups.created_by_user_id}, because the creator
 * is just another member row and a non-creator member must still get in
 * (V10's RULE 1).
 *
 * <p>One query answers both halves, which is the point: the service never learns
 * which of the two conditions held, so it cannot leak the difference by
 * accident.
 *
 * <p>{@code V10__groups.sql} maps {@code fk_group_members_group_id} (23503) onto
 * this same code — reachable only if the group vanished between the membership
 * check and the insert, which no endpoint in this phase can cause (§7 has no
 * DELETE).
 */
public class GroupNotFoundException extends ApiException {

    public GroupNotFoundException() {
        super(HttpStatus.NOT_FOUND, "GROUP_NOT_FOUND", "Group not found.");
    }
}
