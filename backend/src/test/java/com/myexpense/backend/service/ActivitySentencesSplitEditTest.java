package com.myexpense.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.myexpense.backend.exception.SplitRuleViolationException;
import com.myexpense.backend.service.SplitExpenseService.Identity;

/**
 * ADR 0028 §9.3/§9.4: effect clauses, split_edited/split_deleted sentences, the
 * replaced settlement sentences, and the feed's timeZone validation (§7.1).
 * Pure functions.
 */
class ActivitySentencesSplitEditTest {

    private static final UUID HET = UUID.fromString("80000000-0000-0000-0000-000000000001");
    private static final UUID RAJ = UUID.fromString("10000000-0000-0000-0000-000000000002");
    private static final UUID AMIT = UUID.fromString("20000000-0000-0000-0000-000000000003");

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    private static String full(ActivitySentences.Sentence sentence) {
        return ActivitySentences.flatten(sentence);
    }

    @Test
    void groupEffectClauses() {
        assertEquals(" You lent ₹500.", ActivitySentences.groupEffect(money("500.00"), false));
        assertEquals(" You borrowed ₹100.", ActivitySentences.groupEffect(money("-100.00"), false));
        assertEquals("", ActivitySentences.groupEffect(money("0.00"), false));
        assertEquals(" You're no longer owed ₹600 for this.", ActivitySentences.groupEffect(money("600.00"), true));
        assertEquals(" You no longer owe ₹300 for this.", ActivitySentences.groupEffect(money("-300.00"), true));
    }

    @Test
    void pairEffectClauses() {
        assertEquals(" Het Shah owes you ₹600 for this.", ActivitySentences.pairEffect("Het Shah", money("600.00"), false));
        assertEquals(" You owe Het Shah ₹450 for this.", ActivitySentences.pairEffect("Het Shah", money("-450.00"), false));
        assertEquals(" Raj no longer owes you ₹300 for this.", ActivitySentences.pairEffect("Raj", money("300.00"), true));
        assertEquals(" You no longer owe Raj ₹1,200.50 for this.",
                ActivitySentences.pairEffect("Raj", money("-1200.50"), true));
    }

    @Test
    void clausesPerRecipientFollowSection94() {
        Map<Identity, BigDecimal> nets = Map.of(Identity.ofUser(HET), money("500.00"),
                Identity.ofUser(RAJ), money("-100.00"), Identity.ofUser(AMIT), money("-400.00"));
        Set<UUID> recipients = new LinkedHashSet<>(List.of(HET, RAJ, AMIT));
        Map<UUID, String> clauses = SplitEffectClauses.forGroup(recipients, nets, false);
        assertEquals(" You lent ₹500.", clauses.get(HET));
        assertEquals(" You borrowed ₹100.", clauses.get(RAJ));
        assertEquals(" You borrowed ₹400.", clauses.get(AMIT));
    }

    @Test
    void individualClausesUseTheRecipientsSide() {
        // Raj paid all of ₹900, equal three ways: net(Raj) = +600 → Het owes Raj.
        List<SplitEffectClauses.PairParty> one = List.of(new SplitEffectClauses.PairParty(RAJ, "Raj Mehta", money("600.00")));
        Map<UUID, String> clauses = SplitEffectClauses.forIndividual(Set.of(HET, RAJ), HET, "Het Shah", one, false);
        assertEquals(" You owe Raj Mehta ₹600 for this.", clauses.get(HET));
        assertEquals(" Het Shah owes you ₹600 for this.", clauses.get(RAJ));

        List<SplitEffectClauses.PairParty> two = List.of(
                new SplitEffectClauses.PairParty(RAJ, "Raj Mehta", money("600.00")),
                new SplitEffectClauses.PairParty(null, "Amit", money("-300.00")));
        Map<UUID, String> multi = SplitEffectClauses.forIndividual(Set.of(HET, RAJ), HET, "Het Shah", two, false);
        assertEquals("", multi.get(HET));
    }

    @Test
    void splitChangedSentences() {
        assertEquals("You edited \"Dinner\" in Goa Trip. You lent ₹500.", full(ActivitySentences.splitChanged(
                "edited", true, null, "Dinner", "Goa Trip", null, " You lent ₹500.")));
        assertEquals("Raj Mehta deleted \"Dinner\" from Goa Trip. You no longer owe ₹300 for this.",
                full(ActivitySentences.splitChanged("deleted", true, "Raj Mehta", "Dinner", "Goa Trip", null,
                        " You no longer owe ₹300 for this.")));
        assertEquals("You edited \"Dinner\" with Raj Mehta and Amit.", full(ActivitySentences.splitChanged(
                "edited", false, null, "Dinner", null, "Raj Mehta and Amit", "")));
        assertEquals("Het Shah deleted \"Dinner\".", full(ActivitySentences.splitChanged(
                "deleted", false, "Het Shah", "Dinner", null, null, "")));
        // Group mode highlights the group name.
        assertEquals("Goa Trip", ActivitySentences.splitChanged(
                "edited", true, null, "Dinner", "Goa Trip", null, "").entityName());
    }

    @Test
    void settlementSentencesNamePayerAndPayee() {
        assertEquals("You paid Amit Shah ₹120 in Goa Trip.",
                full(ActivitySentences.groupSettlement(null, "Amit Shah", money("120.00"), "Goa Trip")));
        assertEquals("Ritu Gupta paid you ₹1,443.40 in Goa Trip.",
                full(ActivitySentences.groupSettlement("Ritu Gupta", null, money("1443.40"), "Goa Trip")));
        assertEquals("Ritu Gupta paid Dhruv Chawla ₹50 in Goa Trip.",
                full(ActivitySentences.groupSettlement("Ritu Gupta", "Dhruv Chawla", money("50.00"), "Goa Trip")));
        assertEquals("You paid Raj Mehta ₹250. You're all settled up.",
                full(ActivitySentences.pairSettlement(true, "Raj Mehta", money("250.00"), money("0.00"))));
        assertEquals("Raj Mehta paid you ₹250. Raj Mehta now owes you ₹100.",
                full(ActivitySentences.pairSettlement(false, "Raj Mehta", money("250.00"), money("100.00"))));
        assertEquals("You paid Raj Mehta ₹250. You now owe Raj Mehta ₹50.",
                full(ActivitySentences.pairSettlement(true, "Raj Mehta", money("250.00"), money("-50.00"))));
    }

    @Test
    void feedTimeZoneMustBeAnIanaRegion() {
        assertEquals("Asia/Kolkata", SplitFeedService.requireTimeZone("Asia/Kolkata"));
        assertEquals("UTC", SplitFeedService.requireTimeZone(null));
        assertEquals("UTC", SplitFeedService.requireTimeZone(""));
        // Raw offsets are refused: PostgreSQL reads POSIX offsets with the opposite sign.
        assertThrows(SplitRuleViolationException.class, () -> SplitFeedService.requireTimeZone("+05:30"));
        assertThrows(SplitRuleViolationException.class, () -> SplitFeedService.requireTimeZone("Mars/Base'; --"));
    }
}
