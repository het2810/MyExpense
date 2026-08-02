package com.myexpense.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.myexpense.backend.dto.request.CreateSplitExpenseRequest;
import com.myexpense.backend.dto.request.SplitParticipantRequest;
import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.exception.ContactNotFoundException;
import com.myexpense.backend.exception.SplitRuleViolationException;
import com.myexpense.backend.service.SplitExpenseService.Identity;
import com.myexpense.backend.service.SplitExpenseService.PayerEntry;

/**
 * ADR 0026 §4 and §5.1: the counterpart form (C1-C4, C6), the counterpart checks
 * (C6-C8), normalisation (C9), the per-counterpart net, the zero-sum assertion and
 * the per-pair signed delta. Pure functions, no Spring context, no database.
 *
 * <p>The two user ids are chosen so Java's SIGNED {@link UUID#compareTo} and
 * PostgreSQL's UNSIGNED order disagree: {@code HET} (0x8...) is signed-lesser but
 * unsigned-greater than {@code RAJ} (0x1...). The delta reads the left side off
 * the stored row, so both orientations are exercised explicitly.
 */
class IndividualSplitRulesTest {

    private static final UUID HET = UUID.fromString("80000000-0000-0000-0000-000000000001");
    private static final UUID RAJ = UUID.fromString("10000000-0000-0000-0000-000000000002");
    private static final UUID RAJ_CONTACT = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID AMIT_CONTACT = UUID.fromString("00000000-0000-0000-0000-0000000000a2");
    private static final UUID PAIR_ID = UUID.fromString("00000000-0000-0000-0000-0000000000b1");

    private static final Identity HET_ID = Identity.ofUser(HET);
    private static final Identity RAJ_ID = Identity.ofUser(RAJ);
    private static final Identity AMIT_ID = Identity.ofContact(AMIT_CONTACT);

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    private static Contact contact(UUID id, String name, UUID linkedUserId) {
        return Contact.builder().id(id).ownerUserId(HET).name(name).initials("X")
                .linkedUserId(linkedUserId).build();
    }

    private static final Contact RAJ_LINKED = contact(RAJ_CONTACT, "Raj", RAJ);
    private static final Contact AMIT_UNLINKED = contact(AMIT_CONTACT, "Amit", null);

    private static CreateSplitExpenseRequest request(
            String mode, UUID groupId, UUID single, List<UUID> multiple) {
        return new CreateSplitExpenseRequest(
                "Dinner", null, LocalDate.of(2026, 11, 11), money("900.00"), mode,
                groupId, single, multiple, "equally", HET, null, null,
                List.of(new SplitParticipantRequest(HET, null, money("900.00"))), false, null, null);
    }

    private static String messageOf(Runnable action) {
        return assertThrows(SplitRuleViolationException.class, action::run).getMessage();
    }

    /** A contact row is always owned by (left = ) the creator. */
    private static IndividualBalance contactRow(UUID contactId) {
        return IndividualBalance.builder().id(PAIR_ID).userId(HET).counterpartContactId(contactId).build();
    }

    /** A canonical user-pair row as STORED: user_id is whichever side the row says. */
    private static IndividualBalance userPairRow(UUID left, UUID right) {
        return IndividualBalance.builder().id(PAIR_ID).userId(left).counterpartUserId(right).build();
    }

    // =====================================================================
    // Counterpart form
    // =====================================================================

    @Test
    void c1BothFormsAreRejected() {
        assertEquals(
                "Provide either individualCounterpartContactId or individualCounterpartContactIds, not both.",
                messageOf(() -> IndividualSplitRules.requireExactlyOneCounterpartForm(
                        request("individual", null, RAJ_CONTACT, List.of(AMIT_CONTACT)))));
    }

    @Test
    void c2NeitherFormKeepsTheExistingMessage() {
        assertEquals("individualCounterpartContactId is required when splitMode is 'individual'.",
                messageOf(() -> IndividualSplitRules.requireExactlyOneCounterpartForm(
                        request("individual", null, null, null))));
    }

    @Test
    void c3AndC4GroupModeCarriesNeitherForm() {
        assertEquals("individualCounterpartContactId must be omitted when splitMode is 'group'.",
                messageOf(() -> IndividualSplitRules.requireNoCounterpartForGroupMode(
                        request("group", UUID.randomUUID(), RAJ_CONTACT, null))));
        assertEquals("individualCounterpartContactIds must be omitted when splitMode is 'group'.",
                messageOf(() -> IndividualSplitRules.requireNoCounterpartForGroupMode(
                        request("group", UUID.randomUUID(), null, List.of(RAJ_CONTACT)))));
    }

    @Test
    void oneElementArrayEqualsTheLegacyField() {
        assertEquals(
                IndividualSplitRules.counterpartContactIds(request("individual", null, RAJ_CONTACT, null)),
                IndividualSplitRules.counterpartContactIds(
                        request("individual", null, null, List.of(RAJ_CONTACT))));
    }

    @Test
    void contactIdsKeepRequestOrder() {
        assertEquals(List.of(AMIT_CONTACT, RAJ_CONTACT), IndividualSplitRules.counterpartContactIds(
                request("individual", null, null, List.of(AMIT_CONTACT, RAJ_CONTACT))));
    }

    @Test
    void c6SameContactIdTwiceIsRejected() {
        assertEquals("The same person is listed more than once in individualCounterpartContactIds.",
                messageOf(() -> IndividualSplitRules.counterpartContactIds(
                        request("individual", null, null, List.of(RAJ_CONTACT, RAJ_CONTACT)))));
    }

    // =====================================================================
    // Counterpart checks
    // =====================================================================

    @Test
    void c7AnyUnresolvedIdIsOne404() {
        assertThrows(ContactNotFoundException.class, () -> IndividualSplitRules.inRequestOrder(
                List.of(RAJ_CONTACT, AMIT_CONTACT), List.of(RAJ_LINKED)));
    }

    @Test
    void loadedContactsComeBackInRequestOrder() {
        assertEquals(List.of(AMIT_UNLINKED, RAJ_LINKED), IndividualSplitRules.inRequestOrder(
                List.of(AMIT_CONTACT, RAJ_CONTACT), List.of(RAJ_LINKED, AMIT_UNLINKED)));
    }

    @Test
    void c8ContactLinkedToTheCallerIsRejected() {
        Contact self = contact(UUID.randomUUID(), "Me", HET);
        assertEquals("A split cannot be created with a contact that is linked to your own account.",
                messageOf(() -> IndividualSplitRules.requireValidCounterparts(
                        HET, List.of(AMIT_UNLINKED, self))));
    }

    @Test
    void c6TwoContactsLinkedToTheSameUserAreRejected() {
        Contact rajAgain = contact(UUID.randomUUID(), "Raj (work)", RAJ);
        assertEquals("The same person is listed more than once in individualCounterpartContactIds.",
                messageOf(() -> IndividualSplitRules.requireValidCounterparts(
                        HET, List.of(RAJ_LINKED, rajAgain))));
    }

    // =====================================================================
    // Normalisation (C9)
    // =====================================================================

    @Test
    void linkedContactIdIsASynonymForItsAccount() {
        List<IndividualSplitRules.Counterpart> counterparts =
                IndividualSplitRules.counterpartsOf(List.of(RAJ_LINKED, AMIT_UNLINKED));
        assertEquals(RAJ_ID, IndividualSplitRules.normalise(Identity.ofContact(RAJ_CONTACT), HET_ID, counterparts));
        assertEquals(RAJ_ID, IndividualSplitRules.normalise(RAJ_ID, HET_ID, counterparts));
        assertEquals(AMIT_ID, IndividualSplitRules.normalise(AMIT_ID, HET_ID, counterparts));
        assertEquals(HET_ID, IndividualSplitRules.normalise(HET_ID, HET_ID, counterparts));
    }

    @Test
    void c9AnyoneElseIsNotAParty() {
        List<IndividualSplitRules.Counterpart> counterparts =
                IndividualSplitRules.counterpartsOf(List.of(AMIT_UNLINKED));
        String expected = "On an individual split, every participant and the payer must be either the "
                + "caller or the named counterpart.";
        assertEquals(expected, messageOf(() -> IndividualSplitRules.normalise(
                Identity.ofUser(UUID.randomUUID()), HET_ID, counterparts)));
        // A non-selected contact, even one linked to a selected person, is not a synonym.
        List<IndividualSplitRules.Counterpart> withRaj =
                IndividualSplitRules.counterpartsOf(List.of(RAJ_LINKED));
        assertEquals(expected, messageOf(() -> IndividualSplitRules.normalise(
                Identity.ofContact(UUID.randomUUID()), HET_ID, withRaj)));
    }

    // =====================================================================
    // Ledger (ADR 0026 §4.3, §4.4 worked examples)
    // =====================================================================

    private static final List<Identity> EQUAL_PARTICIPANTS = List.of(HET_ID, RAJ_ID, AMIT_ID);
    private static final List<BigDecimal> EQUAL_SHARES =
            List.of(money("300.00"), money("300.00"), money("300.00"));

    @Test
    void example1HetPaid600RajPaid300() {
        List<PayerEntry> payers = List.of(
                new PayerEntry(HET_ID, money("600.00")), new PayerEntry(RAJ_ID, money("300.00")));
        BigDecimal netRaj = IndividualSplitRules.netOf(RAJ_ID, payers, EQUAL_PARTICIPANTS, EQUAL_SHARES);
        BigDecimal netAmit = IndividualSplitRules.netOf(AMIT_ID, payers, EQUAL_PARTICIPANTS, EQUAL_SHARES);
        BigDecimal netHet = IndividualSplitRules.netOf(HET_ID, payers, EQUAL_PARTICIPANTS, EQUAL_SHARES);
        assertEquals(0, netRaj.compareTo(BigDecimal.ZERO));
        assertEquals(0, netAmit.compareTo(money("-300.00")));
        assertEquals(0, netHet.compareTo(money("300.00")));
        IndividualSplitRules.requireZeroSum(netHet, List.of(netRaj, netAmit));

        // Het<->Amit contact row, left = Het: +300 (Amit owes Het 300).
        assertEquals(0, money("300.00").compareTo(IndividualSplitRules.signedPairDelta(
                contactRow(AMIT_CONTACT), HET, AMIT_ID, netAmit)));
        // Het<->Raj: zero on either orientation (still applied).
        assertEquals(0, BigDecimal.ZERO.compareTo(IndividualSplitRules.signedPairDelta(
                userPairRow(RAJ, HET), HET, RAJ_ID, netRaj)));
    }

    @Test
    void example2RajPaidAll900BothOrientations() {
        List<PayerEntry> payers = List.of(new PayerEntry(RAJ_ID, money("900.00")));
        BigDecimal netRaj = IndividualSplitRules.netOf(RAJ_ID, payers, EQUAL_PARTICIPANTS, EQUAL_SHARES);
        BigDecimal netAmit = IndividualSplitRules.netOf(AMIT_ID, payers, EQUAL_PARTICIPANTS, EQUAL_SHARES);
        BigDecimal netHet = IndividualSplitRules.netOf(HET_ID, payers, EQUAL_PARTICIPANTS, EQUAL_SHARES);
        assertEquals(0, netRaj.compareTo(money("600.00")));
        assertEquals(0, netHet.compareTo(money("-300.00")));
        IndividualSplitRules.requireZeroSum(netHet, List.of(netRaj, netAmit));

        // Creator is the stored LEFT side: Het owes Raj 600 -> -600.
        assertEquals(0, money("-600.00").compareTo(IndividualSplitRules.signedPairDelta(
                userPairRow(HET, RAJ), HET, RAJ_ID, netRaj)));
        // Counterpart is the stored LEFT side (unsigned-lesser, the real canonical
        // row for these two ids): same debt, opposite orientation -> +600.
        assertEquals(0, money("600.00").compareTo(IndividualSplitRules.signedPairDelta(
                userPairRow(RAJ, HET), HET, RAJ_ID, netRaj)));
        // Amit still owes Het 300: the routing consequence of ADR 0026 §1.1.
        assertEquals(0, money("300.00").compareTo(IndividualSplitRules.signedPairDelta(
                contactRow(AMIT_CONTACT), HET, AMIT_ID, netAmit)));
    }

    /**
     * ADR 0026 §4.3's proof, executed: with ONE counterpart the new per-pair delta
     * equals ADR 0025's paid(left) − share(left) on both orientations, so a
     * one-contact split's ledger result is unchanged.
     */
    @Test
    void oneCounterpartMatchesAdr0025Formula() {
        List<Identity> participants = List.of(HET_ID, RAJ_ID);
        List<BigDecimal> shares = List.of(money("250.00"), money("650.00"));
        List<PayerEntry> payers = List.of(
                new PayerEntry(HET_ID, money("700.00")), new PayerEntry(RAJ_ID, money("200.00")));
        BigDecimal netRaj = IndividualSplitRules.netOf(RAJ_ID, payers, participants, shares);

        for (IndividualBalance row : List.of(userPairRow(HET, RAJ), userPairRow(RAJ, HET))) {
            Identity left = Identity.ofUser(row.getUserId());
            BigDecimal adr0025 = IndividualSplitRules.netOf(left, payers, participants, shares);
            assertEquals(0, adr0025.compareTo(
                    IndividualSplitRules.signedPairDelta(row, HET, RAJ_ID, netRaj)));
        }
    }

    @Test
    void zeroSumViolationIsAProgrammingError() {
        assertThrows(IllegalStateException.class, () -> IndividualSplitRules.requireZeroSum(
                money("1.00"), List.of(money("-0.99"))));
    }

    @Test
    void rowThatIsNotThisPairIsAProgrammingError() {
        assertThrows(IllegalStateException.class, () -> IndividualSplitRules.signedPairDelta(
                userPairRow(UUID.randomUUID(), UUID.randomUUID()), HET, RAJ_ID, money("1.00")));
    }

    // =====================================================================
    // Lock order (ADR 0026 §4.5)
    // =====================================================================

    @Test
    void lockOrderIsRegisteredPairsFirstThenContactsByUnsignedId() {
        UUID neha = UUID.fromString("f0000000-0000-0000-0000-000000000003");
        Contact nehaLinked = contact(UUID.randomUUID(), "Neha", neha);
        Contact amitLow = contact(UUID.fromString("10000000-0000-0000-0000-0000000000c1"), "Amit", null);
        Contact zedHigh = contact(UUID.fromString("90000000-0000-0000-0000-0000000000c2"), "Zed", null);

        // Pair keys: (RAJ, HET) and (HET, NEHA) in unsigned order; RAJ < HET unsigned,
        // so Raj's pair sorts first even though HET.compareTo(RAJ) < 0 (signed).
        List<Contact> ordered = IndividualBalanceService.lockOrder(
                HET, List.of(zedHigh, nehaLinked, amitLow, RAJ_LINKED));
        assertEquals(List.of(RAJ_LINKED, nehaLinked, amitLow, zedHigh), ordered);

        // Request order does not matter: the same set gives the same lock order.
        assertEquals(ordered, IndividualBalanceService.lockOrder(
                HET, List.of(RAJ_LINKED, amitLow, nehaLinked, zedHigh)));
    }
}
