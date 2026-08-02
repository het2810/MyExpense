package com.myexpense.backend.repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.GroupMember;

/**
 * Persistence only (constitution §9) for {@code group_members} —
 * <strong>the authorization table of this whole domain</strong>. Derived queries
 * and JPQL with bound parameters only (security-architecture.md §12).
 *
 * <p>{@link #existsByGroupIdAndUserId} is the hottest and most
 * security-critical query in the backend: every §7 endpoint (and later every §9
 * and §10 endpoint) must call it per request, and its {@code false} answer is a
 * {@code 404}, never a {@code 403} (V10's RULE 1, security-architecture.md §2).
 * It is a unique point lookup on
 * {@code uq_group_members_group_id_user_id}.
 *
 * <p>Nothing here caches membership and nothing here accepts
 * {@code groups.created_by_user_id} as a substitute — the creator is just
 * another member row.
 */
public interface GroupMemberRepository extends JpaRepository<GroupMember, UUID> {

    /**
     * <strong>The membership check.</strong> {@code true} when the caller is a
     * registered member of this group.
     *
     * <p>It is deliberately only about {@code user_id}: a contact-placeholder
     * member has no account and therefore no principal that could be making a
     * request, so "the caller" is always a registered member or nobody.
     *
     * <p>Answers both halves of §7.3's {@code 404 GROUP_NOT_FOUND} at once — a
     * group that does not exist and a group the caller is not in both return
     * {@code false}, so the service needs no second query to tell them apart and
     * cannot accidentally leak which it was.
     */
    boolean existsByGroupIdAndUserId(UUID groupId, UUID userId);

    /**
     * Pre-check for {@code 409 ALREADY_A_MEMBER} on the contact-member branch
     * (api-overview.md §7.4). The unique constraint is the real guarantee; this
     * is the clean error for the sequential case.
     */
    boolean existsByGroupIdAndInvitedContactId(UUID groupId, UUID invitedContactId);

    /**
     * Replay of {@code POST /groups/{id}/members} (ADR 0027 §4.3): the member row
     * the original request created, by whichever of the two unique member keys
     * applies. Called only after the caller's own membership was re-checked.
     */
    java.util.Optional<GroupMember> findByGroupIdAndUserId(UUID groupId, UUID userId);

    java.util.Optional<GroupMember> findByGroupIdAndInvitedContactId(UUID groupId, UUID invitedContactId);

    /**
     * "Which groups am I in" — the entry point for {@code GET /api/v1/groups}
     * (§7.1), returning ids only so the group rows themselves can be fetched in
     * one keyed read.
     *
     * <p>Served by {@code idx_group_members_user_id}, which exists precisely
     * because neither uniqueness constraint can answer this: both lead with
     * {@code group_id}, and a btree cannot be scanned by its second column.
     */
    @Query("select m.groupId from GroupMember m where m.userId = :userId")
    List<UUID> findGroupIdsByUserId(@Param("userId") UUID userId);

    /**
     * Every member row of a batch of groups, in <strong>one</strong> query — the
     * {@code members[]} array of a whole {@code GET /groups} response
     * (constitution §10's no-N+1 rule, restated as V10 contract item 3).
     *
     * <p>Ordered so the creator's own row is not special-cased in the response
     * and the array is stable across requests: {@code created_at} ascending puts
     * the creator first (their row is written first), with {@code id} as the
     * tie-break for rows sharing a timestamp — which every member of a
     * single-statement batch insert does.
     *
     * <p>Served by {@code uq_group_members_group_id_user_id}'s btree, which
     * leads with {@code group_id} and — being non-partial — covers
     * contact-member rows too. That is why V10 creates no separate
     * {@code idx_group_members_group_id}.
     */
    List<GroupMember> findByGroupIdInOrderByCreatedAtAscIdAsc(Collection<UUID> groupIds);

    /** The same read for a single group — {@code GET /groups/{id}} (§7.3). */
    List<GroupMember> findByGroupIdOrderByCreatedAtAscIdAsc(UUID groupId);

    /**
     * How many members this group has — one half of
     * {@code GroupBalanceService}'s "every member has exactly one balance row"
     * check (ADR 0023 §2).
     *
     * <p>A {@code COUNT} rather than the size of a fetched list, deliberately:
     * the check runs on the {@code POST /groups/{id}/members} path too, which
     * never loads the full membership, and a count served by
     * {@code uq_group_members_group_id_user_id}'s leading column is cheaper than
     * a read that exists only to be measured.
     */
    long countByGroupId(UUID groupId);
}
