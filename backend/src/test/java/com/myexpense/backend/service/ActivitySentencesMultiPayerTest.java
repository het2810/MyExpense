package com.myexpense.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.math.BigDecimal;
import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * ADR 0025 §6: the payer-list joiner, the 2+-payer templates, and the
 * requirement that single-payer sentences stay BYTE-IDENTICAL to the
 * pre-ADR-0025 ones (Backend follow-up item 7). Pure functions, no Spring
 * context, no database.
 */
class ActivitySentencesMultiPayerTest {

    private static final BigDecimal THOUSAND = new BigDecimal("1000.00");

    private static String full(ActivitySentences.Sentence sentence) {
        return sentence.prefix() + sentence.entityName() + sentence.suffix();
    }

    @Test
    void joinerFollowsAdr0025Section61() {
        assertEquals("A", ActivitySentences.joinPayerLabels(List.of("A")));
        assertEquals("A and B", ActivitySentences.joinPayerLabels(List.of("A", "B")));
        assertEquals("A, B and C", ActivitySentences.joinPayerLabels(List.of("A", "B", "C")));
        assertEquals("A, B and 2 others",
                ActivitySentences.joinPayerLabels(List.of("A", "B", "C", "D")));
        assertEquals("A, B and 3 others",
                ActivitySentences.joinPayerLabels(List.of("A", "B", "C", "D", "E")));
    }

    @Test
    void multiPayerGroupSentencesMatchTheAdrExamples() {
        assertEquals("You and Raj paid ₹1,000 in Goa Trip for \"Dinner\".",
                full(ActivitySentences.splitSavedMultiPayerInGroup(
                        "You and Raj", "Goa Trip", THOUSAND, "Dinner")));
        assertEquals("Het and Raj paid ₹1,000 in Goa Trip for \"Dinner\".",
                full(ActivitySentences.splitSavedMultiPayerInGroup(
                        "Het and Raj", "Goa Trip", THOUSAND, "Dinner")));
        assertEquals("Het, Raj and 2 others paid ₹1,000 in Goa Trip for \"Dinner\".",
                full(ActivitySentences.splitSavedMultiPayerInGroup(
                        ActivitySentences.joinPayerLabels(List.of("Het", "Raj", "Amit", "Neha")),
                        "Goa Trip", THOUSAND, "Dinner")));
    }

    @Test
    void multiPayerPairSentenceMatchesTheAdrExample() {
        ActivitySentences.Sentence sentence =
                ActivitySentences.splitSavedMultiPayerForPair("Raj", THOUSAND, "Dinner");
        assertEquals("You and ", sentence.prefix());
        assertEquals("Raj", sentence.entityName());
        assertEquals("You and Raj paid ₹1,000 for \"Dinner\".", full(sentence));
    }

    /** The four ADR 0008 §2.2 templates, unchanged by ADR 0025. */
    @Test
    void singlePayerSentencesAreByteIdentical() {
        BigDecimal amount = new BigDecimal("2500.00");
        assertEquals("You paid ₹2,500 in Goa Trip for \"Hotel\".",
                full(ActivitySentences.splitSavedForPayer(true, "Goa Trip", amount, "Hotel")));
        assertEquals("You paid ₹2,500 to Raj for \"Hotel\".",
                full(ActivitySentences.splitSavedForPayer(false, "Raj", amount, "Hotel")));
        assertEquals("Raj paid ₹2,500 in Goa Trip for \"Hotel\".",
                full(ActivitySentences.splitSavedForOther(true, "Goa Trip", "Raj", amount, "Hotel")));
        assertEquals("Raj paid ₹2,500 to you for \"Hotel\".",
                full(ActivitySentences.splitSavedForOther(false, null, "Raj", amount, "Hotel")));
    }
}
