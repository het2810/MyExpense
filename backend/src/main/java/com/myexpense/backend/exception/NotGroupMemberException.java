package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 403 on {@code POST}/{@code PATCH /api/v1/transactions} when
 * {@code scope='group'} and the caller is not a member of {@code groupId}
 * (api-overview.md §4.2's error table).
 *
 * <p><strong>The check behind this is real as of 2026-11-03.</strong> It used to
 * fire for <em>every</em> group-scoped write: {@code group_members} did not
 * exist, so the check §4.2 specifies — "is the calling principal a member of
 * this group" — was <em>vacuously false</em> for every input, and answering it
 * with the code the contract already defines was the truthful reading (inventing
 * a {@code NOT_IMPLEMENTED} or a group-shaped {@code 400 VALIDATION_ERROR} would
 * have been inventing a contract — constitution §15/§30). The cost was that a
 * genuine member could not record a group expense, which is the bug the Project
 * Owner reported. {@code V10__groups.sql} is applied, so
 * {@code TransactionService#requireScopeAndGroupAgree} now resolves
 * {@code GroupMemberRepository#existsByGroupIdAndUserId} per request — this
 * class is unchanged, exactly as the plan expected.
 *
 * <p><strong>Why a {@code 403} here is consistent with the {@code 404}-not-
 * {@code 403} convention</strong> (security-architecture.md §2), which forbids a
 * {@code 403} for ownership/membership failures on a <em>specific
 * resource</em>: the resource being addressed on a create is the caller's own
 * new transaction, not the group. {@code groupId} is an <em>input</em> to that
 * write, and §4.2's own error table assigns it {@code 403 NOT_GROUP_MEMBER}
 * explicitly. {@code V10}'s contract item 1 re-confirms the divergence from §7's
 * {@code 404 GROUP_NOT_FOUND} as "the approved contract" — <strong>do not
 * "correct" this to a {@code 404}.</strong>
 *
 * <p><strong>Nor does it leak existence, which is the property the convention
 * actually protects.</strong> A {@code groupId} naming no group at all gets this
 * same {@code 403} with this same message: the membership query returns
 * {@code false} for an absent group and for someone else's group alike, so the
 * service never learns which case it was. §4.2's error table has no
 * {@code GROUP_NOT_FOUND} row, so answering {@code 404} for the unknown-group
 * case would both invent a code and hand a stranger the difference.
 *
 * <p>A group-scoped request <em>without</em> a {@code groupId} never reaches
 * here: that is a plain {@code 400} from
 * {@link TransactionRuleViolationException#groupIdRequiredForGroupScope()},
 * because the contract's rule is "required iff {@code scope='group'}" and the
 * database's {@code chk_transactions_group_id_matches_scope} says the same.
 *
 * <p>Matched by <strong>registered membership only</strong>: a
 * {@code group_members} row whose {@code invited_contact_id} is set is an
 * unregistered placeholder with no account, so it can never be the authenticated
 * caller and is deliberately not matched.
 */
public class NotGroupMemberException extends ApiException {

    public NotGroupMemberException() {
        super(HttpStatus.FORBIDDEN, "NOT_GROUP_MEMBER", "You are not a member of that group.");
    }
}
