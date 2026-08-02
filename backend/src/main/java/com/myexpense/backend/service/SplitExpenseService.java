package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.CreateSplitExpenseRequest;
import com.myexpense.backend.dto.request.ListSplitExpensesQuery;
import com.myexpense.backend.dto.request.SplitParticipantRequest;
import com.myexpense.backend.dto.response.SplitExpenseResponse;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.GroupMember;
import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.entity.PaymentMode;
import com.myexpense.backend.entity.SplitExpense;
import com.myexpense.backend.entity.SplitExpenseIndividualBalance;
import com.myexpense.backend.entity.SplitExpenseParticipant;
import com.myexpense.backend.entity.SplitExpensePayer;
import com.myexpense.backend.entity.SplitMode;
import com.myexpense.backend.entity.Transaction;
import com.myexpense.backend.entity.TransactionScope;
import com.myexpense.backend.entity.TransactionType;
import com.myexpense.backend.exception.GroupNotFoundException;
import com.myexpense.backend.exception.IdConflictException;
import com.myexpense.backend.exception.SplitExpenseNotFoundException;
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
import com.myexpense.backend.repository.SplitExpenseIndividualBalanceRepository;
import com.myexpense.backend.repository.SplitExpenseRepository;
import com.myexpense.backend.repository.TransactionRepository;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.service.SplitRevisionWriter.Names;

/**
 * Business rules for Split expenses (api-overview.md §9.1–§9.3) — Domain 6
 * sub-step 3, and <strong>the write path that triggers this domain's central
 * correctness contract</strong> (ADR 0014 §2).
 *
 * <h2>§9.1's four steps, in one transaction, in this order</h2>
 *
 * <ol>
 *   <li><strong>Re-validate the participant sum</strong> — exactly to
 *       {@code amount}. The client's identical check is UX only
 *       (security-architecture.md §3) and no constraint can express this one
 *       ({@code V11} contract item 2).</li>
 *   <li><strong>Recalculate balances for every affected member</strong> —
 *       {@code group_member_balances} or every moved {@code individual_balances}
 *       row — transactionally, by relative delta, never read-modify-write.</li>
 *   <li><strong>Create the caller's CONSUMPTION-SHARE transaction</strong> if
 *       asked, and <em>never</em> for the full {@code amount}
 *       ({@code V11} contract item 3: "getting it wrong inflates the user's own
 *       spending by the whole group's bill and the error is invisible in every
 *       response"). Then the back-reference, in that order, because the two
 *       tables point at each other.</li>
 *   <li><strong>Fan out {@code activities} and {@code notifications}</strong> to
 *       every affected member, in this same transaction.</li>
 * </ol>
 *
 * <h2>Authorization is membership or pair-party, never ownership</h2>
 *
 * <p>All three endpoints are membership-gated (V10's RULE 1, ADR 0014 §2
 * Consequence 1). {@code split_expenses.created_by_user_id} is a record, not a
 * permission: every member of a group may read and reference a split another
 * member created. A group target is checked against {@code group_members}; a pair
 * target is checked with {@link IndividualBalanceService}'s "is the caller a party
 * to this pair". Unknown and not-mine are one identical {@code 404}, never a
 * {@code 403}.
 *
 * <h2>Identities are named the way the target stores them</h2>
 *
 * <p><strong>Group mode:</strong> a participant and the payer must be named
 * exactly as {@code group_members} holds them — a {@code participantUserId} for a
 * registered member, a {@code participantContactId} for an invited-contact
 * placeholder. {@code GET /groups/{id}} returns precisely those two keys per
 * member (§7.1), so the client always has the right value to send. A derived rule,
 * flagged in backend/README.md §16.6: §9.1 does not say it, and the alternative
 * (accepting a contact id for a member who joined as a linked account) would need
 * this service to resolve a contact it may not own.
 *
 * <p><strong>Individual mode:</strong> a counterpart may be named either way and
 * is <em>normalised</em> — a linked contact's id maps to its
 * {@code linked_user_id}, exactly as §7.2 does for group membership ("a linked
 * contact joins as the real account"). That is what keeps the two parties of a
 * canonical pair row addressable by a client that only knows contacts.
 *
 * <h2>Multi-contact individual splits (ADR 0026, 2026-11-11)</h2>
 *
 * <p>An individual split has one or more counterparts
 * ({@code individualCounterpartContactId} or {@code individualCounterpartContactIds}).
 * All debts route through the creator: each creator↔counterpart pair row moves by
 * that counterpart's {@code net_c = paid_c − share_c}, oriented to the row's left
 * side. The pure rules live in {@link IndividualSplitRules}; pairs are resolved
 * and moved in {@link IndividualBalanceService#resolvePairs}' lock order; every
 * moved pair gets a {@code split_expense_individual_balances} row, and the primary
 * (first) counterpart's pair is written to {@code split_expenses.individual_balance_id}.
 * Reads answer "which pairs / is the viewer a party / which splits belong to this
 * pair" from the link table only (ADR 0026 §3). One-contact requests behave
 * exactly as before.
 *
 * <h2>The transactional-rollback audit for this class</h2>
 *
 * <p><strong>No {@code noRollbackFor}, and it is a conclusion rather than an
 * omission</strong> (backend/README.md §3's trap, which ADR 0023 flagged this
 * domain as the next place to wait in). Every user-facing rejection on all three
 * endpoints is decided <em>before</em> the first write: Bean Validation (including
 * each {@code payers[]} entry), the target shape, the payer form (legacy pair XOR
 * {@code payers[]}), the payer and participant XORs, both duplicate checks, the
 * participant sum, the payer sum, the membership of the caller <em>and</em> of
 * every participant and every payer, the category resolution, and the self-pair
 * refusal (ADR 0025 §4.3). The three things that can throw
 * afterwards are exactly the three where a rollback is the point:
 * <ul>
 *   <li>a constraint violation, which means the row never landed;</li>
 *   <li>{@code GroupBalanceService}'s consistency assertion — committing a group
 *       whose balances do not reconcile is strictly worse than failing the
 *       request;</li>
 *   <li>an incomplete fan-out, where an event half the group heard about is worse
 *       than one nobody heard about.</li>
 * </ul>
 * <strong>There is no irreversible side effect on this path at all</strong> — no
 * SMS, no external call — which is what makes the audit short. Since ADR 0026
 * (§4.6) there is no longer an ordering subtlety in individual mode either: the
 * counterpart form, the owner-scoped contact load ({@code 404}), the self-link and
 * same-person checks, payer and participant normalisation with their
 * post-normalisation duplicate checks, and the zero-sum assertion all run
 * <em>before</em> {@code individual_balances}' resolve-or-create, which is now the
 * first write.
 *
 * <h2>Multiple payers (ADR 0025, 2026-11-06)</h2>
 *
 * <p>A split has one or more payers, stored in {@code split_expense_payers}. The
 * request-shape rules live in {@link SplitPayerResolver}; the rules that need the
 * resolved target (membership, pair normalisation) stay here. The primary payer
 * (largest amount, tie: first in request order) is written to
 * {@code split_expenses.paid_by_*}. Every identity's balance moves by
 * {@code net = paid − share}. The consumption-share transaction is unaffected: it
 * reads the caller's participant share only, never a payer amount (ADR 0025 §7).
 *
 * <h2>Why this class writes {@code transactions} directly</h2>
 *
 * <p>Through {@link TransactionRepository}, not {@code TransactionService} — the
 * same arrangement {@code CategoryService} already documents for its three bulk
 * statements. §9.1 step 3 is a split-domain business rule that happens to write a
 * row on another table; routing it through that service would add a pass-through
 * method carrying no logic of its own while coupling two services, and
 * constitution §5 allows a business-layer class to use more than one repository.
 * It also must <em>not</em> go through {@code POST /transactions}' own rules: that
 * endpoint still answers {@code 403 NOT_GROUP_MEMBER} for any group-scoped write
 * while its membership check is vacuous (backend/README.md §15.8), and this row is
 * written for a caller whose membership has just been proved.
 */
@Service
public class SplitExpenseService {

    private static final Logger log = LoggerFactory.getLogger(SplitExpenseService.class);

    /**
     * {@code transactions.version} starts at {@code 1} (api-overview.md §4.1, and
     * the column's own default). Declared here rather than reached for across
     * services — one duplicated literal is acceptable (constitution §25's
     * "duplicate once"), and the alternative is a dependency on
     * {@code TransactionService} for a constant.
     */
    private static final int INITIAL_TRANSACTION_VERSION = 1;

    /**
     * The payment mode a split-originated transaction carries.
     *
     * <p><strong>Not an invented default</strong>: it is the fallback the shipped
     * frontend already uses on this exact write ({@code SplitAddExpenseScreen}
     * sends {@code paymentMode: 'cash'} with the comment "same [ASSUMPTION]
     * fallback {@code AddExpenseScreen} already uses when Payment Mode tracking is
     * off/not applicable — not a new invented default (ADR 0005 §6.2)"). §9.1
     * carries no payment-mode field and {@code transactions.payment_mode} is
     * {@code NOT NULL} with no "unspecified" value, so some value must be chosen;
     * choosing the one the client already sends keeps the two paths producing
     * identical rows. Flagged in backend/README.md §16.6.
     */
    private static final PaymentMode SPLIT_TRANSACTION_PAYMENT_MODE = PaymentMode.CASH;

    /** ADR 0028 §3.2: a new split, and its child rows, start at revision 1. */
    static final int FIRST_REVISION = 1;

    private final SplitExpenseRepository splitExpenseRepository;
    private final SplitExpenseIndividualBalanceRepository pairLinkRepository;
    private final TransactionRepository transactionRepository;
    private final GroupRepository groupRepository;
    private final GroupMemberRepository memberRepository;
    private final ContactRepository contactRepository;
    private final UserRepository userRepository;
    private final CategorySnapshotResolver categorySnapshotResolver;
    private final IndividualBalanceService individualBalanceService;
    private final SplitLedgerService splitLedgerService;
    private final SplitRevisionWriter revisionWriter;
    private final ActivityFanoutService activityFanoutService;
    private final SplitExpenseResponseAssembler responseAssembler;
    private final EntityInserter entityInserter;
    private final IdempotentWriteExecutor writeExecutor;
    private final ChangeLogWriter changeLogWriter;

    public SplitExpenseService(
            SplitExpenseRepository splitExpenseRepository,
            SplitExpenseIndividualBalanceRepository pairLinkRepository,
            TransactionRepository transactionRepository,
            GroupRepository groupRepository,
            GroupMemberRepository memberRepository,
            ContactRepository contactRepository,
            UserRepository userRepository,
            CategorySnapshotResolver categorySnapshotResolver,
            IndividualBalanceService individualBalanceService,
            SplitLedgerService splitLedgerService,
            SplitRevisionWriter revisionWriter,
            ActivityFanoutService activityFanoutService,
            SplitExpenseResponseAssembler responseAssembler,
            EntityInserter entityInserter,
            IdempotentWriteExecutor writeExecutor,
            ChangeLogWriter changeLogWriter) {
        this.entityInserter = entityInserter;
        this.writeExecutor = writeExecutor;
        this.changeLogWriter = changeLogWriter;
        this.splitExpenseRepository = splitExpenseRepository;
        this.pairLinkRepository = pairLinkRepository;
        this.transactionRepository = transactionRepository;
        this.groupRepository = groupRepository;
        this.memberRepository = memberRepository;
        this.contactRepository = contactRepository;
        this.userRepository = userRepository;
        this.categorySnapshotResolver = categorySnapshotResolver;
        this.individualBalanceService = individualBalanceService;
        this.splitLedgerService = splitLedgerService;
        this.revisionWriter = revisionWriter;
        this.activityFanoutService = activityFanoutService;
        this.responseAssembler = responseAssembler;
    }

    // =====================================================================
    // §9.1 — POST /split-expenses
    // =====================================================================

    /** {@code POST /api/v1/split-expenses} (§9.1) — {@code 201 Created}. */
    public WriteResult<SplitExpenseResponse> createSplitExpense(
            UUID userId, CreateSplitExpenseRequest request, WriteContext context) {
        UUID requestedId = ClientIds.requireNotNil(request.id(), "id");
        UUID requestedTransactionId = ClientIds.requireNotNil(request.personalTransactionId(), "personalTransactionId");
        // ADR 0027 §3.2: personalTransactionId only with addToPersonalExpenses.
        if (requestedTransactionId != null && !Boolean.TRUE.equals(request.addToPersonalExpenses())) {
            throw WriteRequestValidationException.personalTransactionIdNotAllowed();
        }
        if (requestedTransactionId != null && requestedTransactionId.equals(requestedId)) {
            throw WriteRequestValidationException.personalTransactionIdEqualsId();
        }
        // Not @Transactional: IdempotentWriteExecutor owns the boundary (ADR 0027 §4.3).
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.SPLIT_EXPENSE, ChangeLog.OPERATION_CREATE, requestedId),
                recorded -> WriteResult.created(currentIncludingDeleted(userId, recorded.getEntityId())),
                () -> doCreateSplitExpense(userId, request,
                        new ClientWrite(requestedId, requestedTransactionId, context)));
    }

    /** The two client-supplied ids of one split create and its write context (ADR 0027 §3.2). */
    private record ClientWrite(UUID splitId, UUID personalTransactionId, WriteContext context) {
    }

    private WriteResult<SplitExpenseResponse> doCreateSplitExpense(
            UUID userId, CreateSplitExpenseRequest request, ClientWrite ids) {
        requireUser(userId);

        // ADR 0027 §3.3 step 3 for BOTH ids, before any write, so they apply
        // atomically. Never save() with a client id.
        if (ids.splitId() != null) {
            SplitExpense existing = splitExpenseRepository.findById(ids.splitId()).orElse(null);
            if (existing != null) {
                if (!userId.equals(existing.getCreatedByUserId())) {
                    throw new IdConflictException();
                }
                return WriteResult.created(currentIncludingDeleted(userId, ids.splitId()));
            }
        }
        if (ids.personalTransactionId() != null
                && transactionRepository.existsById(ids.personalTransactionId())) {
            // The split is new, so a transaction already holding this id cannot be
            // this request's consumption share — whoever owns it. Rejected rather
            // than linked (deviation recorded in backend/README.md §21).
            throw new IdConflictException();
        }

        SplitMode mode = SplitMode.fromValue(request.splitMode());
        validateTargetShape(mode, request);

        // ADR 0025 §4.3 steps 3-5, in that order: payer form and identities,
        // participants and their sum, then the payer sum.
        List<PayerEntry> payers = payerEntries(SplitPayerResolver.resolve(request));
        List<Identity> participantIdentities = participantIdentities(request.participants());
        validateParticipantSum(request.amount(), request.participants());
        SplitPayerResolver.requireSumEquals(request.amount(), amountsOf(payers));

        CategorySnapshot snapshot =
                categorySnapshotResolver.resolveForSplitExpense(userId, request.categoryId());

        return WriteResult.created(mode == SplitMode.GROUP
                ? createGroupSplit(userId, request, payers, participantIdentities, snapshot, ids)
                : createIndividualSplit(userId, request, payers, participantIdentities, snapshot, ids));
    }

    /**
     * ADR 0027 §6.3: the primary {@code split_expense} row (with the key) and,
     * when a consumption share was created, a secondary {@code transaction} create
     * row (no key, no activity of its own). Written before the fan-out so the
     * actor's {@code split_saved} row links to the primary.
     */
    private UUID logSplit(UUID userId, CreateSplitExpenseRequest request, SplitExpense split,
            List<PayerEntry> payers, List<Identity> participantIdentities, UUID personalTransactionId,
            WriteContext context) {
        OffsetDateTime effectiveWriteAt = context.effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC));
        List<Map<String, Object>> payerValues = new ArrayList<>();
        for (PayerEntry payer : payers) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("userId", payer.identity().userId());
            entry.put("contactId", payer.identity().contactId());
            entry.put("amount", payer.amount());
            payerValues.add(entry);
        }
        List<Map<String, Object>> participantValues = new ArrayList<>();
        for (int i = 0; i < participantIdentities.size(); i++) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("userId", participantIdentities.get(i).userId());
            entry.put("contactId", participantIdentities.get(i).contactId());
            entry.put("amount", request.participants().get(i).amount());
            participantValues.add(entry);
        }
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("title", split.getTitle());
        fields.put("amount", split.getAmount());
        fields.put("splitDate", split.getSplitDate());
        fields.put("splitMode", request.splitMode());
        fields.put("groupId", split.getGroupId());
        fields.put("splitMethod", split.getSplitMethod());
        fields.put("categoryId", split.getCategoryId());
        fields.put("categoryName", split.getCategoryName());
        fields.put("counterparts", split.getGroupId() != null
                ? List.of() : IndividualSplitRules.counterpartContactIds(request));
        fields.put("payers", payerValues);
        fields.put("participants", participantValues);
        fields.put("addToPersonalExpenses", personalTransactionId != null);
        fields.put("personalTransactionId", personalTransactionId);
        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.SPLIT_EXPENSE, split.getId(),
                ChangeLog.OPERATION_CREATE, ChangeSets.create(fields), context, effectiveWriteAt, true);
        if (personalTransactionId != null) {
            transactionRepository.findById(personalTransactionId).ifPresent(transaction ->
                    changeLogWriter.logApplied(userId, ChangeLogEntityTypes.TRANSACTION, personalTransactionId,
                            ChangeLog.OPERATION_CREATE,
                            ChangeSets.create(TransactionService.loggedFields(transaction, true)),
                            context, effectiveWriteAt, false));
        }
        return changeLogId;
    }

    private SplitExpenseResponse createGroupSplit(
            UUID userId,
            CreateSplitExpenseRequest request,
            List<PayerEntry> payers,
            List<Identity> participantIdentities,
            CategorySnapshot snapshot,
            ClientWrite ids) {
        UUID groupId = request.groupId();
        requireMembership(groupId, userId);

        // The group's membership, read once. Both identity sets come from here, so
        // "is a member" is answered against the same rows the balance upserts will
        // key on — no second definition of membership.
        List<GroupMember> members = memberRepository.findByGroupIdOrderByCreatedAtAscIdAsc(groupId);
        Set<UUID> memberUserIds = new HashSet<>();
        Set<UUID> memberContactIds = new HashSet<>();
        for (GroupMember member : members) {
            if (member.getUserId() != null) {
                memberUserIds.add(member.getUserId());
            } else {
                memberContactIds.add(member.getInvitedContactId());
            }
        }

        // ADR 0025 R6: EVERY payer, not only the primary, must be a member.
        List<Identity> everyone = new ArrayList<>(participantIdentities);
        everyone.addAll(identitiesOf(payers));
        for (Identity identity : everyone) {
            boolean isMember = identity.userId() != null
                    ? memberUserIds.contains(identity.userId())
                    : memberContactIds.contains(identity.contactId());
            if (!isMember) {
                // 400, not 404: the caller is a member of this group and may read
                // its member list through §7.3, so nothing is being revealed —
                // the request is simply inconsistent with a group they can see.
                throw SplitRuleViolationException.notAGroupMember();
            }
        }

        // The caller is added to the name set even when they are neither a
        // participant nor the payer — a legal state (one member may record a split
        // between two others) — because the fan-out's notification sentence names
        // the ACTOR, not the payer.
        Names names = resolveNames(withCaller(everyone, userId));

        Identity primary = primaryPayer(payers);
        List<BigDecimal> shares = sharesOf(request.participants());

        // ADR 0028 §4.5: the group mutex, before the first write of every
        // group-ledger write. The category FOR SHARE (if any) was taken earlier,
        // which is the global lock order.
        splitLedgerService.lockGroupForLedgerWrite(groupId);

        // INSERT only (ADR 0027 §3.3): persist, never merge.
        SplitExpense split = entityInserter.insert(newSplitExpense(
                userId, request, snapshot, SplitMode.GROUP, groupId, null, primary, ids));
        List<SplitExpenseParticipant> participants = revisionWriter.persistParticipants(
                split.getId(), FIRST_REVISION, shares, participantIdentities, names);
        List<SplitExpensePayer> payerRows = revisionWriter.persistPayers(split.getId(), FIRST_REVISION, payers);

        // Step 2 — revision 1 applied (ADR 0028 §4.2: create = apply(1, +1)); each
        // member moves by net = paid − share (ADR 0025 §4.1), then the zero-sum
        // assertion, in this transaction (ADR 0023 Backend follow-up item 8).
        splitLedgerService.applyGroupCreate(groupId, split.getId(),
                SplitLedgerMath.counts(participantIdentities, identitiesOf(payers)));

        UUID personalTransactionId = createConsumptionShareTransaction(
                userId, request, snapshot, split.getId(), groupId, TransactionScope.GROUP,
                callerShare(participantIdentities, request.participants(), userId), ids);
        boolean addedToPersonalExpenses = personalTransactionId != null;

        // Step 4 — every registered member whose balance just moved, plus the
        // actor (V13 contract item 2: activities include the actor).
        Set<UUID> affected = new LinkedHashSet<>();
        affected.add(userId);
        for (Identity identity : everyone) {
            if (identity.userId() != null) {
                affected.add(identity.userId());
            }
        }
        UUID changeLogId = logSplit(userId, request, split, payers, participantIdentities,
                personalTransactionId, ids.context());
        Map<UUID, String> effectClauses = SplitEffectClauses.forGroup(
                affected, SplitLedgerMath.nets(payers, participantIdentities, shares), false);
        activityFanoutService.fanOutSplitSaved(new ActivityFanoutService.SplitSavedFanout(
                true,
                userId,
                names.userName(userId),
                fanoutPayers(payerRows, primary, names),
                null,
                List.of(),
                groupName(groupId),
                groupId,
                null,
                split.getId(),
                personalTransactionId,
                split.getTitle(),
                request.amount(),
                affected,
                changeLogId,
                effectClauses));

        logCreated(split, userId, participants.size(), addedToPersonalExpenses, affected.size());
        return buildResponse(split, addedToPersonalExpenses, personalTransactionId);
    }

    private SplitExpenseResponse createIndividualSplit(
            UUID userId,
            CreateSplitExpenseRequest request,
            List<PayerEntry> rawPayers,
            List<Identity> rawParticipants,
            CategorySnapshot snapshot,
            ClientWrite ids) {
        // ADR 0026 §4.6 steps 4-6. Every rejection below is decided BEFORE the
        // first write (stricter than before ADR 0026, when the pair upsert ran
        // ahead of normalisation): normalisation needs only the contacts, not the
        // pair rows.
        //
        // Owner-scoped, one query for every counterpart: an id belonging to
        // another account and an unknown id both fail to resolve, i.e. one
        // identical 404. §9.1's error table did not list CONTACT_NOT_FOUND
        // originally — flagged in backend/README.md §16.6 — and it is reused
        // rather than invented, because it is this API's existing code for exactly
        // this condition (§6.3, §7.2).
        List<UUID> contactIds = IndividualSplitRules.counterpartContactIds(request);
        List<Contact> contacts = IndividualSplitRules.inRequestOrder(
                contactIds, contactRepository.findByOwnerUserIdAndIdIn(userId, contactIds));
        IndividualSplitRules.requireValidCounterparts(userId, contacts);
        List<IndividualSplitRules.Counterpart> counterparts = IndividualSplitRules.counterpartsOf(contacts);

        Identity callerIdentity = Identity.ofUser(userId);

        // Step 7. ADR 0025 R7 for every payer, then R3 again: normalisation can
        // collapse a linked contact's id and its account's id onto one party,
        // which the as-sent duplicate check could not see. Payers before
        // participants, as before, so error precedence is unchanged.
        List<PayerEntry> payers = new ArrayList<>(rawPayers.size());
        for (PayerEntry raw : rawPayers) {
            payers.add(new PayerEntry(
                    IndividualSplitRules.normalise(raw.identity(), callerIdentity, counterparts),
                    raw.amount()));
        }
        requireDistinctPayers(payers);

        List<Identity> participantIdentities = new ArrayList<>(rawParticipants.size());
        for (Identity raw : rawParticipants) {
            participantIdentities.add(IndividualSplitRules.normalise(raw, callerIdentity, counterparts));
        }
        // Normalisation can collapse two spellings of one party onto one identity,
        // which would then be a duplicate participant the pre-normalised check
        // could not see.
        requireDistinct(participantIdentities);

        // Step 8 — net_c = paid_c − share_c per counterpart, and the zero-sum
        // assertion, all in memory before the first write (ADR 0026 §4.4).
        List<BigDecimal> shares = sharesOf(request.participants());
        List<BigDecimal> nets = new ArrayList<>(counterparts.size());
        for (IndividualSplitRules.Counterpart counterpart : counterparts) {
            nets.add(IndividualSplitRules.netOf(
                    counterpart.identity(), payers, participantIdentities, shares));
        }
        IndividualSplitRules.requireZeroSum(
                IndividualSplitRules.netOf(callerIdentity, payers, participantIdentities, shares), nets);

        List<Identity> everyone = new ArrayList<>(participantIdentities);
        everyone.addAll(identitiesOf(payers));
        for (IndividualSplitRules.Counterpart counterpart : counterparts) {
            everyone.add(counterpart.identity());
        }
        Names names = resolveNames(withCaller(everyone, userId), contacts);

        // Step 9 — THE one pair-resolution method (ADR 0023 §1.3), once per
        // contact, in ADR 0026 §4.5's canonical lock order. First write.
        Map<UUID, IndividualBalance> pairsByContactId =
                individualBalanceService.resolvePairs(userId, contacts);
        IndividualBalance primaryPair = pairsByContactId.get(contacts.get(0).getId());

        // Steps 10-11. The PRIMARY counterpart's pair (first in request order)
        // goes to split_expenses.individual_balance_id, so V11's CHECK holds and
        // legacy readers see a real pair (ADR 0026 §3).
        Identity primary = primaryPayer(payers);
        // INSERT only (ADR 0027 §3.3): persist, never merge.
        SplitExpense split = entityInserter.insert(newSplitExpense(
                userId, request, snapshot, SplitMode.INDIVIDUAL, null, primaryPair.getId(), primary,
                ids));
        revisionWriter.persistParticipants(split.getId(), FIRST_REVISION, shares, participantIdentities, names);
        List<SplitExpensePayer> payerRows = revisionWriter.persistPayers(split.getId(), FIRST_REVISION, payers);
        persistPairLinks(split.getId(), contacts, pairsByContactId);

        // Step 12 — one signed delta per pair row, applied in LOCK order. A delta
        // of exactly 0 is legal and still applied (it refreshes updated_at). No
        // database-level assertion: pair rows hold other splits' history.
        Map<UUID, Integer> indexByContactId = new HashMap<>();
        for (int i = 0; i < contacts.size(); i++) {
            indexByContactId.put(contacts.get(i).getId(), i);
        }
        for (Map.Entry<UUID, IndividualBalance> entry : pairsByContactId.entrySet()) {
            int index = indexByContactId.get(entry.getKey());
            individualBalanceService.applyDelta(
                    entry.getValue().getId(),
                    IndividualSplitRules.signedPairDelta(
                            entry.getValue(), userId, counterparts.get(index).identity(), nets.get(index)));
        }

        // Step 13 — unchanged (ADR 0026 §7): the creator's own participant share.
        UUID personalTransactionId = createConsumptionShareTransaction(
                userId, request, snapshot, split.getId(), null, TransactionScope.PERSONAL,
                shareOf(participantIdentities, request.participants(), callerIdentity), ids);
        boolean addedToPersonalExpenses = personalTransactionId != null;

        // Step 14 — the creator plus every registered counterpart.
        Set<UUID> affected = new LinkedHashSet<>();
        affected.add(userId);
        List<ActivityFanoutService.Counterpart> fanoutCounterparts = new ArrayList<>(counterparts.size());
        for (IndividualSplitRules.Counterpart counterpart : counterparts) {
            if (counterpart.identity().userId() != null) {
                affected.add(counterpart.identity().userId());
            }
            fanoutCounterparts.add(new ActivityFanoutService.Counterpart(
                    counterpart.identity().userId(), names.nameOf(counterpart.identity())));
        }

        // One counterpart: exactly the pre-ADR-0026 values, so the sentences stay
        // byte-identical. Single-payer sentences only use otherPartyName: with two
        // payers both parties paid, and each recipient's row names the other payer
        // instead (ADR 0025 §6.2).
        //
        // ADR 0008 §2.2: relatedContactId is the other participant's id in
        // individual mode. It is the ACTOR's own contact, and V13 explicitly
        // sanctions a fanned-out row referencing a contact owned by a different
        // member (the four related_* columns are navigation only). Noted in
        // backend/README.md §16.6. With 2+ counterparts no single contact is the
        // subject, so it is null on every row (ADR 0026 §6.4).
        boolean singleCounterpart = counterparts.size() == 1;
        String otherPartyName = null;
        if (singleCounterpart) {
            Identity counterpartIdentity = counterparts.get(0).identity();
            Identity otherParty = primary.equals(callerIdentity) ? counterpartIdentity : callerIdentity;
            otherPartyName = names.nameOf(otherParty);
        }
        UUID changeLogId = logSplit(userId, request, split, payers, participantIdentities,
                personalTransactionId, ids.context());
        List<SplitEffectClauses.PairParty> pairParties = new ArrayList<>(counterparts.size());
        for (int i = 0; i < counterparts.size(); i++) {
            Identity counterpartIdentity = counterparts.get(i).identity();
            pairParties.add(new SplitEffectClauses.PairParty(
                    counterpartIdentity.userId(), names.nameOf(counterpartIdentity), nets.get(i)));
        }
        Map<UUID, String> effectClauses = SplitEffectClauses.forIndividual(
                affected, userId, names.userName(userId), pairParties, false);
        activityFanoutService.fanOutSplitSaved(new ActivityFanoutService.SplitSavedFanout(
                false,
                userId,
                names.userName(userId),
                fanoutPayers(payerRows, primary, names),
                otherPartyName,
                List.copyOf(fanoutCounterparts),
                null,
                null,
                singleCounterpart ? contacts.get(0).getId() : null,
                split.getId(),
                personalTransactionId,
                split.getTitle(),
                request.amount(),
                affected,
                changeLogId,
                effectClauses));

        logCreated(split, userId, participantIdentities.size(), addedToPersonalExpenses,
                affected.size());
        return buildResponse(split, addedToPersonalExpenses, personalTransactionId);
    }

    // =====================================================================
    // §9.2 / §9.3 — reads
    // =====================================================================

    /**
     * {@code GET /api/v1/split-expenses/{id}} (§9.2) — membership-gated.
     *
     * <p>All three failure modes answer the identical
     * {@code 404 SPLIT_EXPENSE_NOT_FOUND}: the id does not exist, it targets a
     * group the caller is not in, or it targets a pair the caller is not party to.
     */
    @Transactional(readOnly = true)
    public SplitExpenseResponse getSplitExpense(UUID userId, UUID splitExpenseId) {
        requireUser(userId);
        // ADR 0028 §3.6: a deleted split is 404 here, like one that never existed.
        SplitExpense split = splitExpenseRepository.findById(splitExpenseId)
                .filter(row -> row.getDeletedAt() == null)
                .orElseThrow(SplitExpenseNotFoundException::new);
        if (!isVisibleTo(userId, split.getId(), split.getGroupId())) {
            throw new SplitExpenseNotFoundException();
        }
        return responseAssembler.assembleOne(split);
    }

    /**
     * Idempotent-replay read (ADR 0027 §4.3, ADR 0028 §6.5): the split in its
     * current state <strong>including a soft-deleted one</strong> ({@code deletedAt}
     * set), still visibility-gated. Never used by a plain read endpoint.
     */
    @Transactional(readOnly = true)
    public SplitExpenseResponse currentIncludingDeleted(UUID userId, UUID splitExpenseId) {
        SplitExpense split = splitExpenseRepository.findById(splitExpenseId)
                .orElseThrow(SplitExpenseNotFoundException::new);
        if (!isVisibleTo(userId, split.getId(), split.getGroupId())) {
            throw new SplitExpenseNotFoundException();
        }
        return responseAssembler.assembleOne(split);
    }

    /**
     * The one visibility rule for a split (§9.2): a group split is visible to a
     * group member; an individual split to a party of ANY pair row it moved, read
     * from the link table — never from the deprecated
     * {@code split_expenses.individual_balance_id} (ADR 0026 §5.3).
     */
    @Transactional(readOnly = true)
    public boolean isVisibleTo(UUID userId, UUID splitExpenseId, UUID groupId) {
        return groupId != null
                ? memberRepository.existsByGroupIdAndUserId(groupId, userId)
                : individualBalanceService.isCallerPartyToAny(userId, linkedPairIds(splitExpenseId));
    }

    /**
     * {@code GET /api/v1/split-expenses} (§9.3) — exactly one of {@code groupId} or
     * {@code individualBalanceId}, membership-gated, <strong>not
     * paginated</strong> per the contract.
     *
     * <p>The filter check runs before the membership check so an ambiguous request
     * is a {@code 400} rather than a {@code 404} against whichever id happened to
     * be read first.
     */
    @Transactional(readOnly = true)
    public List<SplitExpenseResponse> listSplitExpenses(UUID userId, ListSplitExpensesQuery query) {
        requireUser(userId);

        boolean byGroup = query.getGroupId() != null;
        boolean byPair = query.getIndividualBalanceId() != null;
        if (byGroup == byPair) {
            throw SplitRuleViolationException.exactlyOneListFilterRequired();
        }

        if (byGroup) {
            requireMembership(query.getGroupId(), userId);
            return responseAssembler.assemble(
                    splitExpenseRepository.findByGroupIdAndDeletedAtIsNullOrderBySplitDateDescIdAsc(
                            query.getGroupId()));
        }
        individualBalanceService.requireParty(userId, query.getIndividualBalanceId());
        // Every split with a LINK row to this pair (ADR 0026 §5.3), so a
        // multi-contact split appears under each pair it moved.
        return responseAssembler.assemble(
                splitExpenseRepository.findMovingIndividualBalance(query.getIndividualBalanceId()));
    }

    List<UUID> linkedPairIds(UUID splitExpenseId) {
        return pairLinkRepository.findBySplitExpenseIdIn(List.of(splitExpenseId)).stream()
                .map(SplitExpenseIndividualBalance::getIndividualBalanceId)
                .toList();
    }

    // =====================================================================
    // Request-shape validation (§9.1)
    // =====================================================================

    /** The target shape, including ADR 0026 §5.1's counterpart form (C1-C4). */
    private static void validateTargetShape(SplitMode mode, CreateSplitExpenseRequest request) {
        if (mode == SplitMode.GROUP) {
            if (request.groupId() == null) {
                throw SplitRuleViolationException.groupIdRequiredForGroupMode();
            }
            IndividualSplitRules.requireNoCounterpartForGroupMode(request);
            return;
        }
        IndividualSplitRules.requireExactlyOneCounterpartForm(request);
        if (request.groupId() != null) {
            throw SplitRuleViolationException.groupIdNotAllowedForIndividualMode();
        }
    }

    /** {@link SplitPayerResolver}'s output as this class's {@link Identity} type. */
    static List<PayerEntry> payerEntries(List<SplitPayerResolver.RequestedPayer> requested) {
        List<PayerEntry> entries = new ArrayList<>(requested.size());
        for (SplitPayerResolver.RequestedPayer payer : requested) {
            entries.add(new PayerEntry(new Identity(payer.userId(), payer.contactId()), payer.amount()));
        }
        return entries;
    }

    /** ADR 0025 R3 after individual-mode normalisation. */
    static void requireDistinctPayers(List<PayerEntry> payers) {
        if (new HashSet<>(identitiesOf(payers)).size() != payers.size()) {
            throw SplitRuleViolationException.duplicatePayer();
        }
    }

    /** ADR 0025 §3: largest amount, tie: first in request order. */
    static Identity primaryPayer(List<PayerEntry> payers) {
        return payers.get(SplitPayerResolver.primaryIndex(amountsOf(payers))).identity();
    }

    static List<Identity> identitiesOf(List<PayerEntry> payers) {
        return payers.stream().map(PayerEntry::identity).toList();
    }

    static List<BigDecimal> amountsOf(List<PayerEntry> payers) {
        return payers.stream().map(PayerEntry::amount).toList();
    }

    static List<Identity> participantIdentities(List<SplitParticipantRequest> participants) {
        List<Identity> identities = new ArrayList<>(participants.size());
        for (SplitParticipantRequest participant : participants) {
            boolean byUser = participant.participantUserId() != null;
            boolean byContact = participant.participantContactId() != null;
            if (byUser == byContact) {
                throw SplitRuleViolationException.exactlyOneParticipantIdentityRequired();
            }
            identities.add(byUser
                    ? Identity.ofUser(participant.participantUserId())
                    : Identity.ofContact(participant.participantContactId()));
        }
        requireDistinct(identities);
        return identities;
    }

    static void requireDistinct(List<Identity> identities) {
        if (new HashSet<>(identities).size() != identities.size()) {
            throw SplitRuleViolationException.duplicateParticipant();
        }
    }

    /**
     * <strong>§9.1 step 1.</strong> Exact decimal comparison, not a tolerance: both
     * sides are already constrained to two decimal places by
     * {@code @Digits(fraction = 2)}, so {@code numeric(12,2)} will store exactly
     * what was compared.
     */
    static void validateParticipantSum(
            BigDecimal amount, List<SplitParticipantRequest> participants) {
        BigDecimal sum = BigDecimal.ZERO;
        for (SplitParticipantRequest participant : participants) {
            sum = sum.add(participant.amount());
        }
        if (sum.compareTo(amount) != 0) {
            throw SplitRuleViolationException.participantAmountsDoNotSumToAmount();
        }
    }

    // =====================================================================
    // Writes
    // =====================================================================

    private SplitExpense newSplitExpense(
            UUID userId,
            CreateSplitExpenseRequest request,
            CategorySnapshot snapshot,
            SplitMode mode,
            UUID groupId,
            UUID individualBalanceId,
            Identity payer,
            ClientWrite ids) {
        UUID requestedId = ids.splitId();
        SplitExpense split = SplitExpense.builder()
                // ADR 0027 §3.2: the client-supplied id when sent, already checked.
                .id(requestedId != null ? requestedId : UUID.randomUUID())
                // ADR 0028 §3.2/§3.4: revision 1, and the LWW clock starts at the
                // create's effective write time.
                .revision(FIRST_REVISION)
                .lastClientWriteAt(ids.context().effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC)))
                .createdByUserId(userId)
                .title(request.title().trim())
                .splitDate(request.splitDate())
                .amount(request.amount())
                .splitMode(mode)
                // Exactly one target, and the other column is nulled EXPLICITLY —
                // chk_split_expenses_target_matches_mode is "the most likely of
                // the six to surface during implementation: it fires if the
                // service fills both target columns, or neither" (V11).
                .groupId(groupId)
                .individualBalanceId(individualBalanceId)
                .splitMethod(request.splitMethod())
                // The PRIMARY payer (ADR 0025 §3), so V11's
                // chk_split_expenses_paid_by_user_xor_contact holds on every row.
                // Written, never read to answer "who paid": that is
                // split_expense_payers' job.
                .paidByUserId(payer.userId())
                .paidByContactId(payer.contactId())
                // Inserted FALSE and corrected afterwards, which is the only legal
                // order: at this moment personal_transaction_id must be null
                // because that row does not exist yet, and
                // chk_split_expenses_personal_transaction_requires_flag forbids a
                // back-reference on a false flag but not the reverse (V11's
                // CIRCULAR REFERENCE block). It is also what the row KEEPS when
                // the caller's share turns out to be zero — see
                // createConsumptionShareTransaction.
                .addedToPersonalExpenses(false)
                .personalTransactionId(null)
                .build();
        snapshot.applyTo(split);
        return split;
    }

    /** The participant amounts, index-aligned with the participant identities. */
    static List<BigDecimal> sharesOf(List<SplitParticipantRequest> participants) {
        return participants.stream().map(SplitParticipantRequest::amount).toList();
    }

    /**
     * <strong>§9.1 step 3 — the caller's OWN consumption share, never the full
     * amount.</strong>
     *
     * <p>{@code V11} contract item 3 calls this "the single most valuable assertion
     * to put in an integration test for this sub-step, because getting it wrong
     * inflates the user's own spending by the whole group's bill and the error is
     * invisible in every response".
     *
     * <p><strong>A zero share writes nothing, and the stored flag becomes
     * {@code false}.</strong> The shipped frontend does exactly this
     * ({@code if (addToExpenses && finalYourShare > 0)}), so rejecting would break
     * a legal payload; and {@code chk_transactions_amount_positive} would reject a
     * zero-amount row anyway. Storing the flag as what <em>happened</em> is what
     * keeps §4.6's "set iff the flag is true" true in both directions — the half no
     * CHECK can hold ({@code V11} FLAG 5(b)). Flagged in backend/README.md §16.6.
     *
     * <p>The write order is {@code V11}'s CIRCULAR REFERENCE block's, and it is the
     * only one that works: the split expense row exists (inserted with a null
     * back-reference), then this transaction row pointing at it, then the
     * back-reference.
     *
     * @return the new transaction's id, or {@code null} when nothing was created
     */
    private UUID createConsumptionShareTransaction(
            UUID userId,
            CreateSplitExpenseRequest request,
            CategorySnapshot snapshot,
            UUID splitExpenseId,
            UUID groupId,
            TransactionScope scope,
            BigDecimal callerShare,
            ClientWrite ids) {
        if (!Boolean.TRUE.equals(request.addToPersonalExpenses())
                || callerShare == null
                || callerShare.signum() <= 0) {
            return null;
        }

        // ADR 0027 §3.2: personalTransactionId when sent (existence already
        // checked); client_id = id as on every new transaction (§3.5).
        UUID transactionId = ids.personalTransactionId() != null ? ids.personalTransactionId() : UUID.randomUUID();
        Transaction transaction = Transaction.builder()
                .id(transactionId)
                .userId(userId)
                .title(request.title().trim())
                .txnDate(request.splitDate())
                // §9.1 carries no time field and transactions.txn_time is NOT
                // NULL, so the moment of save is the value — which is also what
                // the shipped frontend sends for this same row
                // ("this screen gains no TIME UI of its own"). Flagged in
                // backend/README.md §16.6.
                .txnTime(LocalTime.now(ZoneOffset.UTC))
                // THE CONSUMPTION SHARE. Never request.amount().
                .amount(callerShare)
                .type(TransactionType.EXPENSE)
                // A group split's own row is group-scoped; an INDIVIDUAL split's
                // is scope='personal' with groupId null — the shipped frontend's
                // own precedent, and Transaction's Javadoc warns that "group scope
                // is not a synonym for 'came from a split'".
                .scope(scope)
                .groupId(groupId)
                .paymentMode(SPLIT_TRANSACTION_PAYMENT_MODE)
                .cashAmount(null)
                .onlineAmount(null)
                .notes(null)
                .receiptPublicId(null)
                .clientId(transactionId)
                .version(INITIAL_TRANSACTION_VERSION)
                .splitExpenseId(splitExpenseId)
                .lastClientWriteAt(ids.context().effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC)))
                .build();
        snapshot.applyTo(transaction);

        // INSERT only (ADR 0027 §3.3). attachPersonalTransaction below also sets
        // added_to_personal_expenses = true — preserved, do not change.
        Transaction saved = entityInserter.insert(transaction);
        int attached = splitExpenseRepository.attachPersonalTransaction(
                splitExpenseId, saved.getId(), OffsetDateTime.now(ZoneOffset.UTC));
        if (attached != 1) {
            // A missing back-reference is exactly the half of §4.6's iff no
            // constraint can hold, so it fails loudly rather than leaving a
            // transaction nothing links to.
            throw new IllegalStateException(
                    "Failed to attach the consumption-share transaction to split expense "
                            + splitExpenseId);
        }
        return saved.getId();
    }

    /**
     * ADR 0026 §4.6 step 11: one {@code split_expense_individual_balances} row per
     * counterpart, in request order, in this transaction. Insert-only
     * (ADR 0024 §1, ADR 0026 §2.4); both timestamps are set by the entity.
     */
    private void persistPairLinks(
            UUID splitExpenseId, List<Contact> contacts, Map<UUID, IndividualBalance> pairsByContactId) {
        List<SplitExpenseIndividualBalance> rows = new ArrayList<>(contacts.size());
        for (Contact contact : contacts) {
            rows.add(SplitExpenseIndividualBalance.builder()
                    .id(UUID.randomUUID())
                    .splitExpenseId(splitExpenseId)
                    .individualBalanceId(pairsByContactId.get(contact.getId()).getId())
                    .build());
        }
        pairLinkRepository.saveAllAndFlush(rows);
    }

    /**
     * The payers in ADR 0025 §5.2's response order, with names, for the activity
     * sentences — ordered by the same method the response uses, so the feed and
     * the screen list payers identically (ADR 0025 §6.1).
     */
    static List<ActivityFanoutService.Payer> fanoutPayers(
            List<SplitExpensePayer> payerRows, Identity primary, Names names) {
        List<ActivityFanoutService.Payer> payers = new ArrayList<>(payerRows.size());
        for (SplitExpensePayer row : SplitExpenseResponseAssembler.orderForResponse(
                payerRows, primary.userId(), primary.contactId())) {
            Identity identity = new Identity(row.getPayerUserId(), row.getPayerContactId());
            payers.add(new ActivityFanoutService.Payer(identity.userId(), names.nameOf(identity)));
        }
        return List.copyOf(payers);
    }

    // =====================================================================
    // Shared helpers
    // =====================================================================

    private static BigDecimal callerShare(
            List<Identity> identities, List<SplitParticipantRequest> requested, UUID callerId) {
        return shareOf(identities, requested, Identity.ofUser(callerId));
    }

    private static BigDecimal shareOf(
            List<Identity> identities, List<SplitParticipantRequest> requested, Identity identity) {
        for (int i = 0; i < identities.size(); i++) {
            if (identities.get(i).equals(identity)) {
                return requested.get(i).amount();
            }
        }
        // Not a participant at all — a legal state: the payer may have consumed
        // nothing, and the caller may be recording a split they are not part of.
        return BigDecimal.ZERO;
    }

    private Names resolveNames(List<Identity> identities) {
        return resolveNames(identities, List.of());
    }

    /**
     * The identity list plus the caller's own, so the fan-out can always name the
     * actor. Duplicates are harmless — the result is a map.
     */
    private static List<Identity> withCaller(List<Identity> identities, UUID callerId) {
        List<Identity> result = new ArrayList<>(identities);
        result.add(Identity.ofUser(callerId));
        return result;
    }

    /** One batch lookup per source table ({@link SplitRevisionWriter#resolveNames}). */
    private Names resolveNames(List<Identity> identities, List<Contact> knownContacts) {
        return revisionWriter.resolveNames(identities, knownContacts);
    }

    private String groupName(UUID groupId) {
        // The caller's membership is already proved, so a missing row here is
        // impossible (fk_group_members_group_id is NO ACTION). "" rather than a
        // throw, the same disposition GroupResponseAssembler records — but it can
        // only reach entity_name, which is nullable, so even then nothing breaks.
        return groupRepository.findById(groupId).map(group -> group.getName()).orElse("");
    }

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

    private SplitExpenseResponse buildResponse(
            SplitExpense split, boolean addedToPersonalExpenses, UUID personalTransactionId) {
        // The two bulk statements above (the balance deltas and the back-reference
        // UPDATE) clear the persistence context, so the entity in hand is detached
        // and its two mutated columns are stale. They are set back from the local
        // values rather than re-read — one fewer query, and the values are exactly
        // what was written.
        split.setAddedToPersonalExpenses(addedToPersonalExpenses);
        split.setPersonalTransactionId(personalTransactionId);
        return responseAssembler.assembleOne(split);
    }

    private void logCreated(
            SplitExpense split,
            UUID userId,
            int participantCount,
            boolean addedToPersonalExpenses,
            int affectedMembers) {
        // Never the amount, the title or any participant name — split amounts and
        // the people in them are personal financial information (constitution §23,
        // security-architecture.md §8). Ids, the coarse shape and counts only.
        log.info("Split expense created by user {} (id={}, mode={}, participants={}, "
                        + "affectedMembers={}, personalTransaction={})",
                userId, split.getId(), split.getSplitMode().getValue(),
                participantCount, affectedMembers, addedToPersonalExpenses);
    }

    // =====================================================================
    // Value types
    // =====================================================================

    /**
     * One participant or payer, as exactly one of a user id or a contact id — this
     * domain's pervasive nullable pair, expressed once so the XOR cannot be
     * half-applied at a call site.
     *
     * <p>A record, so {@code equals} compares both components and a {@link Set} of
     * these is the duplicate check.
     *
     * <p>Package-private (not private) so {@link IndividualSplitRules} and its
     * tests share this one definition rather than a second identity type.
     */
    record Identity(UUID userId, UUID contactId) {

        static Identity ofUser(UUID userId) {
            return new Identity(userId, null);
        }

        static Identity ofContact(UUID contactId) {
            return new Identity(null, contactId);
        }
    }

    /** One payer after resolution (and, in individual mode, normalisation). */
    record PayerEntry(Identity identity, BigDecimal amount) {
    }

}
