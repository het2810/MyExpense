package com.myexpense.backend.repository;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.GroupMemberBalance;

/**
 * Persistence only (constitution §9) for {@code group_member_balances}.
 *
 * <p><strong>The two writes here are the first native SQL in this backend, and
 * the reason is specific rather than preferential:</strong> V10's contract
 * (item 1, under {@code uq_group_member_balances_*}) requires the
 * resolve-or-create to be
 * {@code INSERT ... ON CONFLICT (group_id, user_id) DO UPDATE}, and
 * {@code ON CONFLICT} has no JPQL equivalent. Both statements are
 * <strong>fixed developer-written text with typed bound parameters</strong> —
 * nothing concatenated, nothing derived from client input
 * (security-architecture.md §12).
 *
 * <h2>The serialisation mechanism for this table: RELATIVE DELTAS</h2>
 *
 * <p>V10's CONCURRENCY block offers two options and insists one be picked
 * deliberately and written down. <strong>This repository implements option (b),
 * relative updates ({@code SET balance = balance + ?}), and option (a) — row
 * locks via {@code SELECT ... FOR UPDATE} — is deliberately absent and must not
 * be added.</strong> Reasons, in the order that decided it:
 * <ol>
 *   <li><strong>It removes the read-modify-write cycle entirely</strong>, so the
 *       classic lost update ("two near-simultaneous split saves both read the
 *       current balance, both add their delta to the value they read, the second
 *       write silently discards the first") is not merely guarded against but
 *       unrepresentable. A single UPDATE statement is atomic in PostgreSQL and
 *       the second writer blocks on the row, re-reads it and adds to the
 *       committed value.</li>
 *   <li><strong>It composes with partial settlement</strong> (V12,
 *       ADR 0017 §4): a settlement <em>moves</em> a balance toward zero by an
 *       amount, which is a delta by definition, and ADR 0023 §4 requires both
 *       sides of a group settlement to move by the same amount in one
 *       transaction — two deltas, no reads.</li>
 *   <li><strong>It is the same shape the upsert already needs.</strong> With
 *       {@code DO UPDATE SET balance = ... + excluded.balance}, resolve-or-create
 *       and apply-a-delta are one statement rather than two code paths that must
 *       agree.</li>
 * </ol>
 *
 * <p>The cost, stated rather than glossed: a relative write cannot
 * <em>re-derive</em> a balance from the ledger, which V10 notes is when option
 * (a) would be necessary. Nothing in §6–§10 re-derives — §9.1 applies
 * participant shares and §10.1 applies a settlement amount, both as deltas — and
 * if a future "recompute this group from its ledger rows" pass is ever built, it
 * must change this decision explicitly and in one place, not mix a lock into the
 * existing path.
 *
 * <p>The one lock in Domain 6 sub-steps 1–2 is
 * {@link ContactInviteRepository#tryLockPhone}, which guards the SMS cooldown
 * and never touches this table.
 */
public interface GroupMemberBalanceRepository extends JpaRepository<GroupMemberBalance, UUID> {

    /**
     * Resolve-or-create + apply a delta for every <strong>registered</strong>
     * member of one group, in one statement.
     *
     * <p>Called with {@code delta = 0} by the §7.2/§7.4 write paths, which is
     * how every member acquires the row the zero-sum invariant needs (ADR 0023
     * §2) without any money being invented: a brand-new member's true position
     * is {@code 0.00}. A later split or settlement calls the same statement with
     * a real delta.
     *
     * <p><strong>Driven by a SELECT over {@code group_members} rather than by a
     * list of ids</strong>, which is what keeps it one statement for any number
     * of members (constitution §10's no-N+1 rule, and V13 contract item 2's
     * "one multi-row INSERT per table per event, never one statement per
     * member"). It is also inherently idempotent — re-running it after a member
     * is added tops up the newcomer and leaves everyone else's value untouched
     * when {@code delta} is zero (constitution §14 requires sync writes to be
     * idempotent).
     *
     * <p><strong>Two statements, one per member kind, and they cannot be
     * merged.</strong> An {@code ON CONFLICT} clause names exactly one inference
     * target, and a registered member's row can only collide on
     * {@code (group_id, user_id)} while a contact member's can only collide on
     * {@code (group_id, invited_contact_id)}. A single INSERT over both kinds
     * would leave one of the two collisions unhandled and raise a raw
     * {@code 23505}. The {@code IS NOT NULL} filter is what makes each statement
     * see only the rows its own conflict target applies to — and it is also why
     * a bare column list works at all: V10's two keys are plain {@code UNIQUE}
     * constraints, not partial indexes, so there is no predicate to repeat.
     *
     * <p><strong>{@code id} is omitted from the column list</strong> and supplied
     * by the column's own {@code DEFAULT gen_random_uuid()}. This is the one
     * place in the backend that departs from the application-assigned-id
     * convention ({@link com.myexpense.backend.entity.User},
     * {@link com.myexpense.backend.entity.Category}): a multi-row
     * {@code INSERT ... SELECT} needs a distinct id <em>per generated row</em>,
     * which a single bound parameter cannot express. V9/V10 declare that default
     * on every table precisely as this fallback.
     *
     * <p>{@code created_at}/{@code updated_at} are passed in rather than left to
     * {@code now()}, keeping the application the source of time for this column
     * exactly as the entity-managed rows do (V7 contract item 2). On a conflict,
     * {@code updated_at} is refreshed even when {@code delta} is zero: the row
     * was re-affirmed by a real group write, and {@code updated_at} is what tells
     * a client how fresh a shared number is.
     *
     * @return the number of rows inserted or updated — the caller compares it
     *         against the member count it expects, so a silent partial
     *         application cannot pass unnoticed
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into group_member_balances (group_id, user_id, balance, created_at, updated_at)
            select gm.group_id, gm.user_id, cast(:delta as numeric), cast(:now as timestamptz),
                   cast(:now as timestamptz)
              from group_members gm
             where gm.group_id = :groupId
               and gm.user_id is not null
            on conflict (group_id, user_id)
            do update set balance = group_member_balances.balance + excluded.balance,
                          updated_at = excluded.updated_at
            """, nativeQuery = true)
    int applyDeltaToRegisteredMembers(
            @Param("groupId") UUID groupId,
            @Param("delta") BigDecimal delta,
            @Param("now") OffsetDateTime now);

    /**
     * The mirror image for every <strong>invited-contact</strong> member of one
     * group — the half that only became possible with ADR 0023 §2's reshape, and
     * the whole reason the zero-sum check is meaningful for the first time.
     *
     * <p>See {@link #applyDeltaToRegisteredMembers} for why this is a second
     * statement rather than a branch, and for every other property it shares.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into group_member_balances (group_id, invited_contact_id, balance, created_at,
                                               updated_at)
            select gm.group_id, gm.invited_contact_id, cast(:delta as numeric),
                   cast(:now as timestamptz), cast(:now as timestamptz)
              from group_members gm
             where gm.group_id = :groupId
               and gm.invited_contact_id is not null
            on conflict (group_id, invited_contact_id)
            do update set balance = group_member_balances.balance + excluded.balance,
                          updated_at = excluded.updated_at
            """, nativeQuery = true)
    int applyDeltaToContactMembers(
            @Param("groupId") UUID groupId,
            @Param("delta") BigDecimal delta,
            @Param("now") OffsetDateTime now);

    /**
     * The <strong>zero-sum reconciliation query</strong> (V10's CONCURRENCY
     * block, check 1; ADR 0023 Backend follow-up item 8).
     *
     * <p>Across one group, members' balances must sum to zero: every amount owed
     * by someone is owed to someone. A non-zero sum means a lost update, a
     * missed member, or a settlement applied to one side only.
     *
     * <p>Empty when the group has no balance rows at all — which is a different
     * statement from "they sum to zero" and is why this returns an
     * {@link Optional} rather than a {@code coalesce}d zero: the caller can tell
     * "nothing to check" from "checked, and it is zero".
     *
     * <p>Reads every row of one group, i.e. {@code WHERE group_id = ?}, which
     * {@code uq_group_member_balances_group_id_user_id} serves <em>only</em>
     * because V10 made it a plain non-partial {@code UNIQUE} rather than the two
     * partial indexes ADR 0023 §2 specified. Under the partial form this read
     * would have had no index at all.
     */
    @Query("select sum(b.balance) from GroupMemberBalance b where b.groupId = :groupId")
    Optional<BigDecimal> sumBalancesForGroup(@Param("groupId") UUID groupId);

    /**
     * {@code GroupResponse.yourBalance} for one group (§7.3) — the requesting
     * principal's own row, which is what makes the number viewer-relative as it
     * must be.
     *
     * <p>A unique point lookup on
     * {@code uq_group_member_balances_group_id_user_id}.
     */
    Optional<GroupMemberBalance> findByGroupIdAndUserId(UUID groupId, UUID userId);

    /**
     * The same read for a whole page of groups in <strong>one</strong> query —
     * {@code GET /groups} (§7.1) must not issue a balance query per group
     * (constitution §10).
     */
    List<GroupMemberBalance> findByGroupIdInAndUserId(Collection<UUID> groupIds, UUID userId);

    /**
     * How many balance rows this group has — the other half of
     * {@code GroupBalanceService}'s "every member has exactly one balance row"
     * check.
     *
     * <p>That check exists because <strong>the zero-sum query cannot catch a
     * missing row while every balance is zero</strong>: a sum over fewer rows is
     * still {@code 0}. Counting is what detects an upsert that skipped a member
     * kind, which is exactly the class of bug ADR 0023 §2's reshape made
     * possible to detect.
     */
    long countByGroupId(UUID groupId);

    /**
     * One <strong>invited-contact</strong> member's balance row — the half
     * {@link #findByGroupIdAndUserId} cannot answer, needed because ADR 0023 §4
     * permits an unregistered member as a settlement counterpart (Open Question 2:
     * refusing that is one validation rule away, but it would create balances that
     * can never be cleared).
     *
     * <p>A unique point lookup on
     * {@code uq_group_member_balances_group_id_invited_contact_id}.
     */
    Optional<GroupMemberBalance> findByGroupIdAndInvitedContactId(UUID groupId, UUID invitedContactId);

    /**
     * <strong>§9.1 step 2, half one: every registered participant's share, as a
     * negative delta, in ONE statement.</strong>
     *
     * <p>Driven by a {@code SELECT} over the {@code split_expense_participants}
     * rows this transaction has just inserted — the same {@code INSERT ... SELECT}
     * shape {@link #applyDeltaToRegisteredMembers} uses, for the same reason: it
     * is one statement for any number of participants (constitution §10). A
     * participant consumes their share, so their position moves <em>down</em> by
     * it; the payers' {@code + amount_paid} credits (half two,
     * {@link #applyPayerCreditsForRegisteredMembers}, ADR 0025 §4.1) are what make
     * the group still sum to zero afterwards.
     *
     * <p><strong>The {@code ON CONFLICT} column list is bare, and that is correct
     * HERE and would be wrong on {@code individual_balances}.</strong> {@code V10}'s
     * two keys are plain {@code UNIQUE} <em>constraints</em>, so there is no index
     * predicate to repeat; {@code V11}'s are <em>partial</em> unique indexes, whose
     * predicate must be restated or the statement raises a raw {@code 23505}.
     * {@code V11} flags getting these two backwards by name.
     *
     * <p>{@code uq_split_expense_participants_expense_revision_user} (V19)
     * guarantees no participant appears twice in one split <em>revision</em>,
     * which is what keeps this statement safe: an {@code ON CONFLICT DO UPDATE}
     * that saw the same conflict key twice in one statement would abort with
     * "cannot affect row a second time". <strong>That is why the
     * {@code p.revision = :revision} predicate is mandatory</strong> (ADR 0028
     * §3.3): without it an edited split's rows of every revision would be
     * applied at once.
     *
     * <p><strong>Revision and sign (ADR 0028 §4.2).</strong> {@code :revision}
     * selects the rows of one revision; {@code :sign} is {@code +1} to apply
     * that revision's effect and {@code -1} to reverse it. Create = apply(1, +1);
     * edit = apply(r, -1) then apply(r + 1, +1); delete = apply(r, -1). One
     * statement serves all three (constitution §17).
     *
     * @return the number of balance rows inserted or updated — compared by the
     *         caller against the registered-participant count of that revision
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into group_member_balances (group_id, user_id, balance, created_at, updated_at)
            select cast(:groupId as uuid), p.participant_user_id, -(cast(:sign as integer) * p.amount),
                   cast(:now as timestamptz), cast(:now as timestamptz)
              from split_expense_participants p
             where p.split_expense_id = cast(:splitExpenseId as uuid)
               and p.revision = cast(:revision as integer)
               and p.participant_user_id is not null
            on conflict (group_id, user_id)
            do update set balance = group_member_balances.balance + excluded.balance,
                          updated_at = excluded.updated_at
            """, nativeQuery = true)
    int applyParticipantSharesForRegisteredMembers(
            @Param("groupId") UUID groupId,
            @Param("splitExpenseId") UUID splitExpenseId,
            @Param("revision") int revision,
            @Param("sign") int sign,
            @Param("now") OffsetDateTime now);

    /**
     * The mirror image for every <strong>invited-contact</strong> participant —
     * the half that only became possible with ADR 0023 §2's reshape, and without
     * which a group containing an unregistered member could not sum to zero after
     * a split. See {@link #applyParticipantSharesForRegisteredMembers} for every
     * property it shares.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into group_member_balances (group_id, invited_contact_id, balance, created_at,
                                               updated_at)
            select cast(:groupId as uuid), p.participant_contact_id, -(cast(:sign as integer) * p.amount),
                   cast(:now as timestamptz), cast(:now as timestamptz)
              from split_expense_participants p
             where p.split_expense_id = cast(:splitExpenseId as uuid)
               and p.revision = cast(:revision as integer)
               and p.participant_contact_id is not null
            on conflict (group_id, invited_contact_id)
            do update set balance = group_member_balances.balance + excluded.balance,
                          updated_at = excluded.updated_at
            """, nativeQuery = true)
    int applyParticipantSharesForContactMembers(
            @Param("groupId") UUID groupId,
            @Param("splitExpenseId") UUID splitExpenseId,
            @Param("revision") int revision,
            @Param("sign") int sign,
            @Param("now") OffsetDateTime now);

    /**
     * <strong>§9.1 step 2, half two: every registered payer's credit, as a
     * positive delta, in ONE statement</strong> (ADR 0025 §4.1).
     *
     * <p>Replaces the single-payer {@code + amount} credit removed on 2026-11-06.
     * Driven by a {@code SELECT} over the {@code split_expense_payers} rows this
     * transaction has just inserted, each credited with its own
     * {@code amount_paid}. Combined with the participant debits, every member's
     * row moves by {@code net = paid − share}, and the group still sums to zero
     * because both sums equal {@code amount}.
     *
     * <p><strong>A separate statement from the participant debits</strong>, for
     * the reason that has not changed: a payer is usually also a participant, and
     * one statement covering both would hit the same conflict key twice and abort
     * with "ON CONFLICT DO UPDATE command cannot affect row a second time".
     * {@code uq_split_expense_payers_expense_revision_user} (V19) guarantees no
     * payer appears twice in one split <em>revision</em>, which is what keeps
     * <em>this</em> statement safe — and why the revision predicate is
     * mandatory (ADR 0028 §3.3). {@code :revision}/{@code :sign} as in
     * {@link #applyParticipantSharesForRegisteredMembers}.
     *
     * <p>Fixed text with typed bound parameters only (security-architecture.md
     * §12).
     *
     * @return the number of balance rows inserted or updated — compared by the
     *         caller against the registered-payer count of that revision
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into group_member_balances (group_id, user_id, balance, created_at, updated_at)
            select cast(:groupId as uuid), p.payer_user_id, cast(:sign as integer) * p.amount_paid,
                   cast(:now as timestamptz), cast(:now as timestamptz)
              from split_expense_payers p
             where p.split_expense_id = cast(:splitExpenseId as uuid)
               and p.revision = cast(:revision as integer)
               and p.payer_user_id is not null
            on conflict (group_id, user_id)
            do update set balance = group_member_balances.balance + excluded.balance,
                          updated_at = excluded.updated_at
            """, nativeQuery = true)
    int applyPayerCreditsForRegisteredMembers(
            @Param("groupId") UUID groupId,
            @Param("splitExpenseId") UUID splitExpenseId,
            @Param("revision") int revision,
            @Param("sign") int sign,
            @Param("now") OffsetDateTime now);

    /**
     * The mirror image for every <strong>invited-contact</strong> payer
     * (ADR 0025 §4.1). See {@link #applyPayerCreditsForRegisteredMembers} for
     * every property it shares;
     * {@code uq_split_expense_payers_expense_revision_contact} is the uniqueness
     * guarantee here.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into group_member_balances (group_id, invited_contact_id, balance, created_at,
                                               updated_at)
            select cast(:groupId as uuid), p.payer_contact_id, cast(:sign as integer) * p.amount_paid,
                   cast(:now as timestamptz), cast(:now as timestamptz)
              from split_expense_payers p
             where p.split_expense_id = cast(:splitExpenseId as uuid)
               and p.revision = cast(:revision as integer)
               and p.payer_contact_id is not null
            on conflict (group_id, invited_contact_id)
            do update set balance = group_member_balances.balance + excluded.balance,
                          updated_at = excluded.updated_at
            """, nativeQuery = true)
    int applyPayerCreditsForContactMembers(
            @Param("groupId") UUID groupId,
            @Param("splitExpenseId") UUID splitExpenseId,
            @Param("revision") int revision,
            @Param("sign") int sign,
            @Param("now") OffsetDateTime now);

    /**
     * Every balance row of a batch of groups, in <strong>one</strong> query —
     * {@code GroupResponse.members[].balance} (ADR 0028 §8.1). Served by the two
     * uniques' btrees, which lead with {@code group_id}.
     */
    List<GroupMemberBalance> findByGroupIdIn(Collection<UUID> groupIds);

    /**
     * <strong>Settlement, creditor side: reduce a POSITIVE balance toward zero,
     * with the bound in the predicate.</strong>
     *
     * <p>{@code V12} contract item 3 is the reason this method exists in this
     * shape: "whichever mechanism was chosen there ... MUST also guard the read
     * that validates the amount — a relative delta alone does not, because the
     * validation happens before it. This is the one place in the domain where the
     * lock must cover a READ as well as a write."
     *
     * <p><strong>The answer taken here is to put the bound inside the UPDATE's own
     * {@code WHERE} clause instead of taking a lock.</strong> PostgreSQL evaluates
     * {@code b.balance >= :amount} against the <em>committed</em> row under the row
     * lock the UPDATE already takes, so two concurrent settlements cannot both
     * pass it: the second blocks, re-reads, and matches zero rows. The service's
     * earlier read is therefore advisory — it derives the direction and chooses
     * the error — and this predicate is authoritative. That keeps
     * {@code SELECT ... FOR UPDATE} out of this table, which {@code V10}'s
     * CONCURRENCY block and backend/README.md §15.5 both require, and keeps the
     * relative-delta mechanism unmixed.
     *
     * <p>The residual is reduced, <strong>never zeroed</strong> ({@code V12}
     * contract item 2(a)): a full-amount settlement lands on exactly {@code 0} by
     * arithmetic, because {@code numeric(12,2)} is exact.
     *
     * @return {@code 1} on success, {@code 0} when the bound or the sign no longer
     *         holds — which the caller turns into a rejection and a rollback,
     *         never into a clamp
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update GroupMemberBalance b set b.balance = b.balance - :amount, b.updatedAt = :now "
            + "where b.id = :id and b.balance >= :amount")
    int reduceCreditorPositionById(
            @Param("id") UUID id,
            @Param("amount") BigDecimal amount,
            @Param("now") OffsetDateTime now);

    /**
     * <strong>Settlement, debtor side: reduce a NEGATIVE balance toward zero, with
     * the bound in the predicate.</strong>
     *
     * <p>{@code b.balance <= :negatedAmount} is the mirror of the creditor guard:
     * the balance must be at least as negative as the amount being paid, or the
     * settlement would push it past zero into a debt the settlement itself
     * created (ADR 0023 §4, bullet 3). The caller passes {@code amount.negate()},
     * so the comparison reads exactly as the rule does.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update GroupMemberBalance b set b.balance = b.balance + :amount, b.updatedAt = :now "
            + "where b.id = :id and b.balance <= :negatedAmount")
    int reduceDebtorPositionById(
            @Param("id") UUID id,
            @Param("amount") BigDecimal amount,
            @Param("negatedAmount") BigDecimal negatedAmount,
            @Param("now") OffsetDateTime now);
}
