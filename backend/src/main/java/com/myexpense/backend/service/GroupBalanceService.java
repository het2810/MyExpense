package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.entity.GroupMemberBalance;
import com.myexpense.backend.exception.AmountExceedsBalanceException;
import com.myexpense.backend.repository.GroupMemberBalanceRepository;
import com.myexpense.backend.repository.GroupMemberRepository;

/**
 * The only writer of {@code group_member_balances}, and the home of this
 * domain's two reconciliation checks (V10's CONCURRENCY block, ADR 0023 Backend
 * follow-up item 8).
 *
 * <h2>The serialisation mechanism, chosen deliberately: RELATIVE DELTAS</h2>
 *
 * <p>V10's CONCURRENCY block presents two options for serialising concurrent
 * balance writes and insists one be picked deliberately and written down rather
 * than "left to whichever JPA idiom is nearest":
 * <ul>
 *   <li>(a) row locks — {@code SELECT ... FROM group_member_balances WHERE
 *       group_id = ? FOR UPDATE} over the affected rows at the start of the
 *       transaction;</li>
 *   <li>(b) relative deltas — {@code SET balance = balance + ?}, atomic per
 *       statement, which makes the read-modify-write cycle disappear.</li>
 * </ul>
 *
 * <p><strong>This implementation uses (b), exclusively.</strong> Option (a) is
 * deliberately absent from this class and from
 * {@link GroupMemberBalanceRepository}, and the two must not be mixed. The full
 * argument is recorded on that repository; in short: a delta removes the lost
 * update rather than guarding against it, it is the shape partial settlement
 * already needs (ADR 0023 §4 moves both sides of a group settlement by the same
 * amount), and it is the same expression the mandated
 * {@code ON CONFLICT ... DO UPDATE} upsert uses — so resolve-or-create and
 * apply-a-delta are one statement instead of two code paths that must agree.
 * The accepted cost is that a balance cannot be <em>re-derived</em> from the
 * ledger, which is when V10 says (a) would be necessary; nothing in §6–§10
 * re-derives.
 *
 * <h2>Why §6/§7 write this table at all</h2>
 *
 * <p>Neither §7.2 nor §7.4 mentions a balance, so this is a derived decision and
 * is flagged as one in backend/README.md §15. It follows from ADR 0023 §2: the
 * zero-sum invariant "is only checkable if <em>every</em> member's share has a
 * row", and the reshape exists precisely so an unregistered member can hold one.
 * A row at {@code 0.00} is not fabricated money — it is the true position of a
 * member who has participated in nothing — and it makes
 * {@code GroupResponse.yourBalance} a real read of a real row rather than a
 * {@code coalesce} that would hide a genuinely missing one. (V10's "seeding a
 * balance would be fabricated money" is about the <em>migration</em> inserting
 * rows for groups that do not exist; it does not speak to a service creating a
 * member's own zero row as that member joins.)
 *
 * <h2>Two detectors, because they catch different bugs</h2>
 *
 * <p>{@link #assertGroupBalancesConsistent} runs both, in the same transaction
 * as the write, and that pairing is the point: <strong>zero-sum alone cannot
 * catch a missed member in this sub-step</strong>, because every balance here is
 * {@code 0.00} and a sum over fewer rows is still zero. The row-count check is
 * what catches that; the sum is what catches a lost update once V11/V12 move
 * real money. Both are cheap {@code COUNT}/{@code SUM} queries over one group.
 *
 * <h2>Added in sub-steps 3 and 4: the two writes that actually move money</h2>
 *
 * <p>{@link #moveSplitRevision} (§9.1 step 2, ADR 0028 §4.2) and {@link #applySettlement}
 * (§10.1 steps 2–3) are the first code in this backend that changes a balance away
 * from zero. <strong>Both call {@link #assertGroupBalancesConsistent} themselves,
 * at the end, inside the same transaction</strong> — invoked here rather than left
 * to their callers so the rule cannot be forgotten at a call site. This is where
 * the zero-sum half of that assertion becomes a live detector for the first time,
 * and it is also where {@code SELECT ... FOR UPDATE} would have been the obvious
 * wrong turn: the settlement's bound lives in each UPDATE's own {@code WHERE}
 * clause instead, so the relative-delta mechanism stays unmixed. See
 * {@link GroupMemberBalanceRepository} for that argument in full.
 */
@Service
public class GroupBalanceService {

    private static final Logger log = LoggerFactory.getLogger(GroupBalanceService.class);

    /**
     * The delta a membership write applies: none. A new member's position is
     * genuinely {@code 0.00} — see the class Javadoc.
     */
    private static final BigDecimal NO_DELTA = BigDecimal.ZERO;

    private final GroupMemberBalanceRepository balanceRepository;
    private final GroupMemberRepository memberRepository;
    private final boolean assertionsEnabled;

    public GroupBalanceService(
            GroupMemberBalanceRepository balanceRepository,
            GroupMemberRepository memberRepository,
            /*
             * ADR 0023 Backend follow-up item 8 asks for the zero-sum assertion
             * "in the same transaction during development". It defaults to ON
             * rather than OFF (constitution §29 — correctness before
             * performance): the checks are two indexed aggregates over one
             * group, and a violation means a financial row is already wrong, so
             * failing the request and rolling back is better than committing a
             * ledger nobody can trust. The flag exists so it can be turned off
             * deliberately, with a measurement, if it ever shows up in a
             * profile — not so it quietly defaults to off in production.
             */
            @Value("${app.groups.assert-balance-consistency:true}") boolean assertionsEnabled) {
        this.balanceRepository = balanceRepository;
        this.memberRepository = memberRepository;
        this.assertionsEnabled = assertionsEnabled;
    }

    /**
     * Resolve-or-create a {@code 0.00} balance row for every member of this
     * group — both member kinds — idempotently.
     *
     * <p>Two statements regardless of how many members the group has (one per
     * member kind, because an {@code ON CONFLICT} clause names exactly one
     * inference target), driven by a {@code SELECT} over {@code group_members}
     * rather than by a list of ids. Re-running it is a no-op for members who
     * already have a row, which is what makes it safe to call from both
     * {@code POST /groups} and {@code POST /groups/{id}/members} and what
     * constitution §14 requires of a write that may be replayed by sync.
     *
     * <p>Must be called <strong>after</strong> the {@code group_members} rows are
     * flushed — the statements read them. {@code @Modifying(flushAutomatically =
     * true)} on the repository methods guarantees that even if a caller forgets.
     *
     * @return the number of balance rows inserted or refreshed, which equals the
     *         group's member count
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public int resolveOrCreateMemberBalances(UUID groupId) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        int registered = balanceRepository.applyDeltaToRegisteredMembers(groupId, NO_DELTA, now);
        int contacts = balanceRepository.applyDeltaToContactMembers(groupId, NO_DELTA, now);
        return registered + contacts;
    }

    /**
     * The two reconciliation checks, run inside the same transaction as the write
     * that caused them.
     *
     * <p><strong>Check 1 — every member has exactly one balance row.</strong>
     * The member count and the balance-row count must be equal. Fewer balance
     * rows means the upsert missed a member kind (the failure mode ADR 0023 §2's
     * reshape exists to make detectable at all); more means a duplicate, which
     * the two uniqueness constraints should have made impossible.
     *
     * <p><strong>Check 2 — the group's balances sum to exactly zero.</strong>
     * Every amount owed by someone is owed to someone. A non-zero sum means a
     * lost update, a missed member, or a settlement applied to one side only.
     * This is "meaningful for the first time" after the reshape (V10's
     * CONCURRENCY block): before it, an unregistered member's share had no row,
     * so the sum legitimately failed to be zero and a real bug was
     * indistinguishable from a legal state.
     *
     * <p><strong>A violation throws, which rolls the whole write back — and that
     * is the intended outcome, not a trap to suppress.</strong> It is the one
     * place in this domain where a {@code noRollbackFor} would be actively
     * wrong: committing a group whose balances do not reconcile is strictly worse
     * than failing the request. The caller therefore does nothing to catch it,
     * and {@code GlobalExceptionHandler} answers {@code 500 INTERNAL_ERROR} with
     * a logged stack trace — honest, because an unreconciled ledger is a server
     * bug and not something the client did.
     *
     * <p>A {@code sum()} is logged on failure. That is a money figure, which
     * constitution §23 otherwise keeps out of logs — justified here because a
     * non-zero net is a bug signature rather than any user's position, it is the
     * only datum that makes the failure diagnosable, and no per-member balance is
     * logged with it.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void assertGroupBalancesConsistent(UUID groupId) {
        if (!assertionsEnabled) {
            return;
        }

        long memberCount = memberRepository.countByGroupId(groupId);
        long balanceCount = balanceRepository.countByGroupId(groupId);
        if (memberCount != balanceCount) {
            log.error("Balance row count does not match membership for group {}: {} members, {} balance rows",
                    groupId, memberCount, balanceCount);
            throw new IllegalStateException(
                    "Group " + groupId + " has " + memberCount + " members but " + balanceCount
                            + " balance rows");
        }

        BigDecimal net = balanceRepository.sumBalancesForGroup(groupId).orElse(null);
        if (net == null) {
            // No balance rows at all. Only reachable for a group with no
            // members, which no write path can produce (the creator is always a
            // member), so there is nothing to check rather than something wrong.
            return;
        }
        if (net.signum() != 0) {
            log.error("ZERO-SUM INVARIANT VIOLATED for group {}: balances net to {} instead of 0", groupId, net);
            throw new IllegalStateException(
                    "Group " + groupId + " balances net to " + net + " instead of 0");
        }
    }

    // =====================================================================
    // §9.1 step 2 — a split expense's balance impact
    // =====================================================================

    /**
     * <strong>Applies (or reverses) one revision of a group split expense's whole
     * balance impact</strong> (api-overview.md §9.1 step 2, ADR 0028 §4.2). The
     * caller asserts reconciliation afterwards — see the last paragraph.
     *
     * <p>The arithmetic, stated once because it is the reason the group still sums
     * to zero: every participant's position moves <strong>down</strong> by their
     * own share (they consumed it), and each payer's moves <strong>up</strong> by
     * what they paid (they fronted it). Those movements cancel exactly, because
     * the participant shares and the payer amounts each sum to {@code amount} —
     * the two rules {@code SplitExpenseService} re-validates before calling this.
     *
     * <p><strong>At most four statements, independent of how many participants
     * or payers there are.</strong> Two {@code INSERT ... SELECT}s over the
     * {@code split_expense_participants} rows just written (one per participant
     * kind, because an {@code ON CONFLICT} clause names exactly one inference
     * target), plus two over the {@code split_expense_payers} rows. The payer
     * credits are separate statements on purpose: <strong>a payer is usually also
     * a participant</strong>, and a
     * single statement covering both would hit the same conflict key twice and
     * abort with "ON CONFLICT DO UPDATE command cannot affect row a second time".
     *
     * <p>Each statement's affected-row count is compared against what the caller
     * expects, so a silent partial application cannot pass unnoticed — the same
     * discipline {@link #resolveOrCreateMemberBalances}'s caller applies.
     *
     * <p><strong>The assertion, in this same transaction</strong>, is now run by
     * {@code SplitLedgerService} — the single entry point for every split ledger
     * write — so "after every group write the group's balances must sum to zero"
     * (ADR 0023 Backend follow-up item 8) still cannot be forgotten at a call
     * site, while an edit can reverse and re-apply before checking.
     *
     * <p><strong>Multiple payers (ADR 0025 §4.1, 2026-11-06).</strong> The single
     * payer {@code + amount} credit is replaced by two set-based payer-credit
     * statements over the {@code split_expense_payers} rows just written, one per
     * payer kind, each crediting {@code + amount_paid}. Each member therefore moves
     * by {@code net = paid − share}, and the group still sums to zero because both
     * the payer amounts and the participant shares sum exactly to {@code amount}.
     * A single-payer split is one payer row carrying the whole amount, so its
     * result is unchanged. Statements with an expected count of {@code 0} are
     * skipped, as the participant statements already were.
     *
     * <p><strong>Generalised by ADR 0028 §4.2 (2026-11-12)</strong> with a
     * {@code revision} and a {@code sign}: {@code +1} applies that revision's
     * effect, {@code -1} reverses it. This method does <em>not</em> assert —
     * an edit runs it twice (reverse {@code r}, apply {@code r + 1}) and the
     * group only reconciles after both, so {@code SplitLedgerService} calls
     * {@link #assertGroupBalancesConsistent} once at the end of every
     * group-ledger write, inside the same transaction.
     *
     * @param counts how many registered/contact participant and payer rows the
     *               revision holds — each statement's row count must match
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void moveSplitRevision(
            UUID groupId, UUID splitExpenseId, int revision, int sign, RevisionRowCounts counts) {
        if (sign != 1 && sign != -1) {
            throw new IllegalArgumentException("sign must be +1 or -1");
        }
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

        if (counts.registeredParticipants() > 0) {
            int moved = balanceRepository.applyParticipantSharesForRegisteredMembers(
                    groupId, splitExpenseId, revision, sign, now);
            requireExactly(counts.registeredParticipants(), moved, "registered participant shares");
        }
        if (counts.contactParticipants() > 0) {
            int moved = balanceRepository.applyParticipantSharesForContactMembers(
                    groupId, splitExpenseId, revision, sign, now);
            requireExactly(counts.contactParticipants(), moved, "contact participant shares");
        }

        if (counts.registeredPayers() > 0) {
            int moved = balanceRepository.applyPayerCreditsForRegisteredMembers(
                    groupId, splitExpenseId, revision, sign, now);
            requireExactly(counts.registeredPayers(), moved, "registered payer credits");
        }
        if (counts.contactPayers() > 0) {
            int moved = balanceRepository.applyPayerCreditsForContactMembers(
                    groupId, splitExpenseId, revision, sign, now);
            requireExactly(counts.contactPayers(), moved, "contact payer credits");
        }
    }

    /** Row counts of one split revision, by identity kind — what each statement must move. */
    public record RevisionRowCounts(
            int registeredParticipants, int contactParticipants, int registeredPayers, int contactPayers) {
    }

    // =====================================================================
    // §10.1 — a settlement's balance impact
    // =====================================================================

    /**
     * One member's balance row, or empty.
     *
     * <p>Exposed so {@code SettlementService} reads balances through the class
     * that owns this table rather than reaching for the repository itself — the
     * "only writer" rule is only meaningful if the interpretation lives with it.
     * {@code invitedContactId} is the half {@link GroupMemberBalanceRepository
     * #findByGroupIdAndUserId} cannot answer, and it is needed because ADR 0023 §4
     * permits an unregistered member as a settlement counterpart.
     *
     * @param userId           set iff looking up a registered member
     * @param invitedContactId set iff looking up a contact placeholder
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<GroupMemberBalance> findMemberBalance(
            UUID groupId, UUID userId, UUID invitedContactId) {
        return userId != null
                ? balanceRepository.findByGroupIdAndUserId(groupId, userId)
                : balanceRepository.findByGroupIdAndInvitedContactId(groupId, invitedContactId);
    }

    /**
     * <strong>Moves BOTH sides of a group settlement in one transaction, each
     * bounded by its own position, then asserts the group still
     * reconciles</strong> (ADR 0023 §4, api-overview.md §10.1 steps 2–3).
     *
     * <p>ADR 0023 §4's three rules, and where each one is:
     * <ul>
     *   <li><strong>Both rows move.</strong> Without the creditor's half, "the
     *       ledger says the money left the payer and arrived nowhere" ({@code V12}
     *       FLAG 1) and the group stops summing to zero. The caller derives which
     *       row is which; this method refuses to move only one.</li>
     *   <li><strong>The direction is derived, not supplied.</strong> That derivation
     *       is {@code SettlementService#deriveDirection}, because it also owns the
     *       {@code 400} for a ledger that contradicts the request.</li>
     *   <li><strong>The bound is the lesser of the two positions.</strong> It is not
     *       computed as a {@code min()} here — each side's own guard
     *       ({@code balance >= amount} for the creditor,
     *       {@code balance <= -amount} for the debtor) is evaluated inside its own
     *       UPDATE, and the conjunction of the two <em>is</em>
     *       {@code amount <= min(|debtor|, creditor)}. Expressing it that way is
     *       what makes it race-safe: a pre-computed minimum is a read, and
     *       {@code V12} contract item 3 is explicit that this read must be
     *       serialised against a concurrent settle.</li>
     * </ul>
     *
     * <p><strong>The two UPDATEs are issued in ascending row-id order, and that is
     * deadlock avoidance rather than tidiness.</strong> Each UPDATE holds its row
     * lock until commit, so two settlements touching an overlapping pair of rows in
     * opposite orders could deadlock. A total order on {@code id} makes a lock cycle
     * impossible for any number of concurrent settlements in any group, without
     * knowing anything about their directions.
     *
     * <p><strong>A zero affected-row count is a rejection, never a clamp.</strong>
     * It means a concurrent settlement consumed that position first, so the request
     * is answered {@code 400 AMOUNT_EXCEEDS_BALANCE} and the whole transaction
     * rolls back — which is required here, not optional: a settlement that moved
     * one side and not the other is worse than no settlement at all.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void applySettlement(
            GroupMemberBalance debtor, GroupMemberBalance creditor, BigDecimal amount) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        // UUID.compareTo is fine HERE and would be wrong for canonical pair
        // ordering, and the difference is worth stating because the two look
        // identical: this comparison only needs to be a TOTAL ORDER that every
        // concurrent transaction agrees on, so Java's signed-long ordering serves
        // perfectly. IndividualBalanceService#compareCanonical needs to agree with
        // PostgreSQL's UNSIGNED byte comparison, which UUID.compareTo does not —
        // see that method's Javadoc.
        boolean debtorFirst = debtor.getId().compareTo(creditor.getId()) < 0;

        if (debtorFirst) {
            reduceDebtor(debtor, amount, now);
            reduceCreditor(creditor, amount, now);
        } else {
            reduceCreditor(creditor, amount, now);
            reduceDebtor(debtor, amount, now);
        }

        assertGroupBalancesConsistent(debtor.getGroupId());
    }

    private void reduceDebtor(GroupMemberBalance debtor, BigDecimal amount, OffsetDateTime now) {
        int moved = balanceRepository.reduceDebtorPositionById(
                debtor.getId(), amount, amount.negate(), now);
        if (moved != 1) {
            log.info("Group settlement rejected by the bounded update on debtor balance {} "
                    + "(a concurrent settlement consumed the position)", debtor.getId());
            throw new AmountExceedsBalanceException();
        }
    }

    private void reduceCreditor(GroupMemberBalance creditor, BigDecimal amount, OffsetDateTime now) {
        int moved = balanceRepository.reduceCreditorPositionById(creditor.getId(), amount, now);
        if (moved != 1) {
            log.info("Group settlement rejected by the bounded update on creditor balance {} "
                    + "(a concurrent settlement consumed the position)", creditor.getId());
            throw new AmountExceedsBalanceException();
        }
    }

    /**
     * A statement that moved a different number of rows than the caller expected
     * has silently lost or invented a ledger movement, which is the one class of
     * bug this domain cannot afford to shrug off (ADR 0014 §2).
     */
    private static void requireExactly(int expected, int actual, String what) {
        if (expected != actual) {
            log.error("Balance movement mismatch applying {}: expected {} row(s), moved {}",
                    what, expected, actual);
            throw new IllegalStateException(
                    "Expected to move " + expected + " balance row(s) applying " + what
                            + ", moved " + actual);
        }
    }
}
