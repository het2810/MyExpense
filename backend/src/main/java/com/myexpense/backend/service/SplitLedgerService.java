package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.exception.GroupNotFoundException;
import com.myexpense.backend.repository.GroupRepository;

/**
 * <strong>The one split-ledger implementation</strong> — ADR 0028 §4, §12:
 * apply and reverse a split revision's balance effect, used by create, edit and
 * delete alike (constitution §17). Extracted from {@code SplitExpenseService}.
 *
 * <ul>
 *   <li><strong>Group:</strong> create = apply(1, +1); edit = apply(r, −1) then
 *       apply(r + 1, +1); delete = apply(r, −1); then
 *       {@code assertGroupBalancesConsistent}, inside the same transaction.</li>
 *   <li><strong>Individual:</strong> one combined relative delta per linked pair
 *       row, in the canonical lock order the caller already holds
 *       ({@link IndividualBalanceService#resolvePairs} on create,
 *       {@link IndividualBalanceService#lockPairs} on edit/delete). A zero delta
 *       is still applied (ADR 0026 §4.4).</li>
 * </ul>
 *
 * <p><strong>The group mutex</strong> ({@link #lockGroupForLedgerWrite}) must be
 * taken before the first balance statement by every group-ledger write (§4.5).
 * Every method is {@code MANDATORY}: it writes inside the caller's transaction.
 */
@Service
public class SplitLedgerService {

    private static final int APPLY = 1;
    private static final int REVERSE = -1;

    private final GroupRepository groupRepository;
    private final GroupBalanceService groupBalanceService;
    private final IndividualBalanceService individualBalanceService;

    public SplitLedgerService(
            GroupRepository groupRepository,
            GroupBalanceService groupBalanceService,
            IndividualBalanceService individualBalanceService) {
        this.groupRepository = groupRepository;
        this.groupBalanceService = groupBalanceService;
        this.individualBalanceService = individualBalanceService;
    }

    /**
     * ADR 0028 §4.5: {@code groups} row {@code FOR NO KEY UPDATE}, held to commit.
     * The caller's membership has already been proved, so a missing row is the
     * same {@code 404 GROUP_NOT_FOUND} the membership check answers.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void lockGroupForLedgerWrite(UUID groupId) {
        if (groupRepository.lockForLedgerWrite(groupId) != 1) {
            throw new GroupNotFoundException();
        }
    }

    /** Create: apply revision 1. Today's behaviour exactly, plus nothing. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void applyGroupCreate(UUID groupId, UUID splitExpenseId, GroupBalanceService.RevisionRowCounts counts) {
        groupBalanceService.moveSplitRevision(groupId, splitExpenseId, 1, APPLY, counts);
        groupBalanceService.assertGroupBalancesConsistent(groupId);
    }

    /** Edit: reverse revision {@code r}, apply {@code r + 1}, then assert zero-sum. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void applyGroupEdit(UUID groupId, UUID splitExpenseId, int oldRevision,
            GroupBalanceService.RevisionRowCounts oldCounts, GroupBalanceService.RevisionRowCounts newCounts) {
        groupBalanceService.moveSplitRevision(groupId, splitExpenseId, oldRevision, REVERSE, oldCounts);
        groupBalanceService.moveSplitRevision(groupId, splitExpenseId, oldRevision + 1, APPLY, newCounts);
        groupBalanceService.assertGroupBalancesConsistent(groupId);
    }

    /** Delete: reverse revision {@code r}, then assert zero-sum. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void applyGroupDelete(UUID groupId, UUID splitExpenseId, int revision,
            GroupBalanceService.RevisionRowCounts counts) {
        groupBalanceService.moveSplitRevision(groupId, splitExpenseId, revision, REVERSE, counts);
        groupBalanceService.assertGroupBalancesConsistent(groupId);
    }

    /**
     * Individual edit/delete: one delta per pair row, in the order given (which
     * must be {@link IndividualBalanceService#lockPairs}' order).
     *
     * @param deltasByBalanceId the combined {@code D(R_c)} per pair row (§4.3)
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void applyPairDeltas(List<IndividualBalance> rowsInLockOrder, Map<UUID, BigDecimal> deltasByBalanceId) {
        for (IndividualBalance row : rowsInLockOrder) {
            BigDecimal delta = deltasByBalanceId.get(row.getId());
            if (delta == null) {
                throw new IllegalStateException("No delta computed for linked pair row " + row.getId());
            }
            individualBalanceService.applyDelta(row.getId(), delta);
        }
    }
}
