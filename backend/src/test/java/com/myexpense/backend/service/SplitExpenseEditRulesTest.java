package com.myexpense.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.myexpense.backend.dto.request.SplitParticipantRequest;
import com.myexpense.backend.dto.request.UpdateSplitExpenseRequest;
import com.myexpense.backend.entity.PaymentMode;
import com.myexpense.backend.entity.Transaction;
import com.myexpense.backend.exception.SplitRuleViolationException;
import com.myexpense.backend.service.PersonalShareTransactionSync.FollowPlan;
import com.myexpense.backend.service.PersonalShareTransactionSync.SplitValues;
import com.myexpense.backend.service.SplitExpenseService.Identity;

/**
 * ADR 0028 §2.1 (permission), §4.3 (edit normalisation), §5.2 (personal
 * transaction follow) and §6.2 U1. Pure functions, no Spring, no database.
 */
class SplitExpenseEditRulesTest {

    private static final UUID CREATOR = UUID.fromString("80000000-0000-0000-0000-000000000001");
    private static final UUID MEMBER = UUID.fromString("10000000-0000-0000-0000-000000000002");
    private static final UUID RAJ = UUID.fromString("20000000-0000-0000-0000-000000000003");
    private static final UUID RAJ_CONTACT = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID OTHER_RAJ_CONTACT = UUID.fromString("00000000-0000-0000-0000-0000000000a9");
    private static final UUID AMIT_CONTACT = UUID.fromString("00000000-0000-0000-0000-0000000000a2");
    private static final UUID CATEGORY = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final UUID OTHER_CATEGORY = UUID.fromString("00000000-0000-0000-0000-0000000000c2");

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    // =====================================================================
    // §2.1 — who may edit or delete
    // =====================================================================

    @Test
    void anyGroupMemberMayEditAGroupSplit() {
        assertTrue(SplitExpenseEditService.mayEdit(true, CREATOR, MEMBER));
        assertTrue(SplitExpenseEditService.mayEdit(true, CREATOR, CREATOR));
    }

    @Test
    void onlyTheCreatorMayEditAnIndividualSplit() {
        assertTrue(SplitExpenseEditService.mayEdit(false, CREATOR, CREATOR));
        assertFalse(SplitExpenseEditService.mayEdit(false, CREATOR, RAJ));
    }

    // =====================================================================
    // §6.2 U1
    // =====================================================================

    private static UpdateSplitExpenseRequest update(Object splitMode, Object groupId, Object addToPersonal) {
        return new UpdateSplitExpenseRequest("Dinner", null, LocalDate.of(2026, 11, 12), money("900.00"),
                "equally", CREATOR, null, null,
                List.of(new SplitParticipantRequest(CREATOR, null, money("900.00"))),
                splitMode, groupId, null, null, addToPersonal, null, null);
    }

    @Test
    void noImmutableFieldMeansNoU1() {
        assertNull(update(null, null, null).firstImmutableFieldPresent());
    }

    @Test
    void anImmutableFieldIsNamedInAdrOrder() {
        assertEquals("splitMode", update("group", UUID.randomUUID(), null).firstImmutableFieldPresent());
        assertEquals("addToPersonalExpenses", update(null, null, false).firstImmutableFieldPresent());
        assertEquals("groupId can't be changed after a split expense is created. Delete it and add it again.",
                SplitRuleViolationException.fieldNotEditable("groupId").getMessage());
    }

    // =====================================================================
    // §4.3 — edit normalisation against the fixed audience
    // =====================================================================

    private static final Identity CREATOR_ID = Identity.ofUser(CREATOR);
    private static final Identity RAJ_ID = Identity.ofUser(RAJ);
    private static final Identity AMIT_ID = Identity.ofContact(AMIT_CONTACT);
    private static final List<Identity> AUDIENCE = List.of(RAJ_ID, AMIT_ID);
    private static final Map<UUID, UUID> LINKS = Map.of(RAJ_CONTACT, RAJ, OTHER_RAJ_CONTACT, RAJ);

    @Test
    void creatorAndCounterpartsNormaliseToThemselves() {
        assertEquals(CREATOR_ID, IndividualSplitRules.normaliseAgainstAudience(CREATOR_ID, CREATOR_ID, AUDIENCE, LINKS));
        assertEquals(RAJ_ID, IndividualSplitRules.normaliseAgainstAudience(RAJ_ID, CREATOR_ID, AUDIENCE, LINKS));
        assertEquals(AMIT_ID, IndividualSplitRules.normaliseAgainstAudience(AMIT_ID, CREATOR_ID, AUDIENCE, LINKS));
    }

    @Test
    void anyOfTheCreatorsContactsLinkedToAUserCounterpartIsASynonym() {
        assertEquals(RAJ_ID, IndividualSplitRules.normaliseAgainstAudience(
                Identity.ofContact(RAJ_CONTACT), CREATOR_ID, AUDIENCE, LINKS));
        assertEquals(RAJ_ID, IndividualSplitRules.normaliseAgainstAudience(
                Identity.ofContact(OTHER_RAJ_CONTACT), CREATOR_ID, AUDIENCE, LINKS));
    }

    @Test
    void anyoneElseIsNotAPartyToThePair() {
        assertThrows(SplitRuleViolationException.class, () -> IndividualSplitRules.normaliseAgainstAudience(
                Identity.ofUser(MEMBER), CREATOR_ID, AUDIENCE, LINKS));
        assertThrows(SplitRuleViolationException.class, () -> IndividualSplitRules.normaliseAgainstAudience(
                Identity.ofContact(UUID.randomUUID()), CREATOR_ID, AUDIENCE, LINKS));
    }

    // =====================================================================
    // §5.2 — personal transaction follow
    // =====================================================================

    private static final SplitValues BEFORE = new SplitValues(
            "Dinner", LocalDate.of(2026, 11, 1), CATEGORY, money("300.00"));

    private static Transaction transaction(String title, LocalDate date, UUID category, String amount,
            PaymentMode mode) {
        return Transaction.builder().id(UUID.randomUUID()).userId(CREATOR).title(title).txnDate(date)
                .categoryId(category).amount(money(amount)).paymentMode(mode).build();
    }

    private static Transaction untouched() {
        return transaction("Dinner", LocalDate.of(2026, 11, 1), CATEGORY, "300.00", PaymentMode.CASH);
    }

    @Test
    void anUntouchedTransactionFollowsEveryChangedField() {
        SplitValues after = new SplitValues("Team dinner", LocalDate.of(2026, 11, 2), OTHER_CATEGORY, money("400.00"));
        FollowPlan plan = PersonalShareTransactionSync.plan(untouched(), BEFORE, after);
        assertEquals(new FollowPlan(true, true, true, true, false), plan);
    }

    @Test
    void aDivergedFieldIsNeverOverwritten() {
        Transaction edited = transaction("My dinner", LocalDate.of(2026, 11, 1), CATEGORY, "250.00", PaymentMode.CASH);
        SplitValues after = new SplitValues("Team dinner", LocalDate.of(2026, 11, 2), CATEGORY, money("400.00"));
        FollowPlan plan = PersonalShareTransactionSync.plan(edited, BEFORE, after);
        assertEquals(new FollowPlan(false, true, false, false, false), plan);
    }

    @Test
    void aBothPaymentModeAmountNeverFollows() {
        Transaction both = transaction("Dinner", LocalDate.of(2026, 11, 1), CATEGORY, "300.00", PaymentMode.BOTH);
        SplitValues after = new SplitValues("Dinner", LocalDate.of(2026, 11, 1), CATEGORY, money("400.00"));
        assertEquals(FollowPlan.NONE, PersonalShareTransactionSync.plan(both, BEFORE, after));
        SplitValues zero = new SplitValues("Dinner", LocalDate.of(2026, 11, 1), CATEGORY, money("0.00"));
        assertFalse(PersonalShareTransactionSync.plan(both, BEFORE, zero).softDelete());
    }

    @Test
    void aZeroNewShareSoftDeletesWhenTheAmountWouldFollow() {
        SplitValues zero = new SplitValues("Dinner", LocalDate.of(2026, 11, 1), CATEGORY, money("0.00"));
        assertTrue(PersonalShareTransactionSync.plan(untouched(), BEFORE, zero).softDelete());
    }

    @Test
    void anAlreadyDeletedTransactionIsNeverTouchedOrResurrected() {
        Transaction deleted = untouched();
        deleted.setDeletedAt(OffsetDateTime.of(2026, 11, 3, 10, 0, 0, 0, ZoneOffset.UTC));
        SplitValues after = new SplitValues("Team dinner", LocalDate.of(2026, 11, 2), OTHER_CATEGORY, money("0.00"));
        assertEquals(FollowPlan.NONE, PersonalShareTransactionSync.plan(deleted, BEFORE, after));
        assertEquals(FollowPlan.NONE, PersonalShareTransactionSync.plan(null, BEFORE, after));
    }

    @Test
    void anUnchangedSplitChangesNothing() {
        assertFalse(PersonalShareTransactionSync.plan(untouched(), BEFORE, BEFORE).changesAnything());
    }
}
