package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.myexpense.backend.dto.request.UpdateSplitExpenseRequest;
import com.myexpense.backend.dto.response.SplitExpenseResponse;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.GroupMember;
import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.entity.SplitExpense;
import com.myexpense.backend.entity.SplitExpenseParticipant;
import com.myexpense.backend.entity.SplitExpensePayer;
import com.myexpense.backend.entity.Transaction;
import com.myexpense.backend.exception.SplitExpenseCreatorOnlyException;
import com.myexpense.backend.exception.SplitExpenseNotFoundException;
import com.myexpense.backend.exception.SplitRuleViolationException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.ContactRepository;
import com.myexpense.backend.repository.GroupMemberRepository;
import com.myexpense.backend.repository.GroupRepository;
import com.myexpense.backend.repository.SplitExpenseHeadRow;
import com.myexpense.backend.repository.SplitExpenseParticipantRepository;
import com.myexpense.backend.repository.SplitExpensePayerRepository;
import com.myexpense.backend.repository.SplitExpenseRepository;
import com.myexpense.backend.repository.TransactionRepository;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.service.SplitExpenseService.Identity;
import com.myexpense.backend.service.SplitExpenseService.PayerEntry;
import com.myexpense.backend.service.SplitRevisionWriter.Names;
import com.myexpense.backend.sync.ChangeLogEntityTypes;
import com.myexpense.backend.sync.ChangeSets;
import com.myexpense.backend.sync.IdempotentWriteExecutor;
import com.myexpense.backend.sync.LastWriteWins;
import com.myexpense.backend.sync.WriteContext;
import com.myexpense.backend.sync.WriteResult;

/**
 * {@code PUT} and {@code DELETE /api/v1/split-expenses/{id}} — ADR 0028 §2, §4.4,
 * §5, §6 (api-overview.md §9.4/§9.5). Orchestration, permission, LWW, U1/U2.
 *
 * <h2>Write order (§4.4) and lock order (§4.5)</h2>
 * <ol>
 *   <li>Bean Validation and U1 (before the idempotency check).</li>
 *   <li>Idempotency replay ({@link IdempotentWriteExecutor}; not
 *       {@code @Transactional} here, the executor owns the boundary).</li>
 *   <li>Unlocked head read, including deleted rows; not visible → 404.</li>
 *   <li>Category {@code FOR SHARE} — creator only, only when it changes.</li>
 *   <li>Personal transaction {@code FOR UPDATE}.</li>
 *   <li>Split row {@code FOR UPDATE}, re-read.</li>
 *   <li>Deleted → superseded ({@code deleted}, LWW mode) or 404.</li>
 *   <li>Permission → {@code 403 SPLIT_EXPENSE_CREATOR_ONLY}.</li>
 *   <li>LWW → superseded ({@code newer_write}).</li>
 *   <li>Group mutex, or the pair rows in canonical order.</li>
 *   <li>U2, payer/participant rules, audience normalisation (all {@code 400}).</li>
 *   <li>Both revisions' nets and zero-sum assertions.</li>
 *   <li>First write: revision {@code r + 1} participants, then payers.</li>
 *   <li>Split row: editable fields, category snapshot, {@code revision},
 *       {@code last_client_write_at}.</li>
 *   <li>Ledger, then the zero-sum assertion (group).</li>
 *   <li>Personal-transaction follow.</li>
 *   <li>Change log, activities, notifications.</li>
 * </ol>
 *
 * <p><strong>Every user-facing rejection is decided before the first write.</strong>
 * The only committed non-success is {@code WRITE_SUPERSEDED}, returned as a
 * {@link WriteResult} value so its log rows commit (ADR 0027 §4.3) — never by
 * throwing. A delete is never {@code 409}.
 *
 * <p>Never logs the request body, {@code changes}, the Idempotency-Key or the
 * device id, nor any amount or name (constitution §23).
 */
@Service
public class SplitExpenseEditService {

    private static final Logger log = LoggerFactory.getLogger(SplitExpenseEditService.class);

    private final SplitExpenseRepository splitExpenseRepository;
    private final SplitExpenseParticipantRepository participantRepository;
    private final SplitExpensePayerRepository payerRepository;
    private final TransactionRepository transactionRepository;
    private final GroupMemberRepository memberRepository;
    private final GroupRepository groupRepository;
    private final ContactRepository contactRepository;
    private final UserRepository userRepository;
    private final CategorySnapshotResolver categorySnapshotResolver;
    private final IndividualBalanceService individualBalanceService;
    private final SplitExpenseService splitExpenseService;
    private final SplitLedgerService ledgerService;
    private final SplitRevisionWriter revisionWriter;
    private final PersonalShareTransactionSync transactionSync;
    private final ActivityFanoutService activityFanoutService;
    private final SplitExpenseResponseAssembler responseAssembler;
    private final IdempotentWriteExecutor writeExecutor;
    private final ChangeLogWriter changeLogWriter;

    public SplitExpenseEditService(
            SplitExpenseRepository splitExpenseRepository,
            SplitExpenseParticipantRepository participantRepository,
            SplitExpensePayerRepository payerRepository,
            TransactionRepository transactionRepository,
            GroupMemberRepository memberRepository,
            GroupRepository groupRepository,
            ContactRepository contactRepository,
            UserRepository userRepository,
            CategorySnapshotResolver categorySnapshotResolver,
            IndividualBalanceService individualBalanceService,
            SplitExpenseService splitExpenseService,
            SplitLedgerService ledgerService,
            SplitRevisionWriter revisionWriter,
            PersonalShareTransactionSync transactionSync,
            ActivityFanoutService activityFanoutService,
            SplitExpenseResponseAssembler responseAssembler,
            IdempotentWriteExecutor writeExecutor,
            ChangeLogWriter changeLogWriter) {
        this.splitExpenseRepository = splitExpenseRepository;
        this.participantRepository = participantRepository;
        this.payerRepository = payerRepository;
        this.transactionRepository = transactionRepository;
        this.memberRepository = memberRepository;
        this.groupRepository = groupRepository;
        this.contactRepository = contactRepository;
        this.userRepository = userRepository;
        this.categorySnapshotResolver = categorySnapshotResolver;
        this.individualBalanceService = individualBalanceService;
        this.splitExpenseService = splitExpenseService;
        this.ledgerService = ledgerService;
        this.revisionWriter = revisionWriter;
        this.transactionSync = transactionSync;
        this.activityFanoutService = activityFanoutService;
        this.responseAssembler = responseAssembler;
        this.writeExecutor = writeExecutor;
        this.changeLogWriter = changeLogWriter;
    }

    // =====================================================================
    // §2.1 — the permission rule, as a pure function
    // =====================================================================

    /**
     * ADR 0028 §2.1, for a caller who can already SEE the split: a group split is
     * editable by any current member; an individual split by its creator only.
     */
    static boolean mayEdit(boolean groupMode, UUID createdByUserId, UUID callerId) {
        return groupMode || callerId.equals(createdByUserId);
    }

    // =====================================================================
    // PUT /split-expenses/{id}
    // =====================================================================

    public WriteResult<SplitExpenseResponse> updateSplitExpense(
            UUID userId, UUID splitExpenseId, UpdateSplitExpenseRequest request, WriteContext context) {
        // U1, before the idempotency check (§4.4 step 1).
        String immutableField = request.firstImmutableFieldPresent();
        if (immutableField != null) {
            throw SplitRuleViolationException.fieldNotEditable(immutableField);
        }
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.SPLIT_EXPENSE, ChangeLog.OPERATION_UPDATE, splitExpenseId),
                recorded -> ChangeLog.OUTCOME_SUPERSEDED.equals(recorded.getOutcome())
                        ? WriteResult.<SplitExpenseResponse>superseded()
                        : WriteResult.ok(splitExpenseService.currentIncludingDeleted(userId, splitExpenseId)),
                () -> doUpdate(userId, splitExpenseId, request, context));
    }

    private WriteResult<SplitExpenseResponse> doUpdate(
            UUID userId, UUID splitExpenseId, UpdateSplitExpenseRequest request, WriteContext context) {
        requireUser(userId);
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        OffsetDateTime effective = context.effectiveWriteAt(now);

        // Step 3.
        SplitExpenseHeadRow head = readVisibleHead(userId, splitExpenseId);
        boolean callerIsCreator = userId.equals(head.createdByUserId());
        boolean categoryChangeRequested = request.categoryId() != null
                && !request.categoryId().equals(head.categoryId());

        // Step 4 — FOR SHARE, creator only (a non-creator gets U2 at step 11, so
        // step 8's 403 keeps precedence on individual splits).
        CategorySnapshot newCategory = categoryChangeRequested && callerIsCreator
                ? categorySnapshotResolver.resolveForSplitExpense(userId, request.categoryId())
                : null;

        // Steps 5-6.
        Transaction personalTransaction = lockPersonalTransaction(head);
        SplitExpense split = splitExpenseRepository.findForUpdateById(splitExpenseId)
                .orElseThrow(SplitExpenseNotFoundException::new);
        boolean groupMode = split.getGroupId() != null;

        // Step 7.
        if (split.getDeletedAt() != null) {
            if (!context.lwwMode()) {
                throw new SplitExpenseNotFoundException();
            }
            return superseded(userId, split, request, ChangeLog.REASON_DELETED, context, effective);
        }
        // Step 8.
        if (!mayEdit(groupMode, split.getCreatedByUserId(), userId)) {
            throw new SplitExpenseCreatorOnlyException();
        }
        // Step 9 (ADR 0027 §5.2). Legacy mode: server time, always applies.
        if (context.lwwMode()) {
            String reason = LastWriteWins.supersededReason(false, split.getLastClientWriteAt(), effective);
            if (reason != null) {
                return superseded(userId, split, request, reason, context, effective);
            }
        }

        // Step 10.
        List<IndividualBalance> pairRows = lockLedger(split);

        // Step 11.
        if (categoryChangeRequested && !callerIsCreator) {
            throw SplitRuleViolationException.categoryChangeNotAllowed();
        }
        List<PayerEntry> payers = SplitExpenseService.payerEntries(SplitPayerResolver.resolve(
                request.paidByUserId(), request.paidByContactId(), request.payers(), request.amount()));
        List<Identity> participants = SplitExpenseService.participantIdentities(request.participants());
        SplitExpenseService.validateParticipantSum(request.amount(), request.participants());
        SplitPayerResolver.requireSumEquals(request.amount(), SplitExpenseService.amountsOf(payers));
        UUID creatorId = split.getCreatedByUserId();
        Identity creator = Identity.ofUser(creatorId);
        List<Identity> counterparts = groupMode ? List.of() : counterpartsOf(pairRows, creatorId);
        if (groupMode) {
            requireAllGroupMembers(split.getGroupId(), participants, payers);
        } else {
            Map<UUID, UUID> links = creatorContactLinks(creatorId, counterparts);
            payers = normalisePayers(payers, creator, counterparts, links);
            participants = normaliseParticipants(participants, creator, counterparts, links);
        }
        List<BigDecimal> shares = SplitExpenseService.sharesOf(request.participants());

        // Step 12.
        int oldRevision = split.getRevision();
        List<SplitExpenseParticipant> oldParticipants = participantRepository
                .findBySplitExpenseIdAndRevisionOrderByCreatedAtAscIdAsc(splitExpenseId, oldRevision);
        List<SplitExpensePayer> oldPayers = requirePayers(splitExpenseId, oldRevision);
        Map<Identity, BigDecimal> oldNets = SplitLedgerMath.netsOfRows(oldPayers, oldParticipants);
        Map<Identity, BigDecimal> newNets = SplitLedgerMath.nets(payers, participants, shares);
        SplitLedgerMath.requireZeroSum(oldNets, "stored revision of split " + splitExpenseId);
        SplitLedgerMath.requireZeroSum(newNets, "new revision of split " + splitExpenseId);

        Set<Identity> everyone = new LinkedHashSet<>(participants);
        everyone.addAll(SplitExpenseService.identitiesOf(payers));
        everyone.addAll(counterparts);
        everyone.add(creator);
        everyone.add(Identity.ofUser(userId));
        Names names = revisionWriter.resolveNames(everyone, List.of());

        Map<String, Object> beforeFields = SplitChangeLogFields.of(split, oldPayers, oldParticipants);
        PersonalShareTransactionSync.SplitValues beforeValues = new PersonalShareTransactionSync.SplitValues(
                split.getTitle(), split.getSplitDate(), split.getCategoryId(),
                shareOfRows(oldParticipants, creatorId));

        // Step 13 — first write.
        int newRevision = oldRevision + 1;
        revisionWriter.persistParticipants(splitExpenseId, newRevision, shares, participants, names);
        revisionWriter.persistPayers(splitExpenseId, newRevision, payers);

        // Step 14.
        Identity primary = SplitExpenseService.primaryPayer(payers);
        split.setTitle(request.title().trim());
        split.setSplitDate(request.splitDate());
        split.setAmount(request.amount());
        split.setSplitMethod(request.splitMethod());
        split.setPaidByUserId(primary.userId());
        split.setPaidByContactId(primary.contactId());
        if (newCategory != null && !Objects.equals(split.getCategoryId(), newCategory.categoryId())) {
            split.setReassignedFromCategoryId(null); // ADR 0024 §6.2
            newCategory.applyTo(split);
        }
        split.setRevision(newRevision);
        split.setLastClientWriteAt(effective);
        split = splitExpenseRepository.saveAndFlush(split);

        // Step 15.
        if (groupMode) {
            ledgerService.applyGroupEdit(split.getGroupId(), splitExpenseId, oldRevision,
                    SplitLedgerMath.counts(identitiesOfRows(oldParticipants), payerIdentitiesOfRows(oldPayers)),
                    SplitLedgerMath.counts(participants, SplitExpenseService.identitiesOf(payers)));
        } else {
            Map<UUID, BigDecimal> deltas = new HashMap<>();
            for (int i = 0; i < pairRows.size(); i++) {
                Identity counterpart = counterparts.get(i);
                deltas.put(pairRows.get(i).getId(), SplitLedgerMath.pairEditDelta(pairRows.get(i), creatorId,
                        counterpart, SplitLedgerMath.netOf(oldNets, counterpart),
                        SplitLedgerMath.netOf(newNets, counterpart)));
            }
            ledgerService.applyPairDeltas(pairRows, deltas);
        }

        // Step 16.
        PersonalShareTransactionSync.SplitValues afterValues = new PersonalShareTransactionSync.SplitValues(
                split.getTitle(), split.getSplitDate(), split.getCategoryId(),
                shareOf(participants, shares, creator));
        PersonalShareTransactionSync.Outcome transactionOutcome = transactionSync.followEdit(
                personalTransaction, beforeValues, afterValues, newCategory, callerIsCreator,
                context, effective, now);

        // Step 17.
        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.SPLIT_EXPENSE, splitExpenseId,
                ChangeLog.OPERATION_UPDATE,
                ChangeSets.update(beforeFields, SplitChangeLogFields.of(split, payers, participants, shares)),
                context, effective, true);
        Set<UUID> recipients = recipients(userId, groupMode, creatorId, counterparts,
                List.of(oldNets.keySet(), newNets.keySet()), transactionOutcome);
        fanOut(false, split, userId, names, counterparts, newNets, recipients, changeLogId, transactionOutcome);

        log.info("Split expense {} edited by user {} (mode={}, revision={}, personalTransaction={})",
                splitExpenseId, userId, split.getSplitMode().getValue(), newRevision, transactionOutcome);
        return WriteResult.ok(responseAssembler.assembleOne(split));
    }

    // =====================================================================
    // DELETE /split-expenses/{id}
    // =====================================================================

    public WriteResult<Void> deleteSplitExpense(UUID userId, UUID splitExpenseId, WriteContext context) {
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.SPLIT_EXPENSE, ChangeLog.OPERATION_DELETE, splitExpenseId),
                recorded -> WriteResult.noContent(),
                () -> doDelete(userId, splitExpenseId, context));
    }

    /**
     * Terminal (ADR 0027 §5.4, ADR 0028 §2.3): a live split is always deleted,
     * whatever its LWW clock; an already-deleted one is {@code 404}, which the
     * client treats as success. Never {@code 409}.
     */
    private WriteResult<Void> doDelete(UUID userId, UUID splitExpenseId, WriteContext context) {
        requireUser(userId);
        SplitExpenseHeadRow head = readVisibleHead(userId, splitExpenseId);
        Transaction personalTransaction = lockPersonalTransaction(head);
        SplitExpense split = splitExpenseRepository.findForUpdateById(splitExpenseId)
                .filter(row -> row.getDeletedAt() == null)
                .orElseThrow(SplitExpenseNotFoundException::new);
        boolean groupMode = split.getGroupId() != null;
        if (!mayEdit(groupMode, split.getCreatedByUserId(), userId)) {
            throw new SplitExpenseCreatorOnlyException();
        }
        List<IndividualBalance> pairRows = lockLedger(split);

        UUID creatorId = split.getCreatedByUserId();
        int revision = split.getRevision();
        List<SplitExpenseParticipant> oldParticipants = participantRepository
                .findBySplitExpenseIdAndRevisionOrderByCreatedAtAscIdAsc(splitExpenseId, revision);
        List<SplitExpensePayer> oldPayers = requirePayers(splitExpenseId, revision);
        Map<Identity, BigDecimal> oldNets = SplitLedgerMath.netsOfRows(oldPayers, oldParticipants);
        SplitLedgerMath.requireZeroSum(oldNets, "stored revision of split " + splitExpenseId);
        List<Identity> counterparts = groupMode ? List.of() : counterpartsOf(pairRows, creatorId);

        Set<Identity> everyone = new LinkedHashSet<>(oldNets.keySet());
        everyone.addAll(counterparts);
        everyone.add(Identity.ofUser(creatorId));
        everyone.add(Identity.ofUser(userId));
        Names names = revisionWriter.resolveNames(everyone, List.of());
        Map<String, Object> lastValues = SplitChangeLogFields.of(split, oldPayers, oldParticipants);

        // ONE instant for deleted_at, deleted_by_user_id, updated_at and the
        // personal transaction (V19 CONTRACT item 5, ADR 0028 §2.3/§5.3).
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        if (splitExpenseRepository.markDeleted(splitExpenseId, userId, now) != 1) {
            throw new IllegalStateException("Split expense " + splitExpenseId + " could not be marked deleted");
        }
        split.setDeletedAt(now);
        split.setDeletedByUserId(userId);

        if (groupMode) {
            ledgerService.applyGroupDelete(split.getGroupId(), splitExpenseId, revision,
                    SplitLedgerMath.counts(identitiesOfRows(oldParticipants), payerIdentitiesOfRows(oldPayers)));
        } else {
            Map<UUID, BigDecimal> deltas = new HashMap<>();
            for (int i = 0; i < pairRows.size(); i++) {
                deltas.put(pairRows.get(i).getId(), SplitLedgerMath.pairDeleteDelta(pairRows.get(i), creatorId,
                        counterparts.get(i), SplitLedgerMath.netOf(oldNets, counterparts.get(i))));
            }
            ledgerService.applyPairDeltas(pairRows, deltas);
        }

        OffsetDateTime effective = context.effectiveWriteAt(now);
        boolean transactionDeleted = transactionSync.softDelete(
                personalTransaction, userId.equals(creatorId), context, effective, now);
        PersonalShareTransactionSync.Outcome transactionOutcome = transactionDeleted
                ? PersonalShareTransactionSync.Outcome.DELETED : PersonalShareTransactionSync.Outcome.UNCHANGED;

        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.SPLIT_EXPENSE, splitExpenseId,
                ChangeLog.OPERATION_DELETE, ChangeSets.delete(lastValues, now, Map.of()), context, effective, true);
        Set<UUID> recipients = recipients(userId, groupMode, creatorId, counterparts,
                List.of(oldNets.keySet()), transactionOutcome);
        fanOut(true, split, userId, names, counterparts, oldNets, recipients, changeLogId, transactionOutcome);

        log.info("Split expense {} soft-deleted by user {} (mode={}, revision={}, personalTransaction={})",
                splitExpenseId, userId, split.getSplitMode().getValue(), revision, transactionOutcome);
        return WriteResult.noContent();
    }

    // =====================================================================
    // Steps shared by edit and delete
    // =====================================================================

    /** Step 3: unlocked, including deleted rows; not visible to the caller → 404. */
    private SplitExpenseHeadRow readVisibleHead(UUID userId, UUID splitExpenseId) {
        SplitExpenseHeadRow head = splitExpenseRepository.findHeadById(splitExpenseId)
                .orElseThrow(SplitExpenseNotFoundException::new);
        if (!splitExpenseService.isVisibleTo(userId, head.id(), head.groupId())) {
            throw new SplitExpenseNotFoundException();
        }
        return head;
    }

    /** Step 5: the creator's transaction {@code FOR UPDATE}, including a soft-deleted one. */
    private Transaction lockPersonalTransaction(SplitExpenseHeadRow head) {
        if (head.personalTransactionId() == null) {
            return null;
        }
        return transactionRepository
                .findForUpdateByIdAndUserId(head.personalTransactionId(), head.createdByUserId())
                .orElse(null);
    }

    /**
     * Step 10 (§4.5): the group mutex, or every linked pair row in canonical
     * order. Returns the pair rows in that order (empty in group mode).
     */
    private List<IndividualBalance> lockLedger(SplitExpense split) {
        if (split.getGroupId() != null) {
            ledgerService.lockGroupForLedgerWrite(split.getGroupId());
            return List.of();
        }
        List<UUID> pairIds = splitExpenseService.linkedPairIds(split.getId());
        if (pairIds.isEmpty()) {
            // A pre-ADR-0026 split written after V17 (V17 CONTRACT item 1): it
            // moved exactly its legacy pair (ADR 0026 §3's permitted read).
            pairIds = List.of(split.getIndividualBalanceId());
        }
        return individualBalanceService.lockPairs(pairIds);
    }

    /** Each pair row's counterpart relative to the creator, index-aligned with the rows. */
    private static List<Identity> counterpartsOf(List<IndividualBalance> pairRows, UUID creatorId) {
        List<Identity> counterparts = new ArrayList<>(pairRows.size());
        for (IndividualBalance row : pairRows) {
            counterparts.add(row.getCounterpartContactId() != null
                    ? Identity.ofContact(row.getCounterpartContactId())
                    : Identity.ofUser(IndividualBalanceService.counterpartUserIdOf(row, creatorId)));
        }
        return List.copyOf(counterparts);
    }

    /** §4.3 rule 3's synonyms: the creator's own contacts linked to a user counterpart. */
    private Map<UUID, UUID> creatorContactLinks(UUID creatorId, List<Identity> counterparts) {
        List<UUID> userCounterparts = counterparts.stream()
                .map(Identity::userId).filter(Objects::nonNull).toList();
        if (userCounterparts.isEmpty()) {
            return Map.of();
        }
        Map<UUID, UUID> links = new HashMap<>();
        for (Contact contact : contactRepository.findByOwnerUserIdAndLinkedUserIdIn(creatorId, userCounterparts)) {
            links.put(contact.getId(), contact.getLinkedUserId());
        }
        return links;
    }

    private static List<PayerEntry> normalisePayers(List<PayerEntry> raw, Identity creator,
            List<Identity> counterparts, Map<UUID, UUID> links) {
        List<PayerEntry> normalised = new ArrayList<>(raw.size());
        for (PayerEntry payer : raw) {
            normalised.add(new PayerEntry(IndividualSplitRules.normaliseAgainstAudience(
                    payer.identity(), creator, counterparts, links), payer.amount()));
        }
        SplitExpenseService.requireDistinctPayers(normalised);
        return normalised;
    }

    private static List<Identity> normaliseParticipants(List<Identity> raw, Identity creator,
            List<Identity> counterparts, Map<UUID, UUID> links) {
        List<Identity> normalised = new ArrayList<>(raw.size());
        for (Identity identity : raw) {
            normalised.add(IndividualSplitRules.normaliseAgainstAudience(identity, creator, counterparts, links));
        }
        SplitExpenseService.requireDistinct(normalised);
        return normalised;
    }

    /** ADR 0025 R6 on an edit: every participant and every payer is a member of the (fixed) group. */
    private void requireAllGroupMembers(UUID groupId, List<Identity> participants, List<PayerEntry> payers) {
        Set<Identity> members = new HashSet<>();
        for (GroupMember member : memberRepository.findByGroupIdOrderByCreatedAtAscIdAsc(groupId)) {
            members.add(new Identity(member.getUserId(), member.getUserId() == null ? member.getInvitedContactId() : null));
        }
        List<Identity> everyone = new ArrayList<>(participants);
        everyone.addAll(SplitExpenseService.identitiesOf(payers));
        for (Identity identity : everyone) {
            if (!members.contains(identity)) {
                throw SplitRuleViolationException.notAGroupMember();
            }
        }
    }

    private List<SplitExpensePayer> requirePayers(UUID splitExpenseId, int revision) {
        List<SplitExpensePayer> payers = payerRepository.findBySplitExpenseIdAndRevision(splitExpenseId, revision);
        if (payers.isEmpty()) {
            // V16 backfilled every pre-ADR-0025 split; an empty set means V16 and
            // the backend were not deployed together. Refuse rather than guess.
            throw new IllegalStateException("Split expense " + splitExpenseId + " has no payer rows at revision "
                    + revision);
        }
        return payers;
    }

    private static List<Identity> identitiesOfRows(List<SplitExpenseParticipant> rows) {
        return rows.stream().map(row -> new Identity(row.getParticipantUserId(), row.getParticipantContactId()))
                .toList();
    }

    private static List<Identity> payerIdentitiesOfRows(List<SplitExpensePayer> rows) {
        return rows.stream().map(row -> new Identity(row.getPayerUserId(), row.getPayerContactId())).toList();
    }

    private static BigDecimal shareOfRows(List<SplitExpenseParticipant> rows, UUID creatorId) {
        for (SplitExpenseParticipant row : rows) {
            if (creatorId.equals(row.getParticipantUserId())) {
                return row.getAmount();
            }
        }
        return BigDecimal.ZERO;
    }

    private static BigDecimal shareOf(List<Identity> participants, List<BigDecimal> shares, Identity identity) {
        for (int i = 0; i < participants.size(); i++) {
            if (participants.get(i).equals(identity)) {
                return shares.get(i);
            }
        }
        return BigDecimal.ZERO;
    }

    /**
     * §9.4 recipients: the actor; in group mode every registered identity
     * involved in any of the given revisions; in individual mode every registered
     * counterpart; and the creator when their personal transaction changed.
     */
    private static Set<UUID> recipients(UUID actorId, boolean groupMode, UUID creatorId,
            List<Identity> counterparts, List<Set<Identity>> revisions,
            PersonalShareTransactionSync.Outcome transactionOutcome) {
        Set<UUID> recipients = new LinkedHashSet<>();
        recipients.add(actorId);
        if (groupMode) {
            for (Set<Identity> revision : revisions) {
                for (Identity identity : revision) {
                    if (identity.userId() != null) {
                        recipients.add(identity.userId());
                    }
                }
            }
        } else {
            recipients.add(creatorId);
            for (Identity counterpart : counterparts) {
                if (counterpart.userId() != null) {
                    recipients.add(counterpart.userId());
                }
            }
        }
        if (transactionOutcome != PersonalShareTransactionSync.Outcome.UNCHANGED) {
            recipients.add(creatorId);
        }
        return recipients;
    }

    private void fanOut(boolean deleted, SplitExpense split, UUID actorId, Names names, List<Identity> counterparts,
            Map<Identity, BigDecimal> nets, Set<UUID> recipients, UUID changeLogId,
            PersonalShareTransactionSync.Outcome transactionOutcome) {
        boolean groupMode = split.getGroupId() != null;
        UUID creatorId = split.getCreatedByUserId();
        Map<UUID, String> clauses;
        String counterpartList = null;
        if (groupMode) {
            clauses = SplitEffectClauses.forGroup(recipients, nets, deleted);
        } else {
            List<SplitEffectClauses.PairParty> parties = new ArrayList<>(counterparts.size());
            List<String> labels = new ArrayList<>(counterparts.size());
            for (Identity counterpart : counterparts) {
                parties.add(new SplitEffectClauses.PairParty(counterpart.userId(), names.nameOf(counterpart),
                        SplitLedgerMath.netOf(nets, counterpart)));
                labels.add(names.nameOf(counterpart));
            }
            clauses = SplitEffectClauses.forIndividual(recipients, creatorId, names.userName(creatorId), parties, deleted);
            counterpartList = ActivitySentences.joinPayerLabels(labels);
        }
        String creatorClause = !actorId.equals(creatorId)
                && transactionOutcome != PersonalShareTransactionSync.Outcome.UNCHANGED
                ? ActivitySentences.personalTransactionClause(
                        transactionOutcome == PersonalShareTransactionSync.Outcome.DELETED)
                : null;
        activityFanoutService.fanOutSplitChanged(new ActivityFanoutService.SplitChangedFanout(
                deleted, groupMode, actorId, names.userName(actorId), split.getTitle(),
                groupMode ? groupName(split.getGroupId()) : null, counterpartList,
                split.getGroupId(), split.getId(), changeLogId, recipients, new LinkedHashMap<>(clauses),
                creatorId, creatorClause));
    }

    /** ADR 0027 §5.2: logged and COMMITTED; the controller answers 409. Never thrown. */
    private WriteResult<SplitExpenseResponse> superseded(UUID userId, SplitExpense split,
            UpdateSplitExpenseRequest request, String reason, WriteContext context, OffsetDateTime effective) {
        int revision = split.getRevision();
        Map<String, Object> current = SplitChangeLogFields.of(split,
                payerRepository.findBySplitExpenseIdAndRevision(split.getId(), revision),
                participantRepository.findBySplitExpenseIdAndRevisionOrderByCreatedAtAscIdAsc(split.getId(), revision));
        changeLogWriter.logSuperseded(userId, ChangeLogEntityTypes.SPLIT_EXPENSE, split.getId(),
                ChangeSets.attempted(current, SplitChangeLogFields.attempted(request)), reason, context, effective,
                split.getTitle(), new ChangeLogWriter.Related(null, split.getGroupId(), null, split.getId()));
        log.info("Split expense {} update superseded for user {} (reason={})", split.getId(), userId, reason);
        return WriteResult.superseded();
    }

    private String groupName(UUID groupId) {
        return groupRepository.findById(groupId).map(group -> group.getName()).orElse("");
    }

    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }
}
