package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.myexpense.backend.dto.request.CreateSettlementRequest;
import com.myexpense.backend.dto.response.SettlementResponse;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.GroupMemberBalance;
import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.entity.Settlement;
import com.myexpense.backend.exception.AmountExceedsBalanceException;
import com.myexpense.backend.exception.ContactNotFoundException;
import com.myexpense.backend.exception.GroupNotFoundException;
import com.myexpense.backend.exception.IdConflictException;
import com.myexpense.backend.exception.SettlementDirectionChangedException;
import com.myexpense.backend.exception.SplitRuleViolationException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.exception.WriteRequestValidationException;
import com.myexpense.backend.repository.ContactRepository;
import com.myexpense.backend.repository.EntityInserter;
import com.myexpense.backend.sync.ChangeLogEntityTypes;
import com.myexpense.backend.sync.ChangeSets;
import com.myexpense.backend.sync.ClientIds;
import com.myexpense.backend.sync.IdempotentWriteExecutor;
import com.myexpense.backend.sync.WriteContext;
import com.myexpense.backend.sync.WriteResult;
import com.myexpense.backend.repository.GroupMemberRepository;
import com.myexpense.backend.repository.GroupRepository;
import com.myexpense.backend.repository.MemberNameRow;
import com.myexpense.backend.repository.SettlementRepository;
import com.myexpense.backend.repository.UserRepository;

/**
 * Business rules for Settle up (api-overview.md §10.1) — Domain 6 sub-step 4.
 *
 * <h2>§10.1's five steps, in one transaction</h2>
 *
 * <ol>
 *   <li>Resolve the target balance row — membership-gated.</li>
 *   <li>Validate {@code amount > 0} and {@code amount <= |outstanding|}.
 *       <strong>An over-amount is rejected, never clamped, and never allowed to
 *       flip the balance's sign into a reverse debt.</strong></li>
 *   <li><strong>Reduce the balance to its RESIDUAL — {@code balance ± amount} —
 *       do NOT zero it.</strong> §10.1 calls this "the single most likely
 *       implementation error now that a partial amount is legal": the old
 *       contract's always-zeroes behaviour was only correct because {@code amount}
 *       was forced to equal the whole balance, and keeping it would silently
 *       forgive the remainder. A full-amount settlement lands on exactly {@code 0}
 *       by arithmetic, not by special-casing.</li>
 *   <li>Insert the {@code settlements} row.</li>
 *   <li>Fan out {@code activities}/{@code notifications} to every other affected
 *       member.</li>
 * </ol>
 *
 * <h2>A GROUP settlement moves BOTH rows, and its direction is DERIVED</h2>
 *
 * <p>ADR 0023 §4 is the whole of this section, and all three of its rules are
 * here:
 * <ul>
 *   <li><strong>Both balance rows move in the same transaction</strong> — the
 *       debtor's toward zero and the creditor's toward zero by the same amount —
 *       so the group still sums to zero afterwards. Moving only the caller's row
 *       (which is what §10.1 step 3 literally said before ADR 0023) leaves "the
 *       money left the payer and arrived nowhere".</li>
 *   <li><strong>Membership is checked for the COUNTERPART as well as the
 *       caller</strong>, returning {@code 404} and never {@code 403} for a
 *       non-member (follow-up item 6). {@code fk_settlements_counterpart_user_id}
 *       guarantees the user <em>exists</em>, not that they are a member.</li>
 *   <li><strong>The direction is derived from the two balances, never
 *       supplied.</strong> The request names a counterpart, not a payer. If both
 *       parties are debtors, both are creditors, or either balance is zero, the
 *       request is {@code 400 VALIDATION_ERROR} — "a settlement that contradicts
 *       the ledger is not a settlement" — <strong>rejected rather than
 *       guessed</strong> (follow-up item 5).</li>
 * </ul>
 *
 * <p>An <strong>individual</strong> settlement needs none of that reasoning: after
 * ADR 0023 §1 the {@code individual_balances} row <em>is</em> the pair, so both
 * parties are in the row the settlement already references, either may settle it,
 * and a settlement always reduces {@code |balance|} toward zero.
 *
 * <h2>How the bound is serialised</h2>
 *
 * <p>{@code V12} contract item 3 is the only place in this domain where a read
 * must be protected as well as a write: "two members settling the same balance
 * near-simultaneously can both pass the {@code amount <= outstanding} check
 * against the same pre-read value and together over-settle it, flipping the sign
 * that (b) forbids."
 *
 * <p><strong>The answer taken here puts the bound inside each UPDATE's own
 * {@code WHERE} clause</strong> rather than taking a lock, so the pre-read in this
 * class is advisory — it derives the direction and chooses which {@code 400} to
 * raise — and the predicate is authoritative. No {@code SELECT ... FOR UPDATE} is
 * added to either balance table, which backend/README.md §15.5 and {@code V10}'s
 * CONCURRENCY block both require, and the relative-delta mechanism stays unmixed.
 * The group path additionally issues its two UPDATEs in ascending row-id order so
 * no lock cycle is possible. Full argument on
 * {@code GroupMemberBalanceRepository#reduceCreditorPositionById}.
 *
 * <h2>The transactional-rollback audit for this class</h2>
 *
 * <p><strong>No {@code noRollbackFor}, and here a rollback is not merely
 * acceptable but required.</strong> Every user-facing rejection — the target
 * shape, both membership checks, the derived direction, and the bound — is decided
 * before the first write. The one rejection that can arrive <em>after</em> a write
 * is a bounded UPDATE matching zero rows on the second of two sides, and that one
 * <strong>must</strong> roll back: a settlement that moved one side and not the
 * other breaks the zero-sum invariant permanently, in the one table whose purpose
 * is to be independently verifiable by both parties later. There is no
 * irreversible side effect anywhere on this path.
 */
@Service
public class SettlementService {

    private static final Logger log = LoggerFactory.getLogger(SettlementService.class);

    private static final String TARGET_GROUP = "group";

    /** ADR 0027 §7.3's two {@code expectedDirection} values. */
    static final String EXPECT_CALLER_PAYS = "caller_pays";
    static final String EXPECT_CALLER_RECEIVES = "caller_receives";

    private final EntityInserter entityInserter;
    private final IdempotentWriteExecutor writeExecutor;
    private final ChangeLogWriter changeLogWriter;

    private final SettlementRepository settlementRepository;
    private final GroupRepository groupRepository;
    private final GroupMemberRepository memberRepository;
    private final GroupBalanceService groupBalanceService;
    private final IndividualBalanceService individualBalanceService;
    private final ActivityFanoutService activityFanoutService;
    private final UserRepository userRepository;
    private final ContactRepository contactRepository;
    private final SplitLedgerService splitLedgerService;
    private final SettlementPartiesResolver partiesResolver;

    public SettlementService(
            SettlementRepository settlementRepository,
            GroupRepository groupRepository,
            GroupMemberRepository memberRepository,
            GroupBalanceService groupBalanceService,
            IndividualBalanceService individualBalanceService,
            ActivityFanoutService activityFanoutService,
            UserRepository userRepository,
            ContactRepository contactRepository,
            EntityInserter entityInserter,
            IdempotentWriteExecutor writeExecutor,
            ChangeLogWriter changeLogWriter,
            SplitLedgerService splitLedgerService,
            SettlementPartiesResolver partiesResolver) {
        this.splitLedgerService = splitLedgerService;
        this.partiesResolver = partiesResolver;
        this.entityInserter = entityInserter;
        this.writeExecutor = writeExecutor;
        this.changeLogWriter = changeLogWriter;
        this.settlementRepository = settlementRepository;
        this.groupRepository = groupRepository;
        this.memberRepository = memberRepository;
        this.groupBalanceService = groupBalanceService;
        this.individualBalanceService = individualBalanceService;
        this.activityFanoutService = activityFanoutService;
        this.userRepository = userRepository;
        this.contactRepository = contactRepository;
    }

    /**
     * {@code POST /api/v1/splits/settle} (§10.1) — {@code 201 Created}.
     *
     * <p>ADR 0027: logged and deduplicated; not {@code @Transactional} itself,
     * because {@code IdempotentWriteExecutor} owns the boundary. A replay (key or
     * caller-owned client id) answers {@code 201} with the CURRENT
     * {@code remainingBalance} and writes nothing.
     */
    public WriteResult<SettlementResponse> settle(UUID userId, CreateSettlementRequest request, WriteContext context) {
        UUID requestedId = ClientIds.requireNotNil(request.id(), "id");
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.SETTLEMENT, ChangeLog.OPERATION_CREATE, requestedId),
                recorded -> WriteResult.created(currentResponse(userId, recorded.getEntityId())),
                () -> doSettle(userId, request, requestedId, context));
    }

    private WriteResult<SettlementResponse> doSettle(
            UUID userId, CreateSettlementRequest request, UUID requestedId, WriteContext context) {
        requireUser(userId);
        // ADR 0027 §3.3 step 3, before ANY ledger write: explicit lookup of the
        // client id; never save() with it.
        if (requestedId != null) {
            Settlement existing = settlementRepository.findById(requestedId).orElse(null);
            if (existing != null) {
                if (!userId.equals(existing.getInitiatedByUserId())) {
                    throw new IdConflictException();
                }
                return WriteResult.created(currentResponse(userId, requestedId));
            }
        }
        boolean groupTarget = TARGET_GROUP.equals(request.target());
        validateTargetShape(groupTarget, request);
        SettlementResponse response = groupTarget
                ? settleGroup(userId, request, requestedId, context)
                : settleIndividual(userId, request, requestedId, context);
        return WriteResult.created(response);
    }

    /** Replay read: the caller's settlement with its target's CURRENT remaining balance. */
    private SettlementResponse currentResponse(UUID userId, UUID settlementId) {
        Settlement settlement = settlementRepository.findById(settlementId)
                .filter(row -> userId.equals(row.getInitiatedByUserId()))
                .orElseThrow(() -> new IllegalStateException(
                        "Recorded settlement " + settlementId + " is not readable by its initiator"));
        BigDecimal remaining = settlement.getGroupId() != null
                ? groupBalanceService.findMemberBalance(settlement.getGroupId(), userId, null)
                        .map(GroupMemberBalance::getBalance)
                        .orElse(BigDecimal.ZERO)
                : individualBalanceService.orientToCaller(
                        individualBalanceService.requireParty(userId, settlement.getIndividualBalanceId()), userId);
        return toResponse(settlement, remaining);
    }

    /**
     * ADR 0027 §7.3 — {@code expectedDirection}. {@code callerPosition} is the
     * caller's balance from their own point of view: negative = the caller owes
     * (pays), positive = the caller is owed (receives). Zero, or the other sign,
     * is {@code 409 SETTLEMENT_DIRECTION_CHANGED}, decided before any write.
     */
    static void requireExpectedDirection(String expectedDirection, BigDecimal callerPosition) {
        if (expectedDirection == null) {
            return;
        }
        int sign = callerPosition == null ? 0 : callerPosition.signum();
        boolean matches = (EXPECT_CALLER_PAYS.equals(expectedDirection) && sign < 0)
                || (EXPECT_CALLER_RECEIVES.equals(expectedDirection) && sign > 0);
        if (!matches) {
            throw new SettlementDirectionChangedException();
        }
    }

    /** ADR 0027 §6.3's logged fields for {@code settlement}. */
    private UUID logSettlement(UUID userId, Settlement settlement, CreateSettlementRequest request,
            BigDecimal remaining, WriteContext context) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("target", request.target());
        fields.put("groupId", settlement.getGroupId());
        fields.put("individualBalanceId", settlement.getIndividualBalanceId());
        fields.put("counterpartUserId", settlement.getCounterpartUserId());
        fields.put("counterpartContactId", settlement.getCounterpartContactId());
        fields.put("amount", settlement.getAmount());
        fields.put("method", settlement.getMethod());
        fields.put("remainingBalance", remaining);
        return changeLogWriter.logApplied(userId, ChangeLogEntityTypes.SETTLEMENT, settlement.getId(),
                ChangeLog.OPERATION_CREATE, ChangeSets.create(fields), context,
                context.effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC)), true);
    }

    // =====================================================================
    // Group target
    // =====================================================================

    private SettlementResponse settleGroup(
            UUID userId, CreateSettlementRequest request, UUID requestedId, WriteContext context) {
        UUID groupId = request.groupId();
        requireMembership(groupId, userId);
        requireCounterpartMembership(groupId, request);

        // ADR 0028 §4.5: the group mutex before any balance read or write, so a
        // settlement cannot interleave with a concurrent split create/edit/delete
        // on the same group (deadlock avoidance).
        splitLedgerService.lockGroupForLedgerWrite(groupId);

        // Step 1. The caller's own row is "the target balance row" §10.1 step 1
        // names, and an absent row is an outstanding of 0 — so any positive amount
        // exceeds it and §10.1's own ruling applies: "also the response when the
        // caller has no balance row at all ... no separate error code is needed".
        GroupMemberBalance callerBalance = groupBalanceService
                .findMemberBalance(groupId, userId, null)
                .orElse(null);
        // ADR 0027 §7.3: checked first, so a flipped or zeroed balance is a 409
        // rather than a settlement recorded in the wrong direction.
        requireExpectedDirection(request.expectedDirection(),
                callerBalance == null ? BigDecimal.ZERO : callerBalance.getBalance());
        if (callerBalance == null) {
            throw new AmountExceedsBalanceException();
        }

        // An absent counterpart row is a position of zero, which cannot be a
        // settlement direction at all — so it is the ledger-contradiction 400
        // rather than a bound failure. (§7 gives every member a row the moment
        // they join, so this is unreachable through the API.)
        GroupMemberBalance counterpartBalance = groupBalanceService
                .findMemberBalance(groupId, request.counterpartUserId(), request.counterpartContactId())
                .orElseThrow(SplitRuleViolationException::settlementDirectionContradictsLedger);

        // Step 2 — the direction, DERIVED, and the two-sided bound.
        Direction direction = deriveDirection(callerBalance, counterpartBalance);
        requireWithinLesserPosition(direction, request.amount());
        boolean callerPaid = direction.debtor().getId().equals(callerBalance.getId());

        // Step 3 — both rows, bounded in their own predicates, then the zero-sum
        // assertion (inside this call, same transaction).
        groupBalanceService.applySettlement(direction.debtor(), direction.creditor(), request.amount());

        // Step 4.
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        // INSERT only (ADR 0027 §3.3): persist, never merge.
        Settlement settlement = entityInserter.insert(Settlement.builder()
                .id(requestedId != null ? requestedId : UUID.randomUUID())
                .groupId(groupId)
                // Explicit null: chk_settlements_target_xor is a true XOR, and
                // V12 says it is "reachable only if the service fills both target
                // columns or neither".
                .individualBalanceId(null)
                .initiatedByUserId(userId)
                .counterpartUserId(request.counterpartUserId())
                .counterpartContactId(request.counterpartContactId())
                .amount(request.amount())
                .method(request.method())
                // ADR 0028 §7.4: the direction derived above, stored. true = the
                // caller was the debtor, i.e. the caller paid.
                .initiatorIsPayer(callerPaid)
                // No column default, deliberately: settled_at is when the MONEY
                // moved and created_at is when the ROW was written (V12).
                .settledAt(now)
                .build());

        // §10.1's remainingBalance — the CALLER's residual, which for a group
        // target is exactly what step 1 calls the target row.
        BigDecimal remaining = groupBalanceService.findMemberBalance(groupId, userId, null)
                .map(GroupMemberBalance::getBalance)
                .orElse(BigDecimal.ZERO);

        // Step 5. Affected = the two parties whose rows moved, plus the actor
        // (who is one of them). An unregistered counterpart receives nothing,
        // structurally: activities.user_id and notifications.user_id are NOT NULL
        // FKs to users. Flagged in backend/README.md §16.6.
        Set<UUID> affected = new LinkedHashSet<>();
        affected.add(userId);
        if (request.counterpartUserId() != null) {
            affected.add(request.counterpartUserId());
        }
        // Logged before the fan-out so the actor's settlement activity links to it.
        UUID changeLogId = logSettlement(userId, settlement, request, remaining, context);
        String callerName = userName(userId);
        String counterpartName = counterpartName(request.counterpartUserId(), request.counterpartContactId());
        activityFanoutService.fanOutSettlement(new ActivityFanoutService.SettlementFanout(
                true,
                userId,
                callerPaid ? userId : request.counterpartUserId(),
                callerPaid ? callerName : counterpartName,
                callerPaid ? request.counterpartUserId() : userId,
                callerPaid ? counterpartName : callerName,
                groupName(groupId),
                groupId,
                // null for a group settlement, matching ADR 0009 §6.3's
                // relatedGroupId/relatedContactId split exactly.
                null,
                request.amount(),
                affected,
                changeLogId,
                Map.of()));

        logSettled(settlement, userId, affected.size());
        return toResponse(settlement, remaining);
    }

    /**
     * ADR 0023 §4 / Backend follow-up item 6 — <strong>the counterpart's
     * membership, {@code 404} and never {@code 403}.</strong>
     *
     * <p>A non-member counterpart is indistinguishable from a non-existent group
     * here, which is the point: {@code 404 GROUP_NOT_FOUND} reveals nothing about
     * whether that account or contact exists. The caller's own membership is
     * already proved by the time this runs, so the response cannot be used to
     * probe the group either.
     */
    private void requireCounterpartMembership(UUID groupId, CreateSettlementRequest request) {
        boolean member = request.counterpartUserId() != null
                ? memberRepository.existsByGroupIdAndUserId(groupId, request.counterpartUserId())
                : memberRepository.existsByGroupIdAndInvitedContactId(
                        groupId, request.counterpartContactId());
        if (!member) {
            throw new GroupNotFoundException();
        }
    }

    /**
     * <strong>The direction, read off the ledger</strong> (ADR 0023 §4 bullet 2).
     *
     * <p>The debtor is the negative position and the creditor the positive one.
     * Zero on either side, or two positions with the same sign, is
     * {@code 400 VALIDATION_ERROR} — not a guess, and not a silently reversed
     * settlement. This is also what makes {@code V12}'s absent
     * {@code CHECK (counterpart_user_id <> initiated_by_user_id)} unnecessary:
     * one row cannot be both debtor and creditor.
     */
    private static Direction deriveDirection(
            GroupMemberBalance callerBalance, GroupMemberBalance counterpartBalance) {
        BigDecimal caller = callerBalance.getBalance();
        BigDecimal counterpart = counterpartBalance.getBalance();
        if (caller == null || counterpart == null
                || caller.signum() == 0 || counterpart.signum() == 0
                || caller.signum() == counterpart.signum()) {
            throw SplitRuleViolationException.settlementDirectionContradictsLedger();
        }
        return caller.signum() < 0
                ? new Direction(callerBalance, counterpartBalance)
                : new Direction(counterpartBalance, callerBalance);
    }

    /**
     * {@code amount <= min(|debtor's balance|, creditor's balance)} (ADR 0023 §4
     * bullet 3) — "without it, X paying Y more than Y is owed would push Y into a
     * debt the settlement itself created".
     *
     * <p>This is the <em>pre-read</em> half, which produces the clean error. The
     * authoritative half is each UPDATE's own predicate, which is what makes the
     * bound race-safe ({@code V12} contract item 3).
     */
    private static void requireWithinLesserPosition(Direction direction, BigDecimal amount) {
        BigDecimal debtorPosition = direction.debtor().getBalance().abs();
        BigDecimal creditorPosition = direction.creditor().getBalance();
        BigDecimal bound = debtorPosition.min(creditorPosition);
        if (amount.compareTo(bound) > 0) {
            throw new AmountExceedsBalanceException();
        }
    }

    // =====================================================================
    // Individual target
    // =====================================================================

    private SettlementResponse settleIndividual(
            UUID userId, CreateSettlementRequest request, UUID requestedId, WriteContext context) {
        // Step 1 — "a party to this pair", 404 for unknown-or-not-mine. Or, since
        // ADR 0027 §7.2, the pair of one of the caller's own contacts, resolved by
        // the split path's rule but never created: no row = outstanding 0.
        UUID balanceId = request.individualBalanceId();
        if (balanceId == null) {
            Contact contact = contactRepository
                    .findByIdAndOwnerUserId(request.individualCounterpartContactId(), userId)
                    .orElseThrow(ContactNotFoundException::notFound);
            balanceId = individualBalanceService.findPair(userId, contact)
                    .map(IndividualBalance::getId)
                    .orElse(null);
            if (balanceId == null) {
                requireExpectedDirection(request.expectedDirection(), BigDecimal.ZERO);
                throw new AmountExceedsBalanceException();
            }
        }
        IndividualBalance row = individualBalanceService.requireParty(userId, balanceId);
        // ADR 0027 §7.3, before any write.
        BigDecimal callerPosition = individualBalanceService.orientToCaller(row, userId);
        requireExpectedDirection(request.expectedDirection(), callerPosition);
        // ADR 0028 §7.4: a negative position from the caller's side means the
        // caller owes, i.e. the caller pays. (A zero position is rejected by
        // reducePosition below before anything is written.)
        boolean callerPaid = callerPosition.signum() < 0;

        // Steps 2 and 3 — the direction is the row's own sign, and the bound lives
        // in the UPDATE's predicate.
        IndividualBalance moved = individualBalanceService.reducePosition(row, request.amount());

        // Step 4.
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        // INSERT only (ADR 0027 §3.3): persist, never merge.
        Settlement settlement = entityInserter.insert(Settlement.builder()
                .id(requestedId != null ? requestedId : UUID.randomUUID())
                .groupId(null)
                .individualBalanceId(row.getId())
                .initiatedByUserId(userId)
                // BOTH null — chk_settlements_counterpart_matches_target, and
                // ADR 0023 §4's reason: the individual_balances row IS the pair,
                // so a counterpart column would restate what the FK already says.
                .counterpartUserId(null)
                .counterpartContactId(null)
                .amount(request.amount())
                .method(request.method())
                .initiatorIsPayer(callerPaid)
                .settledAt(now)
                .build());

        // Step 5.
        UUID counterpartUserId = IndividualBalanceService.counterpartUserIdOf(row, userId);
        Set<UUID> affected = new LinkedHashSet<>();
        affected.add(userId);
        if (counterpartUserId != null) {
            affected.add(counterpartUserId);
        }
        BigDecimal remaining = individualBalanceService.orientToCaller(moved, userId);
        UUID changeLogId = logSettlement(userId, settlement, request, remaining, context);
        String callerName = userName(userId);
        String counterpartName = counterpartName(counterpartUserId, row.getCounterpartContactId());
        Map<UUID, BigDecimal> remainingByRecipient = new LinkedHashMap<>();
        remainingByRecipient.put(userId, remaining);
        if (counterpartUserId != null) {
            remainingByRecipient.put(counterpartUserId, individualBalanceService.orientToCaller(moved, counterpartUserId));
        }
        activityFanoutService.fanOutSettlement(new ActivityFanoutService.SettlementFanout(
                false,
                userId,
                callerPaid ? userId : counterpartUserId,
                callerPaid ? callerName : counterpartName,
                callerPaid ? counterpartUserId : userId,
                callerPaid ? counterpartName : callerName,
                null,
                null,
                // ADR 0009 §6.3: relatedContactId in individual mode. Null when the
                // counterpart is a registered account, because there is no contact
                // to point at.
                row.getCounterpartContactId(),
                request.amount(),
                affected,
                changeLogId,
                remainingByRecipient));

        logSettled(settlement, userId, affected.size());
        // Oriented to the caller, by the same single method §8.1 uses — see
        // SettlementResponse's Javadoc for why the raw stored value would
        // contradict that endpoint.
        return toResponse(settlement, remaining);
    }

    // =====================================================================
    // Request-shape validation
    // =====================================================================

    private static void validateTargetShape(boolean groupTarget, CreateSettlementRequest request) {
        if (groupTarget) {
            if (request.groupId() == null) {
                throw SplitRuleViolationException.groupIdRequiredForGroupTarget();
            }
            if (request.individualBalanceId() != null || request.individualCounterpartContactId() != null) {
                throw SplitRuleViolationException.targetIdsContradictTarget();
            }
            boolean byUser = request.counterpartUserId() != null;
            boolean byContact = request.counterpartContactId() != null;
            if (byUser == byContact) {
                throw SplitRuleViolationException.exactlyOneSettlementCounterpartRequired();
            }
            return;
        }

        // ADR 0027 §7.2: exactly one of the two individual targets.
        if (request.individualBalanceId() != null && request.individualCounterpartContactId() != null) {
            throw WriteRequestValidationException.individualTargetExactlyOne();
        }
        if (request.individualBalanceId() == null && request.individualCounterpartContactId() == null) {
            throw SplitRuleViolationException.individualBalanceIdRequiredForIndividualTarget();
        }
        if (request.groupId() != null) {
            throw SplitRuleViolationException.targetIdsContradictTarget();
        }
        if (request.counterpartUserId() != null || request.counterpartContactId() != null) {
            throw SplitRuleViolationException.settlementCounterpartNotAllowedForIndividualTarget();
        }
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    /** The two sides of a group settlement, after the ledger has decided which is which. */
    private record Direction(GroupMemberBalance debtor, GroupMemberBalance creditor) {
    }

    private SettlementResponse toResponse(Settlement settlement, BigDecimal remainingBalance) {
        SettlementPartiesResolver.Parties parties = partiesResolver.resolve(List.of(settlement))
                .getOrDefault(settlement.getId(), SettlementPartiesResolver.Parties.LEGACY);
        return new SettlementResponse(
                settlement.getId(),
                settlement.getGroupId(),
                settlement.getIndividualBalanceId(),
                settlement.getInitiatedByUserId(),
                settlement.getAmount(),
                settlement.getMethod(),
                remainingBalance,
                settlement.getSettledAt(),
                settlement.getCreatedAt(),
                parties.payer(),
                parties.payee());
    }

    private String userName(UUID userId) {
        return userRepository.findMemberNamesByIdIn(List.of(userId)).stream()
                .findFirst()
                .map(MemberNameRow::name)
                .orElse("");
    }

    private String counterpartName(UUID counterpartUserId, UUID counterpartContactId) {
        if (counterpartUserId != null) {
            return userName(counterpartUserId);
        }
        if (counterpartContactId == null) {
            return "";
        }
        return contactRepository.findMemberNamesByIdIn(List.of(counterpartContactId)).stream()
                .findFirst()
                .map(MemberNameRow::name)
                .orElse("");
    }

    private String groupName(UUID groupId) {
        return groupRepository.findById(groupId).map(group -> group.getName()).orElse("");
    }

    /**
     * The caller's membership gate. {@code false} is
     * {@code 404 GROUP_NOT_FOUND} — never {@code 403}, and never a different
     * message for the two cases it covers.
     *
     * <p>Nothing is logged on the rejection path: a membership failure is a normal
     * client outcome rather than an unexpected exception (constitution §23's
     * allowed list), and a debug line here would be exactly the kind of logging
     * that must not survive into a production build.
     */
    private void requireMembership(UUID groupId, UUID userId) {
        if (!memberRepository.existsByGroupIdAndUserId(groupId, userId)) {
            throw new GroupNotFoundException();
        }
    }

    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }

    private void logSettled(Settlement settlement, UUID userId, int affectedMembers) {
        // Never the amount — a settlement amount is personal financial information
        // (constitution §23). Ids, the method, and the fan-out size only.
        log.info("Settlement recorded by user {} (id={}, group={}, individualBalance={}, "
                        + "method={}, affectedMembers={})",
                userId, settlement.getId(), settlement.getGroupId(),
                settlement.getIndividualBalanceId(), settlement.getMethod(), affectedMembers);
    }
}
