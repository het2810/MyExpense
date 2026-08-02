package com.myexpense.backend.repository;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.IndividualBalance;

/**
 * Persistence only (constitution §9) for {@code individual_balances}.
 *
 * <h2>The serialisation mechanism for this table: RELATIVE DELTAS — the same one
 * {@code group_member_balances} uses</h2>
 *
 * <p>{@code V11} contract item 4 is explicit that both recommended mechanisms
 * work for pairs as well as groups and that one must be picked <em>for both
 * tables, not one each</em>. {@link GroupMemberBalanceRepository} picked relative
 * updates ({@code SET balance = balance + ?}); this repository does the same, and
 * <strong>{@code SELECT ... FOR UPDATE} is deliberately absent here too and must
 * not be added.</strong> A delta removes the read-modify-write cycle rather than
 * guarding it, so the classic lost update ("two near-simultaneous split saves
 * both read the current balance and the second write discards the first") is
 * unrepresentable rather than merely unlikely.
 *
 * <h2>The one thing a delta alone cannot do, and how it is solved here</h2>
 *
 * <p>{@code V12} contract item 3 names the exception precisely: a settlement must
 * bound {@code amount} by the outstanding position, "and a relative delta alone
 * does not [guard that read], because the validation happens before it". Two
 * members settling the same balance can both pass an {@code amount <= outstanding}
 * check against the same pre-read value and together over-settle it, flipping the
 * sign §10.1 forbids.
 *
 * <p><strong>The fix is to move the bound INTO the UPDATE's own
 * {@code WHERE} clause</strong> —
 * {@link #reduceCreditorPositionById}/{@link #reduceDebtorPositionById} below.
 * PostgreSQL evaluates that predicate against the <em>committed</em> row under
 * the row lock the UPDATE itself takes, so a concurrent settlement that got there
 * first simply makes the second statement match zero rows. The service then
 * fails the request and rolls back. This keeps the delta mechanism intact, adds
 * no {@code FOR UPDATE} and no lock of any kind, and makes the pre-read advisory
 * (it chooses the direction and the error message; the predicate is what is
 * authoritative).
 *
 * <h2>Why two of these are native SQL</h2>
 *
 * <p>{@code ON CONFLICT} has no JPQL equivalent, and {@code V11} requires the
 * resolve-or-create to be idempotent on the pair key because two devices can
 * trigger the same pair's first split at once. Both statements are
 * <strong>fixed developer-written text with typed bound parameters</strong> —
 * nothing concatenated, nothing derived from client input
 * (security-architecture.md §12).
 *
 * <p><strong>The {@code ON CONFLICT} clauses REPEAT THE INDEX PREDICATE, and
 * that is not optional.</strong> {@code V11}'s two uniqueness keys are
 * <em>partial</em> unique indexes
 * ({@code uq_individual_balances_user_counterpart_user ... WHERE
 * counterpart_user_id IS NOT NULL} and its contact sibling), and PostgreSQL will
 * not infer a partial index from a bare column list — the statement raises a raw
 * {@code 23505} instead of upserting. <strong>This differs from
 * {@code group_member_balances}</strong>, whose keys are plain {@code UNIQUE}
 * constraints with no predicate to repeat, and {@code V11} flags getting the two
 * backwards by name.
 */
public interface IndividualBalanceRepository extends JpaRepository<IndividualBalance, UUID> {

    /**
     * Resolve-or-create the single canonical row for a <strong>registered
     * pair</strong>, idempotently.
     *
     * <p>{@code userId} must already be the lesser of the two uuids in
     * PostgreSQL's unsigned 16-byte order —
     * {@code IndividualBalanceService#canonicalCompare} does that, and
     * {@code chk_individual_balances_canonical_pair_order} is the backstop, not
     * the implementation (ADR 0023 §1.1, Backend follow-up item 2). A
     * wrongly-ordered call is a {@code 23514} and a logged {@code 500}.
     *
     * <p>Inserted at {@code balance = 0}; the real movement is applied afterwards
     * by {@link #applyDeltaById}, so resolve and move stay two separate, each
     * individually atomic, statements. {@code DO UPDATE SET updated_at} rather
     * than {@code DO NOTHING} on purpose: {@code DO NOTHING} reports zero affected
     * rows, so the caller could not tell "already existed" from "insert
     * suppressed", and the row has genuinely been re-affirmed by a real write —
     * the same choice {@link GroupMemberBalanceRepository} makes.
     *
     * <p>{@code id} is omitted from the column list and supplied by the column's
     * own {@code DEFAULT gen_random_uuid()}, the same departure from this
     * backend's application-assigned-id convention that the group upserts make
     * and for the same reason: an upsert cannot pre-assign an id it may not use.
     * The caller reads the row back with
     * {@link #findRegisteredPair(UUID, UUID)} — two statements, because
     * {@code INSERT ... RETURNING} is not expressible through a Spring Data
     * {@code @Modifying} method.
     *
     * @return {@code 1} always — either the insert or the {@code DO UPDATE}
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into individual_balances (user_id, counterpart_user_id, balance, created_at,
                                             updated_at)
            values (cast(:lesserUserId as uuid), cast(:greaterUserId as uuid), 0,
                    cast(:now as timestamptz), cast(:now as timestamptz))
            on conflict (user_id, counterpart_user_id) where counterpart_user_id is not null
            do update set updated_at = excluded.updated_at
            """, nativeQuery = true)
    int resolveOrCreateRegisteredPair(
            @Param("lesserUserId") UUID lesserUserId,
            @Param("greaterUserId") UUID greaterUserId,
            @Param("now") OffsetDateTime now);

    /**
     * Resolve-or-create the caller's <strong>private contact row</strong>
     * (ADR 0023 §1.3 branch 3). Owner-scoped by construction: {@code user_id} is
     * the owner, and {@code fk_individual_balances_counterpart_contact_id} is a
     * composite same-owner foreign key, so a row referencing a stranger's private
     * contact is unrepresentable rather than merely rejected by a check.
     *
     * <p>A {@code 23503} here means "no such contact, or it is not owned by this
     * row's user" — deliberately indistinguishable, which is the owner-scoped
     * {@code 404} convention. The service still pre-resolves the contact as the
     * caller's own, so a legal request never reaches it.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into individual_balances (user_id, counterpart_contact_id, balance, created_at,
                                             updated_at)
            values (cast(:ownerUserId as uuid), cast(:contactId as uuid), 0,
                    cast(:now as timestamptz), cast(:now as timestamptz))
            on conflict (user_id, counterpart_contact_id) where counterpart_contact_id is not null
            do update set updated_at = excluded.updated_at
            """, nativeQuery = true)
    int resolveOrCreateContactPair(
            @Param("ownerUserId") UUID ownerUserId,
            @Param("contactId") UUID contactId,
            @Param("now") OffsetDateTime now);

    /**
     * <strong>The one {@code SELECT ... FOR UPDATE} on this table</strong>, added
     * by ADR 0028 §4.5 and called only by
     * {@code IndividualBalanceService#lockPairs}, which takes these locks in the
     * canonical pair order. It is a <em>lock-ordering</em> device for split edit
     * and delete (several pair rows moved in one transaction), not a
     * read-modify-write: every movement is still a relative delta, so the
     * mechanism this interface's Javadoc describes is unchanged.
     */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from IndividualBalance b where b.id = :id")
    Optional<IndividualBalance> findForUpdateById(@Param("id") UUID id);

    /** Keyed read of a canonical registered-pair row, after its upsert. */
    Optional<IndividualBalance> findByUserIdAndCounterpartUserId(UUID userId, UUID counterpartUserId);

    /** Keyed read of a private contact row, after its upsert. */
    Optional<IndividualBalance> findByUserIdAndCounterpartContactId(UUID userId, UUID counterpartContactId);

    /**
     * Alias kept for readability at the call site — the canonical pair is always
     * {@code (lesser, greater)}.
     */
    default Optional<IndividualBalance> findRegisteredPair(UUID lesserUserId, UUID greaterUserId) {
        return findByUserIdAndCounterpartUserId(lesserUserId, greaterUserId);
    }

    /**
     * <strong>{@code GET /splits/individuals}' read — BOTH SIDES</strong>
     * (ADR 0023 §1.4, Backend follow-up item 3).
     *
     * <p>Every row where the caller is {@code user_id} <strong>or</strong>
     * {@code counterpart_user_id}, which also picks up the caller's own contact
     * rows (those carry {@code user_id} = owner). <strong>Do NOT narrow this to
     * {@code user_id = :userId}.</strong> That is the exact bug ADR 0023 §1.4
     * fixed — a user could not see a debt someone else recorded against them,
     * which made the shared ledger invisible to one of its two parties — and
     * ADR 0023 singles it out as "the one place a reviewer will not notice an
     * omission, because the endpoint still returns plausible data".
     *
     * <p>PostgreSQL serves the {@code OR} with a BitmapOr over
     * {@code idx_individual_balances_user_id} and
     * {@code idx_individual_balances_counterpart_user_id}, the second of which
     * {@code V11} created <em>specifically</em> for this read. Neither partial
     * unique index can help: both lead with {@code user_id}, and a btree cannot be
     * scanned by its second column.
     *
     * <p>Ordering is this implementation's own choice — §8.1 specifies none, and
     * some total order is required for a stable list. Most recently moved first,
     * with {@code id} as the tie-break, which is what a balances list wants and is
     * deterministic because {@code id} is unique. There is deliberately no
     * {@code sort} parameter anywhere: the {@code ORDER BY} is a literal and
     * cannot be influenced from outside (security-architecture.md §12.2).
     */
    @Query("select b from IndividualBalance b "
            + "where b.userId = :userId or b.counterpartUserId = :userId "
            + "order by b.updatedAt desc, b.id asc")
    List<IndividualBalance> findAllPartyTo(@Param("userId") UUID userId);

    /**
     * Applies a signed delta to one pair row — the {@code POST /split-expenses}
     * movement (§9.1 step 2).
     *
     * <p>Plain JPQL, because a relative update needs no {@code ON CONFLICT}: the
     * row has already been resolved-or-created in the same transaction.
     * {@code updatedAt} is set explicitly because a bulk JPQL update bypasses
     * {@code @UpdateTimestamp} ({@code V7} contract item 2 — the database
     * maintains it nowhere in this schema).
     *
     * <p>No bound is applied here, deliberately: a split expense may legitimately
     * push a pair's balance arbitrarily far in either direction. The bounded
     * variants below are for settlement only.
     *
     * @return the number of rows updated — {@code 1}, or {@code 0} if the row
     *         vanished, which the caller treats as a failure rather than ignoring
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update IndividualBalance b set b.balance = b.balance + :delta, b.updatedAt = :now "
            + "where b.id = :id")
    int applyDeltaById(
            @Param("id") UUID id,
            @Param("delta") BigDecimal delta,
            @Param("now") OffsetDateTime now);

    /**
     * <strong>Settlement, creditor side: reduce a POSITIVE balance toward zero,
     * with the bound in the predicate.</strong>
     *
     * <p>{@code b.balance >= :amount} is the whole of ADR 0017 §4's "rejected,
     * never clamped, never sign-flipped" rule, enforced where it cannot be raced:
     * if a concurrent settlement has already consumed the position, this statement
     * matches no row and the service answers
     * {@code 400 AMOUNT_EXCEEDS_BALANCE} instead of flipping the sign. A
     * full-amount settlement lands on exactly {@code 0} by arithmetic —
     * {@code numeric(12,2)} makes that exact — not by special-casing, and
     * <strong>the residual is never zeroed</strong> ({@code V12} contract item
     * 2(a) calls that the single most likely implementation error).
     *
     * @return {@code 1} on success, {@code 0} when the bound or the sign no longer
     *         holds
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update IndividualBalance b set b.balance = b.balance - :amount, b.updatedAt = :now "
            + "where b.id = :id and b.balance >= :amount")
    int reduceCreditorPositionById(
            @Param("id") UUID id,
            @Param("amount") BigDecimal amount,
            @Param("now") OffsetDateTime now);

    /**
     * <strong>Settlement, debtor side: reduce a NEGATIVE balance toward zero,
     * with the bound in the predicate.</strong>
     *
     * <p>{@code b.balance <= :negatedAmount} is the mirror of the creditor
     * guard: the balance must be at least as negative as the amount being paid,
     * or the settlement would push it past zero into a debt the settlement itself
     * created. The caller passes {@code amount.negate()}; keeping the negation at
     * the call site rather than in the query means the comparison reads exactly as
     * the rule does.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update IndividualBalance b set b.balance = b.balance + :amount, b.updatedAt = :now "
            + "where b.id = :id and b.balance <= :negatedAmount")
    int reduceDebtorPositionById(
            @Param("id") UUID id,
            @Param("amount") BigDecimal amount,
            @Param("negatedAmount") BigDecimal negatedAmount,
            @Param("now") OffsetDateTime now);
}
