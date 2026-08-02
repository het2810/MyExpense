package com.myexpense.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

/**
 * ADR 0026 §6.3: the 2+-counterpart templates, the per-recipient list, and the
 * requirement that one-counterpart output stays BYTE-IDENTICAL (Backend
 * follow-up item 8). Pure functions, no Spring context, no database.
 */
class ActivitySentencesMultiContactTest {

    private static final BigDecimal NINE_HUNDRED = new BigDecimal("900.00");

    private static final List<ActivityFanoutService.Counterpart> RAJ_AND_AMIT = List.of(
            new ActivityFanoutService.Counterpart(UUID.randomUUID(), "Raj"),
            new ActivityFanoutService.Counterpart(null, "Amit"));

    private static String full(ActivitySentences.Sentence sentence) {
        return sentence.prefix() + sentence.entityName() + sentence.suffix();
    }

    private static String joined(List<ActivityFanoutService.Counterpart> counterparts, int recipientIndex) {
        return ActivitySentences.joinPayerLabels(
                ActivityFanoutService.counterpartLabels(counterparts, recipientIndex));
    }

    @Test
    void creatorSentenceMatchesTheAdrExample() {
        ActivitySentences.Sentence sentence = ActivitySentences.splitSavedMultiContactForCreator(
                joined(RAJ_AND_AMIT, -1), NINE_HUNDRED, "Dinner");
        assertEquals("You split ₹900 for \"Dinner\" with ", sentence.prefix());
        assertEquals("Raj and Amit", sentence.entityName());
        assertEquals("You split ₹900 for \"Dinner\" with Raj and Amit.", full(sentence));
    }

    @Test
    void counterpartSentenceMatchesTheAdrExample() {
        assertEquals("Het split ₹900 for \"Dinner\" with you and Amit.",
                full(ActivitySentences.splitSavedMultiContactForCounterpart(
                        "Het", joined(RAJ_AND_AMIT, 0), NINE_HUNDRED, "Dinner")));
    }

    @Test
    void longListsUseTheOthersForm() {
        List<ActivityFanoutService.Counterpart> four = List.of(
                new ActivityFanoutService.Counterpart(UUID.randomUUID(), "Raj"),
                new ActivityFanoutService.Counterpart(null, "Amit"),
                new ActivityFanoutService.Counterpart(null, "Neha"),
                new ActivityFanoutService.Counterpart(null, "Zed"));
        assertEquals("Het split ₹2,000 for \"Trip\" with you, Amit and 2 others.",
                full(ActivitySentences.splitSavedMultiContactForCounterpart(
                        "Het", joined(four, 0), new BigDecimal("2000.00"), "Trip")));
    }

    @Test
    void notificationUsesTheRecipientsOwnList() {
        assertEquals("Het added \"Dinner\" (₹900) with you and Amit.",
                ActivitySentences.splitSavedMultiContactNotification(
                        "Het", joined(RAJ_AND_AMIT, 0), NINE_HUNDRED, "Dinner"));
    }

    /** With Q = "you", the new template equals today's individual notification exactly. */
    @Test
    void oneCounterpartNotificationIsByteIdentical() {
        String today = ActivitySentences.splitSavedNotification(false, null, "Het", NINE_HUNDRED, "Dinner");
        assertEquals("Het added \"Dinner\" (₹900) with you.", today);
        List<ActivityFanoutService.Counterpart> one =
                List.of(new ActivityFanoutService.Counterpart(UUID.randomUUID(), "Raj"));
        assertEquals(today, ActivitySentences.splitSavedMultiContactNotification(
                "Het", joined(one, 0), NINE_HUNDRED, "Dinner"));
    }

    /** The individual ADR 0008 §2.2 templates a one-counterpart split still writes. */
    @Test
    void oneCounterpartActivitySentencesAreByteIdentical() {
        assertEquals("You paid ₹900 to Raj for \"Dinner\".",
                full(ActivitySentences.splitSavedForPayer(false, "Raj", NINE_HUNDRED, "Dinner")));
        assertEquals("Raj paid ₹900 to you for \"Dinner\".",
                full(ActivitySentences.splitSavedForOther(false, null, "Raj", NINE_HUNDRED, "Dinner")));
        assertEquals("You and Raj paid ₹900 for \"Dinner\".",
                full(ActivitySentences.splitSavedMultiPayerForPair("Raj", NINE_HUNDRED, "Dinner")));
    }
}
