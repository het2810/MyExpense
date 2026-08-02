package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.entity.SplitExpenseParticipant;
import com.myexpense.backend.entity.SplitExpensePayer;
import com.myexpense.backend.service.SplitExpenseService.Identity;
import com.myexpense.backend.service.SplitExpenseService.PayerEntry;

/**
 * ADR 0028 §4's ledger arithmetic as <strong>pure functions</strong>, so the
 * reversal formula can be pinned by unit tests without a database (§4.2/§4.3
 * worked examples).
 *
 * <pre>
 * net_r(i) = paid_r(i) − share_r(i)
 * group edit:      Δ(i)   = net_{r+1}(i) − net_r(i)
 * group delete:    Δ(i)   = −net_r(i)
 * pair edit:       D(R_c) = delta_{r+1}(R_c) − delta_r(R_c)
 * pair delete:     D(R_c) = −delta_r(R_c)
 * delta_r(R_c)     = −net_r(c) if left(R_c) = creator, +net_r(c) if left(R_c) = c
 * </pre>
 *
 * <p>The group ledger itself is applied by set-based statements
 * ({@code GroupBalanceService#moveSplitRevision}: reverse {@code r}, apply
 * {@code r + 1}), whose combined effect per member is exactly {@code Δ(i)}; the
 * group functions here document and test that equivalence and feed the effect
 * clauses (§9.4). Exact {@link BigDecimal}, no tolerance.
 */
final class SplitLedgerMath {

    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);

    private SplitLedgerMath() {
    }

    /** {@code net(i)} for every identity that pays or participates, insertion-ordered. */
    static Map<Identity, BigDecimal> nets(
            List<PayerEntry> payers, List<Identity> participants, List<BigDecimal> shares) {
        Map<Identity, BigDecimal> nets = new LinkedHashMap<>();
        for (PayerEntry payer : payers) {
            nets.merge(payer.identity(), payer.amount(), BigDecimal::add);
        }
        for (int i = 0; i < participants.size(); i++) {
            nets.merge(participants.get(i), shares.get(i).negate(), BigDecimal::add);
        }
        nets.replaceAll((identity, net) -> net.setScale(2));
        return nets;
    }

    /** {@link #nets} over one stored revision's rows (already filtered to that revision). */
    static Map<Identity, BigDecimal> netsOfRows(
            List<SplitExpensePayer> payers, List<SplitExpenseParticipant> participants) {
        Map<Identity, BigDecimal> nets = new LinkedHashMap<>();
        for (SplitExpensePayer payer : payers) {
            nets.merge(new Identity(payer.getPayerUserId(), payer.getPayerContactId()),
                    payer.getAmountPaid(), BigDecimal::add);
        }
        for (SplitExpenseParticipant participant : participants) {
            nets.merge(new Identity(participant.getParticipantUserId(), participant.getParticipantContactId()),
                    participant.getAmount().negate(), BigDecimal::add);
        }
        nets.replaceAll((identity, net) -> net.setScale(2));
        return nets;
    }

    static BigDecimal netOf(Map<Identity, BigDecimal> nets, Identity identity) {
        return nets.getOrDefault(identity, ZERO);
    }

    /** ADR 0028 §4.2 edit: {@code Δ(i) = net_{r+1}(i) − net_r(i)} over the union of both identity sets. */
    static Map<Identity, BigDecimal> groupEditDeltas(
            Map<Identity, BigDecimal> oldNets, Map<Identity, BigDecimal> newNets) {
        Set<Identity> everyone = new LinkedHashSet<>(oldNets.keySet());
        everyone.addAll(newNets.keySet());
        Map<Identity, BigDecimal> deltas = new LinkedHashMap<>();
        for (Identity identity : everyone) {
            deltas.put(identity, netOf(newNets, identity).subtract(netOf(oldNets, identity)));
        }
        return deltas;
    }

    /** ADR 0028 §4.2 delete: {@code Δ(i) = −net_r(i)}. */
    static Map<Identity, BigDecimal> groupDeleteDeltas(Map<Identity, BigDecimal> oldNets) {
        Map<Identity, BigDecimal> deltas = new LinkedHashMap<>();
        oldNets.forEach((identity, net) -> deltas.put(identity, net.negate()));
        return deltas;
    }

    /** ADR 0028 §4.3 edit: {@code D(R_c) = delta_{r+1}(R_c) − delta_r(R_c)}. */
    static BigDecimal pairEditDelta(
            IndividualBalance row, UUID creatorId, Identity counterpart, BigDecimal oldNet, BigDecimal newNet) {
        return IndividualSplitRules.signedPairDelta(row, creatorId, counterpart, newNet)
                .subtract(IndividualSplitRules.signedPairDelta(row, creatorId, counterpart, oldNet));
    }

    /** ADR 0028 §4.3 delete: {@code D(R_c) = −delta_r(R_c)}. */
    static BigDecimal pairDeleteDelta(IndividualBalance row, UUID creatorId, Identity counterpart, BigDecimal oldNet) {
        return IndividualSplitRules.signedPairDelta(row, creatorId, counterpart, oldNet).negate();
    }

    /**
     * {@code Σ net = 0} — the integrity guard for a stored revision and the
     * pre-write check for a new one (ADR 0028 §4.3). A failure is a programming
     * error ({@link IllegalStateException}, a logged {@code 500}); no amount goes
     * into the message (constitution §23).
     */
    static void requireZeroSum(Map<Identity, BigDecimal> nets, String what) {
        BigDecimal sum = BigDecimal.ZERO;
        for (BigDecimal net : nets.values()) {
            sum = sum.add(net);
        }
        if (sum.signum() != 0) {
            throw new IllegalStateException("Split nets do not sum to zero for " + what);
        }
    }

    /** How many registered/contact rows a revision has — what each group statement must move. */
    static GroupBalanceService.RevisionRowCounts counts(List<Identity> participants, List<Identity> payers) {
        int registeredParticipants = (int) participants.stream().filter(i -> i.userId() != null).count();
        int registeredPayers = (int) payers.stream().filter(i -> i.userId() != null).count();
        return new GroupBalanceService.RevisionRowCounts(
                registeredParticipants, participants.size() - registeredParticipants,
                registeredPayers, payers.size() - registeredPayers);
    }
}
