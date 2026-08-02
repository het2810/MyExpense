package com.myexpense.backend.repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.ExpenseGroup;

/**
 * Persistence only (constitution §9) for {@code groups}. Derived queries with
 * bound parameters; no native SQL and nothing concatenated
 * (security-architecture.md §12).
 *
 * <p><strong>Nothing here is owner-scoped, and that is correct rather than an
 * omission.</strong> A group row is legitimately shared by more than one user,
 * so "does {@code created_by_user_id} match the principal" is the
 * <em>wrong</em> authorization test for every endpoint in §7 (V10's RULE 1,
 * ADR 0014 §2). Authorization happens one layer out, in
 * {@link GroupMemberRepository#existsByGroupIdAndUserId}, and
 * {@code GroupService} performs that check before it ever calls a method here —
 * which is exactly why these methods must not grow a {@code createdByUserId}
 * parameter that would look like security but would deny a legitimate member
 * access to their own group.
 *
 * <p>No {@code findById(...)} is declared: {@link JpaRepository} already
 * provides it, and the membership check is what guards it.
 */
public interface GroupRepository extends JpaRepository<ExpenseGroup, UUID> {

    /**
     * The groups behind one {@code GET /api/v1/groups} response (§7.1), fetched
     * in <strong>one</strong> query from the id set
     * {@link GroupMemberRepository#findGroupIdsByUserId} returned.
     *
     * <p>Ordered by name then id: the contract specifies no order, and some
     * total order is required for a stable list (two groups may share a name —
     * V10 declines any uniqueness on {@code groups.name} — so {@code id} is the
     * tie-break). {@code last_activity} would be the natural recency sort but it
     * is free text, not a timestamp, so it cannot be ordered on.
     *
     * <p>Resolved by primary key, so no index on {@code groups} beyond the PK is
     * needed or created.
     */
    List<ExpenseGroup> findByIdInOrderByNameAscIdAsc(Collection<UUID> ids);

    /**
     * <strong>The group mutex</strong> (ADR 0028 §4.5): {@code SELECT ... FOR NO KEY
     * UPDATE} on the {@code groups} row, held until commit. Called <em>first</em>
     * by every group-ledger write — group split create, split edit and delete,
     * and group settlement — so their set-based balance upserts, which lock
     * member rows in an unspecified order, can never interleave and deadlock.
     *
     * <p>{@code FOR NO KEY UPDATE}, not {@code FOR UPDATE}: inserting a row that
     * references {@code groups(id)} (a split expense, a group-scoped transaction)
     * takes {@code FOR KEY SHARE}, which {@code FOR UPDATE} would block and this
     * does not. Native because JPA has no such lock mode. Fixed text, one bound
     * parameter. The locking clause sits in a sub-select so the statement can
     * return a plain count.
     *
     * @return {@code 1} when the row exists and is now locked, {@code 0} otherwise
     */
    @Query(value = """
            select count(*) from (
                select g.id from groups g where g.id = cast(:groupId as uuid) for no key update
            ) locked
            """, nativeQuery = true)
    long lockForLedgerWrite(@Param("groupId") UUID groupId);
}
