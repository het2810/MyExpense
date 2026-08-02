package com.myexpense.backend.repository;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.ContactInvite;

/**
 * Persistence only (constitution §9) for the invite ledger. Every query is JPQL
 * or native SQL with <strong>bound</strong> parameters — nothing concatenated,
 * nothing built from client input (security-architecture.md §12).
 *
 * <p><strong>Four of the five methods here exist for a rate limit, not for a
 * screen</strong>, which is this table's whole purpose (data-model.md §4.9,
 * ADR 0015 §4). Both limits are plain {@code COUNT(*)} window queries, which is
 * only correct because there is <strong>one row per attempt</strong>
 * (ADR 0023 §5.3) — under the dropped {@code attempt_count} model the per-user
 * cap would have had to {@code sum()} a column instead, and a resend that only
 * bumped a counter would not have counted at all.
 *
 * <p><strong>There is deliberately no "find the invite for this contact"
 * method.</strong> {@code POST /contacts/{id}/invite} inserts a new row per
 * attempt and never updates an existing one, so no write path needs to locate a
 * previous row. V9 also creates no index on {@code contact_id} for that reason.
 *
 * <p>No {@code save}-by-update path either: the only mutation a row receives is
 * the {@code queued} → {@code sent}/{@code failed} advance, which
 * {@code ContactInviteService} performs on the managed entity it just
 * persisted — two statements, which is the only shape
 * {@code chk_contact_invites_sent_at_matches_status} permits.
 */
public interface ContactInviteRepository extends JpaRepository<ContactInvite, UUID> {

    /**
     * The <strong>cross-user per-phone cooldown</strong> check (ADR 0015 §4
     * limit 2): how many invites have actually been <em>sent</em> to this
     * real-world number, by anybody, since {@code since}.
     *
     * <p>Scoped by {@code sent_at}, not {@code created_at}, and that is the
     * right column for this limit specifically: a queued or failed attempt
     * delivered no text to the recipient, so it must not start their cooldown.
     * {@code sent_at IS NOT NULL} is implied by the range predicate and is
     * equivalent to {@code status = 'sent'} by
     * {@code chk_contact_invites_sent_at_matches_status}.
     *
     * <p><strong>Not scoped to the caller, deliberately.</strong> The cooldown
     * protects the <em>recipient</em>, who consented to nothing: the same number
     * entered by five different users must still be one bucket, and nobody may
     * route around it by deleting and re-creating the contact (which is also why
     * {@code phone} is denormalized onto this table). Served by
     * {@code idx_contact_invites_phone_sent_at}.
     */
    @Query("select count(i) from ContactInvite i where i.phone = :phone and i.sentAt >= :since")
    long countSendsToPhoneSince(@Param("phone") String phone, @Param("since") OffsetDateTime since);

    /**
     * When the most recent real send to this number happened, across all
     * callers — the input to {@code nextAllowedAt} on a
     * {@code cooldown_active} response (api-overview.md §6.3).
     *
     * <p>{@code max()} ignores {@code NULL}s, so queued and failed attempts are
     * skipped without needing a predicate for them. Empty when this number has
     * never been successfully texted.
     */
    @Query("select max(i.sentAt) from ContactInvite i where i.phone = :phone")
    Optional<OffsetDateTime> findLatestSendToPhone(@Param("phone") String phone);

    /**
     * The <strong>per-inviting-user daily cap</strong> check (ADR 0015 §4 limit
     * 1): how many invite attempts this user has triggered since
     * {@code since}, across every contact creation, every group write and every
     * explicit resend combined.
     *
     * <p>Scoped by {@code created_at}, not {@code sent_at}, and that is not a
     * copy-paste slip (V9's note at the index): a daily cap must count
     * <strong>attempts, including failures</strong>, or a user whose sends all
     * fail could retry without limit. Served by
     * {@code idx_contact_invites_invited_by_created_at}.
     */
    @Query("select count(i) from ContactInvite i "
            + "where i.invitedByUserId = :userId and i.createdAt >= :since")
    long countAttemptsByUserSince(@Param("userId") UUID userId, @Param("since") OffsetDateTime since);

    /**
     * The oldest attempt still inside the caller's rolling window — the input to
     * {@code nextAllowedAt} on a {@code rate_limited} response: the cap frees up
     * one slot when this attempt ages out of the window.
     */
    @Query("select min(i.createdAt) from ContactInvite i "
            + "where i.invitedByUserId = :userId and i.createdAt >= :since")
    Optional<OffsetDateTime> findOldestAttemptByUserSince(
            @Param("userId") UUID userId, @Param("since") OffsetDateTime since);

    /**
     * Takes a <strong>transaction-scoped PostgreSQL advisory lock</strong> keyed
     * on one phone number, returning {@code false} immediately if another
     * transaction already holds it.
     *
     * <p><strong>Why this exists.</strong> V9 contract item 2 requires both
     * limits to be evaluated inside the same transaction as the insert, "or two
     * concurrent requests both pass a check that was true when each read it" —
     * and being in one transaction does <em>not</em> achieve that on its own:
     * under PostgreSQL's {@code READ COMMITTED}, a {@code COUNT(*)} cannot see a
     * sibling transaction's uncommitted row, and a cooldown has no unique
     * constraint to fall back on (V9 forbids one: two attempts to the same phone
     * are the normal case the limits exist to <em>bound</em>). An advisory lock
     * is the one mechanism that closes that window without a new table and
     * without a constraint the contract rejects.
     *
     * <p><strong>{@code try}, not the blocking form, and that choice is load
     * bearing:</strong> it cannot wait, so it cannot deadlock — which matters
     * because one {@code POST /groups} may invite several numbers in a single
     * transaction, and the blocking form would need all keys acquired in a
     * globally consistent order to stay deadlock-free. A {@code false} here
     * means "someone is mid-send to this very number right now", which for
     * cooldown purposes <em>is</em> {@code cooldown_active}; the service answers
     * exactly that.
     *
     * <p>The lock releases on commit or rollback, with no explicit unlock and no
     * way to leak one. The key is computed in Java
     * ({@code ContactInviteService#phoneLockKey}) rather than with
     * {@code hashtext()} so the mapping is visible, deterministic and not
     * dependent on an undocumented server function.
     *
     * <p>This is the only lock anywhere in Domain 6 sub-steps 1–2. It is
     * <strong>not</strong> a balance lock: {@code group_member_balances} is
     * serialised by relative delta writes instead, and the two mechanisms are
     * deliberately not mixed (V10's CONCURRENCY block).
     */
    @Query(value = "select pg_try_advisory_xact_lock(:lockKey)", nativeQuery = true)
    boolean tryLockPhone(@Param("lockKey") long lockKey);
}
