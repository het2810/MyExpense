package com.myexpense.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.service.SplitExpenseService.Identity;
import com.myexpense.backend.service.SplitExpenseService.PayerEntry;

/**
 * ADR 0028 §4.2/§4.3 — the reversal formula, pinned on the ADR's own worked
 * examples. Pure functions, no Spring context, no database.
 *
 * <p>User ids are chosen so Java's SIGNED {@link UUID#compareTo} and PostgreSQL's
 * UNSIGNED order disagree: {@code HET} (0x8...) is signed-lesser but
 * unsigned-greater than {@code RAJ} (0x1...). The pair delta reads the left side
 * off the stored row, so both orientations are exercised explicitly.
 */
class SplitLedgerMathTest {

    private static final UUID HET = UUID.fromString("80000000-0000-0000-0000-000000000001");
    private static final UUID RAJ = UUID.fromString("10000000-0000-0000-0000-000000000002");
    private static final UUID RAJ_ABOVE_HET = UUID.fromString("90000000-0000-0000-0000-000000000002");
    private static final UUID AMIT_USER = UUID.fromString("a0000000-0000-0000-0000-000000000003");
    private static final UUID AMIT_CONTACT = UUID.fromString("00000000-0000-0000-0000-0000000000a2");

    private static final Identity HET_ID = Identity.ofUser(HET);
    private static final Identity RAJ_ID = Identity.ofUser(RAJ);
    private static final Identity AMIT_ID = Identity.ofUser(AMIT_USER);
    private static final Identity AMIT_CONTACT_ID = Identity.ofContact(AMIT_CONTACT);

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    private static PayerEntry paid(Identity identity, String amount) {
        return new PayerEntry(identity, money(amount));
    }

    // =====================================================================
    // §4.2 — group
    // =====================================================================

    /** "Dinner" ₹900, equal (₹300 each), Het paid all. */
    private static Map<Identity, BigDecimal> groupRevisionOne() {
        return SplitLedgerMath.nets(List.of(paid(HET_ID, "900.00")), List.of(HET_ID, RAJ_ID, AMIT_ID),
                List.of(money("300.00"), money("300.00"), money("300.00")));
    }

    @Test
    void groupNetsMatchTheAdrExample() {
        Map<Identity, BigDecimal> nets = groupRevisionOne();
        assertEquals(money("600.00"), nets.get(HET_ID));
        assertEquals(money("-300.00"), nets.get(RAJ_ID));
        assertEquals(money("-300.00"), nets.get(AMIT_ID));
        SplitLedgerMath.requireZeroSum(nets, "test");
    }

    @Test
    void groupEditDeltaMatchesSection42() {
        // Edit to ₹1,200, equal (₹400 each), Het paid ₹900, Raj paid ₹300.
        Map<Identity, BigDecimal> newNets = SplitLedgerMath.nets(
                List.of(paid(HET_ID, "900.00"), paid(RAJ_ID, "300.00")), List.of(HET_ID, RAJ_ID, AMIT_ID),
                List.of(money("400.00"), money("400.00"), money("400.00")));
        assertEquals(money("500.00"), newNets.get(HET_ID));
        assertEquals(money("-100.00"), newNets.get(RAJ_ID));
        assertEquals(money("-400.00"), newNets.get(AMIT_ID));

        Map<Identity, BigDecimal> delta = SplitLedgerMath.groupEditDeltas(groupRevisionOne(), newNets);
        assertEquals(money("-100.00"), delta.get(HET_ID));
        assertEquals(money("200.00"), delta.get(RAJ_ID));
        assertEquals(money("-100.00"), delta.get(AMIT_ID));
        SplitLedgerMath.requireZeroSum(delta, "delta");
    }

    @Test
    void groupDeleteDeltaReturnsEveryBalanceToItsPreSplitValue() {
        Map<Identity, BigDecimal> delta = SplitLedgerMath.groupDeleteDeltas(groupRevisionOne());
        assertEquals(money("-600.00"), delta.get(HET_ID));
        assertEquals(money("300.00"), delta.get(RAJ_ID));
        assertEquals(money("300.00"), delta.get(AMIT_ID));
        Map<Identity, BigDecimal> one = groupRevisionOne();
        for (Map.Entry<Identity, BigDecimal> entry : delta.entrySet()) {
            assertEquals(0, one.get(entry.getKey()).add(entry.getValue()).signum());
        }
    }

    @Test
    void anIdentityDroppedByTheEditIsFullyReversed() {
        Map<Identity, BigDecimal> newNets = SplitLedgerMath.nets(List.of(paid(HET_ID, "600.00")),
                List.of(HET_ID, RAJ_ID), List.of(money("300.00"), money("300.00")));
        Map<Identity, BigDecimal> delta = SplitLedgerMath.groupEditDeltas(groupRevisionOne(), newNets);
        assertEquals(money("300.00"), delta.get(AMIT_ID));
        SplitLedgerMath.requireZeroSum(delta, "delta");
    }

    @Test
    void multiPayerNetsAddEveryPaymentOfOneIdentity() {
        Map<Identity, BigDecimal> nets = SplitLedgerMath.nets(
                List.of(paid(HET_ID, "500.00"), paid(RAJ_ID, "400.00")), List.of(HET_ID, RAJ_ID, AMIT_ID),
                List.of(money("300.00"), money("300.00"), money("300.00")));
        assertEquals(money("200.00"), nets.get(HET_ID));
        assertEquals(money("100.00"), nets.get(RAJ_ID));
        assertEquals(money("-300.00"), nets.get(AMIT_ID));
    }

    @Test
    void anUnbalancedRevisionFailsTheIntegrityGuard() {
        Map<Identity, BigDecimal> broken = Map.of(HET_ID, money("1.00"), RAJ_ID, money("-2.00"));
        assertThrows(IllegalStateException.class, () -> SplitLedgerMath.requireZeroSum(broken, "test"));
    }

    @Test
    void revisionCountsSplitByIdentityKind() {
        GroupBalanceService.RevisionRowCounts counts = SplitLedgerMath.counts(
                List.of(HET_ID, AMIT_CONTACT_ID), List.of(HET_ID));
        assertEquals(1, counts.registeredParticipants());
        assertEquals(1, counts.contactParticipants());
        assertEquals(1, counts.registeredPayers());
        assertEquals(0, counts.contactPayers());
    }

    // =====================================================================
    // §4.3 — individual
    // =====================================================================

    /** Raj (linked, canonical left = Raj) and Amit (contact row, left = Het), equal, Raj paid all. */
    private static Map<Identity, BigDecimal> pairRevisionOne() {
        return SplitLedgerMath.nets(List.of(paid(RAJ_ID, "900.00")), List.of(HET_ID, RAJ_ID, AMIT_CONTACT_ID),
                List.of(money("300.00"), money("300.00"), money("300.00")));
    }

    private static Map<Identity, BigDecimal> pairRevisionTwo() {
        return SplitLedgerMath.nets(List.of(paid(HET_ID, "900.00")), List.of(HET_ID, RAJ_ID, AMIT_CONTACT_ID),
                List.of(money("300.00"), money("300.00"), money("300.00")));
    }

    private static IndividualBalance userPair(UUID left, UUID right) {
        return IndividualBalance.builder().id(UUID.randomUUID()).userId(left).counterpartUserId(right).build();
    }

    private static IndividualBalance contactPair() {
        return IndividualBalance.builder().id(UUID.randomUUID()).userId(HET).counterpartContactId(AMIT_CONTACT).build();
    }

    @Test
    void individualEditMatchesSection43WithTheCounterpartAsLeft() {
        Map<Identity, BigDecimal> oldNets = pairRevisionOne();
        Map<Identity, BigDecimal> newNets = pairRevisionTwo();
        SplitLedgerMath.requireZeroSum(oldNets, "r");
        SplitLedgerMath.requireZeroSum(newNets, "r+1");

        // Het↔Raj, left = Raj (RAJ is unsigned-lesser): D = −900.
        IndividualBalance hetRaj = userPair(RAJ, HET);
        assertEquals(money("-900.00"), SplitLedgerMath.pairEditDelta(hetRaj, HET, RAJ_ID,
                SplitLedgerMath.netOf(oldNets, RAJ_ID), SplitLedgerMath.netOf(newNets, RAJ_ID)));
        // Het↔Amit contact row, left = Het: D = 0.
        assertEquals(0, SplitLedgerMath.pairEditDelta(contactPair(), HET, AMIT_CONTACT_ID,
                SplitLedgerMath.netOf(oldNets, AMIT_CONTACT_ID), SplitLedgerMath.netOf(newNets, AMIT_CONTACT_ID))
                .signum());
    }

    @Test
    void individualEditWithTheCreatorAsLeftFlipsTheSign() {
        UUID raj = RAJ_ABOVE_HET;
        Identity rajId = Identity.ofUser(raj);
        Map<Identity, BigDecimal> oldNets = SplitLedgerMath.nets(List.of(paid(rajId, "900.00")),
                List.of(HET_ID, rajId), List.of(money("450.00"), money("450.00")));
        Map<Identity, BigDecimal> newNets = SplitLedgerMath.nets(List.of(paid(HET_ID, "900.00")),
                List.of(HET_ID, rajId), List.of(money("450.00"), money("450.00")));
        // Left = Het (unsigned-lesser): delta_r = −net(Raj).
        IndividualBalance hetRaj = userPair(HET, raj);
        assertEquals(money("900.00"), SplitLedgerMath.pairEditDelta(hetRaj, HET, rajId,
                SplitLedgerMath.netOf(oldNets, rajId), SplitLedgerMath.netOf(newNets, rajId)));
    }

    @Test
    void individualDeleteReturnsBothPairsToTheirPreSplitValues() {
        Map<Identity, BigDecimal> oldNets = pairRevisionOne();
        IndividualBalance hetRaj = userPair(RAJ, HET);
        BigDecimal applied = IndividualSplitRules.signedPairDelta(hetRaj, HET, RAJ_ID, oldNets.get(RAJ_ID));
        BigDecimal reversed = SplitLedgerMath.pairDeleteDelta(hetRaj, HET, RAJ_ID, oldNets.get(RAJ_ID));
        assertEquals(money("600.00"), applied);
        assertEquals(money("-600.00"), reversed);

        BigDecimal amitReversed = SplitLedgerMath.pairDeleteDelta(contactPair(), HET, AMIT_CONTACT_ID,
                oldNets.get(AMIT_CONTACT_ID));
        assertEquals(money("-300.00"), amitReversed);
    }

    @Test
    void editAfterASettlementMayFlipTheSign() {
        // Het↔Raj (left = Raj) stood at +600 (Raj is owed), then Het paid Raj
        // ₹600, settling the pair to 0. The edit moves it by D = −900.
        BigDecimal afterSettlement = BigDecimal.ZERO.setScale(2);
        BigDecimal delta = SplitLedgerMath.pairEditDelta(userPair(RAJ, HET), HET, RAJ_ID,
                pairRevisionOne().get(RAJ_ID), pairRevisionTwo().get(RAJ_ID));
        // §4.6: the sign flips, which is correct — Raj now owes Het ₹900: ₹300
        // for the edited split plus the ₹600 Het paid for a debt that no longer
        // exists. The settlement itself is never touched.
        assertEquals(money("-900.00"), afterSettlement.add(delta));
    }
}
