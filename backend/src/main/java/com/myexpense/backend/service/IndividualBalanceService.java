package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.response.IndividualBalanceResponse;
import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.exception.AmountExceedsBalanceException;
import com.myexpense.backend.exception.IndividualBalanceNotFoundException;
import com.myexpense.backend.exception.SplitRuleViolationException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.ContactRepository;
import com.myexpense.backend.repository.IndividualBalanceRepository;
import com.myexpense.backend.repository.MemberNameRow;
import com.myexpense.backend.repository.UserRepository;

/**
 * <strong>The only writer and the only interpreter of
 * {@code individual_balances}</strong> (api-overview.md §8.1, ADR 0023 §1).
 *
 * <p>Five rules live here and nowhere else. Each is a place ADR 0023's Backend
 * follow-up list says a second implementation is how the bug comes back.
 *
 * <h2>1. Pair resolution is ONE method: {@link #resolvePair}</h2>
 *
 * <p>ADR 0023 Backend follow-up item 1: "one service method that takes a contact
 * and returns the balance row, used by {@code POST /split-expenses} <em>and</em>
 * anything else that ever resolves a pair. Two implementations of this rule is how
 * two rows per pair come back." That method is the <em>only</em> caller of either
 * resolve-or-create statement, and the repository exposes no other way in.
 *
 * <h2>2. Canonical ordering is applied on every write</h2>
 *
 * <p>ADR 0023 §1.1 / item 2: {@code chk_individual_balances_canonical_pair_order}
 * is "the backstop, not the implementation". {@link #compareCanonical} orders the
 * two ids before every registered-pair write, so a wrongly-ordered row is
 * unreachable rather than caught.
 *
 * <h2>3. §8.1 reads BOTH SIDES and negates for the canonical counterpart</h2>
 *
 * <p>{@link #listIndividualBalances} filters on
 * {@code user_id = caller OR counterpart_user_id = caller} and flips the sign in
 * {@link #orientToCaller} — <strong>one flip, in one place</strong>. ADR 0023 item
 * 3 calls narrowing this to {@code user_id = caller} "the one place a reviewer
 * will not notice an omission, because the endpoint still returns plausible
 * data".
 *
 * <h2>4. "A party to this pair" is the authorization test</h2>
 *
 * <p>{@link #requireParty} is the membership gate for every endpoint that names an
 * {@code individualBalanceId}. Unknown and not-mine are one identical
 * {@code 404 INDIVIDUAL_BALANCE_NOT_FOUND}, never a {@code 403}
 * (security-architecture.md §2). <strong>Nothing here or anywhere else may assume
 * {@code user_id} is the caller</strong> — that is the mitigation ADR 0023 §1.2
 * states as a rule because the schema cannot.
 *
 * <h2>5. Movement is a relative delta; a settlement's bound is in the predicate</h2>
 *
 * <p>The mechanism is the one {@code V11} contract item 4 requires be picked once
 * for both balance tables: relative {@code balance = balance + ?} updates, with
 * {@code SELECT ... FOR UPDATE} deliberately absent. The single exception
 * {@code V12} contract item 3 identifies — a settlement's {@code amount <=
 * outstanding} check must be serialised against a concurrent settle — is solved by
 * putting the bound inside the UPDATE's own {@code WHERE} clause, so the pre-read
 * is advisory and the predicate is authoritative. See
 * {@link IndividualBalanceRepository} for the full argument and
 * {@link #reducePosition} for the three outcomes it produces.
 *
 * <h2>The transactional-rollback audit for this class</h2>
 *
 * <p>No {@code noRollbackFor}, and that is a conclusion rather than an omission
 * (backend/README.md §3's trap). {@link #resolvePair} decides every rejection it
 * can produce — {@code cannotSplitWithYourself} — <em>before</em> its upsert.
 * {@link #reducePosition} throws only when its bounded UPDATE matched <em>zero</em>
 * rows, i.e. when nothing was written; and on the group path a rollback is
 * actively required, because a settlement that moved one side and not the other is
 * worse than no settlement at all.
 */
@Service
public class IndividualBalanceService {

    private static final Logger log = LoggerFactory.getLogger(IndividualBalanceService.class);

    /**
     * {@code numeric(12,2)}, so a pair with no movement renders {@code 0.00}
     * rather than {@code 0} — one wire shape for the field regardless of which
     * branch produced it, the same choice {@code GroupResponseAssembler} makes for
     * {@code yourBalance}.
     */
    private static final BigDecimal ZERO_BALANCE = BigDecimal.ZERO.setScale(2);

    private final IndividualBalanceRepository balanceRepository;
    private final UserRepository userRepository;
    private final ContactRepository contactRepository;

    public IndividualBalanceService(
            IndividualBalanceRepository balanceRepository,
            UserRepository userRepository,
            ContactRepository contactRepository) {
        this.balanceRepository = balanceRepository;
        this.userRepository = userRepository;
        this.contactRepository = contactRepository;
    }

    // =====================================================================
    // §8.1 — GET /splits/individuals
    // =====================================================================

    /**
     * {@code GET /api/v1/splits/individuals} (§8.1) — <strong>membership-gated,
     * both sides, caller-oriented.</strong>
     *
     * <p>Three queries total, independent of how many counterparts the caller has:
     * the balance rows, then one batch name lookup per source table. Each name
     * lookup is skipped entirely when its id set is empty.
     *
     * <p>A plain array rather than a {@code PageResponse}, per the contract's own
     * shape — the set is bounded by one person's counterparts, the same reasoning
     * {@code GET /contacts} and {@code GET /groups} already use. Flagged in
     * backend/README.md §16.6 as this domain's departure from constitution §11.
     *
     * <p>The contact-name lookup is <strong>not</strong> owner-scoped, and it does
     * not need to be: a contact row's {@code user_id} <em>is</em> its owner, and
     * that owner is the caller for every contact row this query can return. Only
     * names are read, never a phone, an email or a {@code linkedUserId}.
     */
    @Transactional(readOnly = true)
    public List<IndividualBalanceResponse> listIndividualBalances(UUID userId) {
        requireUser(userId);

        List<IndividualBalance> rows = balanceRepository.findAllPartyTo(userId);
        if (rows.isEmpty()) {
            return List.of();
        }

        Map<UUID, String> namesByUserId = resolveNames(
                counterpartUserIds(rows, userId), userRepository::findMemberNamesByIdIn);
        Map<UUID, String> namesByContactId = resolveNames(
                counterpartContactIds(rows), contactRepository::findMemberNamesByIdIn);

        List<IndividualBalanceResponse> responses = new ArrayList<>(rows.size());
        for (IndividualBalance row : rows) {
            UUID counterpartUserId = counterpartUserIdOf(row, userId);
            UUID counterpartContactId = row.getCounterpartContactId();
            String name = counterpartUserId != null
                    ? namesByUserId.getOrDefault(counterpartUserId, "")
                    : namesByContactId.getOrDefault(counterpartContactId, "");
            responses.add(new IndividualBalanceResponse(
                    row.getId(),
                    counterpartUserId,
                    counterpartContactId,
                    name,
                    orientToCaller(row, userId),
                    row.getUpdatedAt()));
        }
        return List.copyOf(responses);
    }

    /**
     * <strong>The one sign flip</strong> (ADR 0023 §1.4). The stored
     * {@code balance} is signed relative to {@code user_id}; a caller who is the
     * canonical {@code counterpart_user_id} sees it negated, so the number always
     * means "from your point of view".
     *
     * <p>Public because {@code SettlementService} needs the identical orientation
     * for {@code SettlementResponse.remainingBalance} — and must not re-derive it,
     * or the same pair would read differently on two endpoints. That is the whole
     * reason this is a method and not an inline expression.
     *
     * <p>A contact row is never flipped: its {@code user_id} is the owner, who is
     * the only party that can read it.
     */
    public BigDecimal orientToCaller(IndividualBalance row, UUID callerId) {
        BigDecimal stored = row.getBalance() == null ? ZERO_BALANCE : row.getBalance();
        return callerId.equals(row.getCounterpartUserId()) ? stored.negate() : stored;
    }

    // =====================================================================
    // The pair-resolution rule (ADR 0023 §1.3) — ONE method
    // =====================================================================

    /**
     * <strong>Resolve-or-create the balance row for a pair, from a contact of the
     * caller's.</strong> The single implementation of ADR 0023 §1.3, binding on
     * every write path.
     *
     * <ol>
     *   <li>Resolve the contact's {@code linked_user_id}.</li>
     *   <li><strong>Non-null → the shared, canonical user-pair row.</strong> Order
     *       the two user ids ({@link #compareCanonical}), resolve-or-create the
     *       single row. <em>Both parties now read and settle the same row.</em></li>
     *   <li><strong>Null → the caller's private contact row.</strong> Owner-scoped,
     *       exactly as before.</li>
     * </ol>
     *
     * <p><strong>The self-pair case is rejected here, as a {@code 400}.</strong> A
     * contact may legitimately link to its own owner ({@code V9}'s FLAG 1, still
     * open at the contact level: a user may have their own number in their own
     * address book). {@code chk_individual_balances_canonical_pair_order} also
     * catches it — {@code user_id < counterpart_user_id} strictly implies
     * inequality, which is why {@code V11} removed the separate
     * {@code ..._counterpart_not_self} constraint — but only as an unmappable
     * {@code 23514}, and {@code V11} asks explicitly: "do not let it surface as a
     * 500 on a user-reachable path."
     *
     * <p><strong>What this method deliberately does NOT do</strong> (ADR 0023 Open
     * Question 1): when a contact links to a real account <em>later</em>, its
     * private row must be claimed into the canonical pair row. That pass is not
     * designed, and "no write path may improvise it" — so a pair that already has a
     * private contact row keeps using it even after the contact links, and nothing
     * here merges anything. Nothing is lost or orphaned meanwhile.
     *
     * <p>{@code MANDATORY} propagation: this writes, and it must write inside the
     * caller's transaction so the resolve, the ledger row and the fan-out commit
     * together (§9.1's "in one transaction"). It cannot start one of its own by
     * accident.
     *
     * @param contact one of the caller's <em>own</em> contacts — the caller must
     *                already have resolved it owner-scoped
     */
    /**
     * ADR 0027 §7.2 — the settle target {@code individualCounterpartContactId}:
     * the pair row {@link #resolvePair} WOULD use for this contact, found by the
     * same ADR 0023 §1.3 rule (a linked contact resolves to the canonical user
     * pair), but <strong>never created</strong>. Empty when no row exists yet,
     * which the settle path answers {@code 400 AMOUNT_EXCEEDS_BALANCE}.
     *
     * @param contact one of the caller's own contacts, resolved owner-scoped
     */
    public java.util.Optional<IndividualBalance> findPair(UUID callerId, Contact contact) {
        UUID linkedUserId = contact.getLinkedUserId();
        if (linkedUserId == null) {
            return balanceRepository.findByUserIdAndCounterpartContactId(callerId, contact.getId());
        }
        if (callerId.equals(linkedUserId)) {
            throw SplitRuleViolationException.cannotSplitWithYourself();
        }
        boolean callerIsLesser = compareCanonical(callerId, linkedUserId) < 0;
        return balanceRepository.findRegisteredPair(
                callerIsLesser ? callerId : linkedUserId, callerIsLesser ? linkedUserId : callerId);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public IndividualBalance resolvePair(UUID callerId, Contact contact) {
        UUID linkedUserId = contact.getLinkedUserId();
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

        if (linkedUserId == null) {
            balanceRepository.resolveOrCreateContactPair(callerId, contact.getId(), now);
            return balanceRepository.findByUserIdAndCounterpartContactId(callerId, contact.getId())
                    .orElseThrow(() -> new IllegalStateException(
                            "Contact balance row for contact " + contact.getId()
                                    + " was upserted but could not be read back."));
        }

        if (callerId.equals(linkedUserId)) {
            throw SplitRuleViolationException.cannotSplitWithYourself();
        }

        boolean callerIsLesser = compareCanonical(callerId, linkedUserId) < 0;
        UUID lesser = callerIsLesser ? callerId : linkedUserId;
        UUID greater = callerIsLesser ? linkedUserId : callerId;

        balanceRepository.resolveOrCreateRegisteredPair(lesser, greater, now);
        return balanceRepository.findRegisteredPair(lesser, greater)
                .orElseThrow(() -> new IllegalStateException(
                        "Canonical pair row was upserted but could not be read back."));
    }

    /**
     * <strong>Resolve-or-create several pair rows in ONE global lock order</strong>
     * (ADR 0026 §4.5) — the multi-contact individual split.
     *
     * <p>{@code resolveOrCreate*Pair} is {@code INSERT ... ON CONFLICT ... DO
     * UPDATE}, which row-locks an existing pair row, and {@code applyDeltaById}
     * locks it too. Two concurrent splits sharing two pair rows could otherwise
     * lock them in opposite orders and deadlock ({@code 40P01}). Every multi-row
     * transaction therefore takes its locks in the order {@link #lockOrder}
     * defines, so no wait cycle can form.
     *
     * <p><strong>Delegates to {@link #resolvePair} once per contact and never
     * re-implements it</strong>: two implementations of ADR 0023 §1.3 is how two
     * rows per pair come back.
     *
     * @param contacts the caller's own contacts, already resolved owner-scoped,
     *                 distinct, none linked to the caller
     * @return the pair rows keyed by contact id. <strong>Iteration order is lock
     *         order</strong>, and the caller applies its deltas in that same order.
     *         Request order (primary counterpart, response order) is the caller's
     *         to keep.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Map<UUID, IndividualBalance> resolvePairs(UUID callerId, List<Contact> contacts) {
        Map<UUID, IndividualBalance> rowsByContactId = new LinkedHashMap<>();
        for (Contact contact : lockOrder(callerId, contacts)) {
            rowsByContactId.put(contact.getId(), resolvePair(callerId, contact));
        }
        return rowsByContactId;
    }

    /**
     * ADR 0026 §4.5's total order over pair keys, computable <em>before</em>
     * resolution so even the first lock is taken in order:
     * <ol>
     *   <li><strong>registered (user-pair) rows first</strong>, by
     *       {@code (lesser user id, greater user id)};</li>
     *   <li><strong>then contact rows</strong>, by contact id.</li>
     * </ol>
     * Every comparison uses {@link #compareCanonical} (PostgreSQL's unsigned uuid
     * order), never {@link UUID#compareTo}.
     *
     * <p>Package-private so the order can be pinned by a unit test.
     */
    static List<Contact> lockOrder(UUID callerId, List<Contact> contacts) {
        List<Contact> ordered = new ArrayList<>(contacts);
        ordered.sort((left, right) -> comparePairKeys(callerId, left, right));
        return ordered;
    }

    private static int comparePairKeys(UUID callerId, Contact left, Contact right) {
        return PairLockKey.ofContact(callerId, left).compareTo(PairLockKey.ofContact(callerId, right));
    }

    /**
     * ADR 0026 §4.5's lock key — the ONE definition of the pair lock order, shared
     * by {@link #resolvePairs} (keys computed from contacts, before resolution)
     * and {@link #lockPairs} (keys read off stored rows). Registered pairs first,
     * by {@code (lesser, greater)} user id; then contact rows by contact id. Every
     * comparison is {@link #compareCanonical}, never {@link UUID#compareTo}.
     *
     * @param first  the lesser user id, or the contact id for a contact row
     * @param second the greater user id; {@code null} for a contact row
     */
    record PairLockKey(boolean registered, UUID first, UUID second) implements Comparable<PairLockKey> {

        static PairLockKey ofContact(UUID callerId, Contact contact) {
            if (contact.getLinkedUserId() == null) {
                return new PairLockKey(false, contact.getId(), null);
            }
            UUID[] key = canonicalPair(callerId, contact.getLinkedUserId());
            return new PairLockKey(true, key[0], key[1]);
        }

        /** A stored row's user pair is already canonical: {@code user_id} is the lesser side. */
        static PairLockKey ofRow(IndividualBalance row) {
            return row.getCounterpartContactId() != null
                    ? new PairLockKey(false, row.getCounterpartContactId(), null)
                    : new PairLockKey(true, row.getUserId(), row.getCounterpartUserId());
        }

        @Override
        public int compareTo(PairLockKey other) {
            if (registered != other.registered) {
                return registered ? -1 : 1;
            }
            int byFirst = compareCanonical(first, other.first);
            if (byFirst != 0 || !registered) {
                return byFirst;
            }
            return compareCanonical(second, other.second);
        }
    }

    /**
     * <strong>Locks existing pair rows {@code FOR UPDATE} in ADR 0026 §4.5's
     * canonical order</strong> (ADR 0028 §4.5) — the edit and delete of an
     * individual split, which move pair rows that already exist and must not
     * create any.
     *
     * <p>Reads the rows once (unlocked) to learn their keys, orders them by
     * {@link PairLockKey} — the same order {@link #resolvePairs} uses, so an edit
     * and a create over overlapping pairs cannot form a wait cycle — then takes
     * each row lock in that order.
     *
     * @return the rows in lock order; the caller applies its deltas in this order
     * @throws IllegalStateException if a linked pair row does not exist
     *         (unreachable: link rows reference it with a NO ACTION FK and nothing
     *         is hard-deleted)
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<IndividualBalance> lockPairs(Collection<UUID> balanceIds) {
        List<IndividualBalance> rows = new ArrayList<>(balanceRepository.findAllById(new HashSet<>(balanceIds)));
        if (rows.size() != new HashSet<>(balanceIds).size()) {
            throw new IllegalStateException("A linked individual_balances row could not be read");
        }
        rows.sort((left, right) -> PairLockKey.ofRow(left).compareTo(PairLockKey.ofRow(right)));
        List<IndividualBalance> locked = new ArrayList<>(rows.size());
        for (IndividualBalance row : rows) {
            locked.add(balanceRepository.findForUpdateById(row.getId())
                    .orElseThrow(() -> new IllegalStateException(
                            "Linked individual_balances row " + row.getId() + " vanished while locking")));
        }
        return locked;
    }

    /** {@code {lesser, greater}} in PostgreSQL's unsigned uuid order. */
    private static UUID[] canonicalPair(UUID first, UUID second) {
        return compareCanonical(first, second) < 0
                ? new UUID[] {first, second}
                : new UUID[] {second, first};
    }

    /**
     * Orders two uuids <strong>the way PostgreSQL does</strong>, which is the one
     * thing {@code chk_individual_balances_canonical_pair_order} actually compares
     * against.
     *
     * <p><strong>{@link UUID#compareTo(UUID)} IS WRONG HERE AND MUST NOT BE
     * USED.</strong> Java compares the two 64-bit halves as <em>signed</em> longs,
     * while PostgreSQL compares a {@code uuid} as 16 <em>unsigned</em> bytes. The
     * two orders disagree for any pair whose most-significant bits differ in the
     * top bit — and {@code gen_random_uuid()} produces version-4 uuids whose top
     * bit is random, so roughly half of all real pairs would be ordered the wrong
     * way round. Every one of those writes would violate the CHECK and surface as
     * a {@code 500} on a perfectly legal request, and no test with a hand-picked
     * pair of low uuids would ever show it.
     *
     * <p>{@link Long#compareUnsigned} on the most-significant half, then on the
     * least-significant half, is exactly PostgreSQL's byte-wise comparison of the
     * big-endian representation. uuid ordering in PostgreSQL is a total order over
     * those 16 bytes, so "lesser" is well-defined, stable and
     * collation-independent — unlike text, this cannot be re-ordered by a locale
     * change ({@code V11}).
     *
     * <p>Package-private rather than private so a future test can pin this
     * behaviour without reflection; it is not called from outside this class.
     */
    static int compareCanonical(UUID left, UUID right) {
        int high = Long.compareUnsigned(left.getMostSignificantBits(), right.getMostSignificantBits());
        if (high != 0) {
            return high;
        }
        return Long.compareUnsigned(left.getLeastSignificantBits(), right.getLeastSignificantBits());
    }

    // =====================================================================
    // Movement
    // =====================================================================

    /**
     * Applies a signed delta to one pair row — {@code POST /split-expenses}
     * (§9.1 step 2).
     *
     * <p>The sign is the caller's to compute, because only the write path knows
     * which side of the canonical row fronted the money;
     * {@code IndividualSplitRules#signedPairDelta} does it in one place and
     * documents the convention. A zero delta is still applied (it refreshes
     * {@code updated_at}, which is what tells a client how fresh a shared number
     * is).
     *
     * <p>No bound and no sign check: a split may legitimately push a pair's
     * balance arbitrarily far in either direction. Only a settlement is bounded.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void applyDelta(UUID balanceId, BigDecimal delta) {
        int updated = balanceRepository.applyDeltaById(
                balanceId, delta, OffsetDateTime.now(ZoneOffset.UTC));
        if (updated != 1) {
            // Unreachable through the API: the row was resolved in this same
            // transaction and nothing deletes an individual_balances row. A loud
            // failure is the honest answer, because silently losing a ledger
            // movement is the worst outcome available here.
            throw new IllegalStateException(
                    "Expected to move exactly one individual_balances row, moved " + updated);
        }
    }

    /**
     * <strong>Settlement, individual target (§10.1 steps 2–3).</strong> Reduces
     * {@code |balance|} toward zero by {@code amount}, with the bound enforced
     * inside the UPDATE.
     *
     * <p>"Settlement needs no sign reasoning and no counterpart for the individual
     * case" (ADR 0023 §1.4): one row exists, either party may settle it, and a
     * settlement always reduces the magnitude toward zero. So the direction is not
     * a choice — it is read off the row's own sign, and {@code |balance|} is the
     * bound ADR 0017 §4 already specified.
     *
     * <p>Three outcomes, and the distinction between the last two is the race:
     * <ul>
     *   <li>the balance is already {@code 0.00} → {@code 400
     *       AMOUNT_EXCEEDS_BALANCE}, per §10.1's own ruling that an outstanding of
     *       zero needs no separate code;</li>
     *   <li>{@code amount > |balance|} as read → {@code 400
     *       AMOUNT_EXCEEDS_BALANCE} from the pre-read;</li>
     *   <li>the pre-read passed but the bounded UPDATE matched zero rows → the
     *       <em>same</em> {@code 400}, because a concurrent settlement consumed the
     *       position first. This is the case a pre-read alone cannot cover and the
     *       reason the bound is in the predicate ({@code V12} contract item 3).</li>
     * </ul>
     *
     * <p><strong>The balance is reduced to its residual, never zeroed</strong>
     * ({@code V12} contract item 2(a) — "the single most likely implementation
     * error now that a partial amount is legal"). A full-amount settlement lands
     * on exactly {@code 0} by arithmetic, because {@code numeric(12,2)} is exact.
     *
     * @return the row re-read after the move, for
     *         {@code SettlementResponse.remainingBalance}
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public IndividualBalance reducePosition(IndividualBalance row, BigDecimal amount) {
        BigDecimal stored = row.getBalance();
        if (stored == null || stored.signum() == 0) {
            throw new AmountExceedsBalanceException();
        }
        if (stored.abs().compareTo(amount) < 0) {
            throw new AmountExceedsBalanceException();
        }

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        int updated = stored.signum() > 0
                ? balanceRepository.reduceCreditorPositionById(row.getId(), amount, now)
                : balanceRepository.reduceDebtorPositionById(
                        row.getId(), amount, amount.negate(), now);

        if (updated != 1) {
            // The bound in the predicate did the work the pre-read could not: a
            // concurrent settlement moved this row between the two. Same client
            // answer, because the client's situation is the same.
            log.info("Individual settlement rejected by the bounded update for balance {} "
                    + "(a concurrent settlement consumed the position)", row.getId());
            throw new AmountExceedsBalanceException();
        }

        return balanceRepository.findById(row.getId())
                .orElseThrow(IndividualBalanceNotFoundException::new);
    }

    // =====================================================================
    // Authorization
    // =====================================================================

    /**
     * <strong>The pairwise membership gate: "is the caller a party to this
     * pair".</strong>
     *
     * <p>{@code user_id = caller} OR {@code counterpart_user_id = caller} — on a
     * private contact row the first disjunct <em>is</em> the owner check, so one
     * test covers both modes. A {@code false} answer is
     * {@code 404 INDIVIDUAL_BALANCE_NOT_FOUND} whether the row is absent or merely
     * someone else's, so this method never learns which case it was and cannot
     * leak the difference (security-architecture.md §2).
     *
     * <p>Used by {@code POST /splits/settle} and by {@code GET /split-expenses?
     * individualBalanceId=}. Note what it is <em>not</em>: a check against
     * {@code user_id} alone would refuse a legitimate counterpart, which is the
     * same single-sided bug ADR 0023 §1.4 fixed on the read path.
     */
    @Transactional(readOnly = true)
    public IndividualBalance requireParty(UUID callerId, UUID balanceId) {
        IndividualBalance row = balanceRepository.findById(balanceId)
                .orElseThrow(IndividualBalanceNotFoundException::new);
        if (!isParty(row, callerId)) {
            throw new IndividualBalanceNotFoundException();
        }
        return row;
    }

    /**
     * The same gate as {@link #requireParty}, as a boolean — for a caller whose
     * {@code 404} carries a <em>different</em> error code.
     *
     * <p>{@code GET /split-expenses/{id}} (§9.2) answers
     * {@code 404 SPLIT_EXPENSE_NOT_FOUND} for every one of its three failure
     * modes, including "that split targets a pair you are not part of" — so it
     * needs the answer, not this class's exception. Routing it through the same
     * {@link #isParty} predicate is what keeps there being one definition of "a
     * party to this pair".
     */
    @Transactional(readOnly = true)
    public boolean isCallerParty(UUID callerId, UUID balanceId) {
        return balanceRepository.findById(balanceId)
                .filter(row -> isParty(row, callerId))
                .isPresent();
    }

    /**
     * {@code GET /split-expenses/{id}} (§9.2) for an individual split: is the
     * caller a party to <strong>any</strong> of the pair rows it moved
     * (ADR 0026 §5.3)? The creator is a party to all of them, each registered
     * counterpart to theirs. One batched read, and the same {@link #isParty}
     * predicate, so there is still one definition of "a party to this pair".
     *
     * @param balanceIds the split's link rows' pair ids — never
     *                   {@code split_expenses.individual_balance_id} (ADR 0026 §3)
     */
    @Transactional(readOnly = true)
    public boolean isCallerPartyToAny(UUID callerId, Collection<UUID> balanceIds) {
        if (balanceIds.isEmpty()) {
            return false;
        }
        return balanceRepository.findAllById(balanceIds).stream()
                .anyMatch(row -> isParty(row, callerId));
    }

    /** The predicate behind {@link #requireParty}, extracted so it reads once. */
    public static boolean isParty(IndividualBalance row, UUID callerId) {
        return callerId.equals(row.getUserId()) || callerId.equals(row.getCounterpartUserId());
    }

    /**
     * The other party's user id from the caller's point of view, or {@code null}
     * when the counterpart is an unregistered contact.
     *
     * <p><strong>Not positional</strong>: when the caller is the canonical
     * {@code counterpart_user_id}, the other party is the row's {@code user_id}
     * (ADR 0023 §1.4 — "whichever column that is").
     */
    public static UUID counterpartUserIdOf(IndividualBalance row, UUID callerId) {
        if (row.getCounterpartContactId() != null) {
            return null;
        }
        return callerId.equals(row.getUserId()) ? row.getCounterpartUserId() : row.getUserId();
    }

    // =====================================================================
    // Internals
    // =====================================================================

    private static Set<UUID> counterpartUserIds(List<IndividualBalance> rows, UUID callerId) {
        Set<UUID> ids = new HashSet<>();
        for (IndividualBalance row : rows) {
            UUID counterpartUserId = counterpartUserIdOf(row, callerId);
            if (counterpartUserId != null) {
                ids.add(counterpartUserId);
            }
        }
        return ids;
    }

    private static Set<UUID> counterpartContactIds(List<IndividualBalance> rows) {
        Set<UUID> ids = new HashSet<>();
        for (IndividualBalance row : rows) {
            if (row.getCounterpartContactId() != null) {
                ids.add(row.getCounterpartContactId());
            }
        }
        return ids;
    }

    /**
     * One batch lookup per source table, skipped when there is nothing to look up
     * — the same shape {@code GroupResponseAssembler} uses, and the reason this
     * endpoint is three queries rather than one per counterpart (constitution §10).
     */
    private static Map<UUID, String> resolveNames(
            Set<UUID> ids, Function<Collection<UUID>, List<MemberNameRow>> lookup) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return lookup.apply(ids).stream()
                .collect(Collectors.toMap(MemberNameRow::id, MemberNameRow::name, (first, second) -> first));
    }

    /**
     * A valid token whose user row no longer exists is a {@code 401}, not a
     * {@code 404} — the missing resource <em>is</em> the principal. Same rule as
     * every domain before this one.
     */
    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }
}
