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
import com.myexpense.backend.dto.request.SplitPayerRequest;
import com.myexpense.backend.exception.SplitRuleViolationException;

/**
 * ADR 0025 §3 and §5.1 R1-R4: the request-shape payer rules. Pure functions, no
 * Spring context, no database. Group membership (R6), pair normalisation (R7)
 * and the post-normalisation duplicate check need a resolved target and are
 * covered by the Postman collection instead.
 */
class SplitPayerResolverTest {

    private static final UUID HET = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID RAJ = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID CONTACT = UUID.fromString("00000000-0000-0000-0000-000000000003");

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    private static CreateSplitExpenseRequest request(
            UUID paidByUserId, UUID paidByContactId, List<SplitPayerRequest> payers) {
        return new CreateSplitExpenseRequest(
                "Dinner", null, LocalDate.of(2026, 11, 6), money("900.00"), "group",
                UUID.randomUUID(), null, null, "equally", paidByUserId, paidByContactId, payers,
                List.of(new SplitParticipantRequest(HET, null, money("900.00"))), false, null, null);
    }

    private static String messageOf(Runnable action) {
        return assertThrows(SplitRuleViolationException.class, action::run).getMessage();
    }

    @Test
    void legacyFormBecomesOnePayerCarryingTheWholeAmount() {
        List<SplitPayerResolver.RequestedPayer> payers =
                SplitPayerResolver.resolve(request(HET, null, null));
        assertEquals(1, payers.size());
        assertEquals(HET, payers.get(0).userId());
        assertEquals(0, money("900.00").compareTo(payers.get(0).amount()));
    }

    @Test
    void r1aBothFormsAreRejected() {
        String message = messageOf(() -> SplitPayerResolver.resolve(request(HET, null,
                List.of(new SplitPayerRequest(HET, null, money("900.00"))))));
        assertEquals("Provide either paidByUserId/paidByContactId or payers, not both.", message);
    }

    @Test
    void r1bNeitherFormKeepsTheExistingMessage() {
        String message = messageOf(() -> SplitPayerResolver.resolve(request(null, null, null)));
        assertEquals("Exactly one of paidByUserId or paidByContactId is required.", message);
    }

    @Test
    void r2EachEntryNeedsExactlyOneIdentity() {
        String neither = messageOf(() -> SplitPayerResolver.resolve(request(null, null,
                List.of(new SplitPayerRequest(null, null, money("900.00"))))));
        String both = messageOf(() -> SplitPayerResolver.resolve(request(null, null,
                List.of(new SplitPayerRequest(HET, CONTACT, money("900.00"))))));
        assertEquals("Each payer must have exactly one of payerUserId or payerContactId.", neither);
        assertEquals(neither, both);
    }

    @Test
    void r3DuplicateAsSentIsRejected() {
        String message = messageOf(() -> SplitPayerResolver.resolve(request(null, null, List.of(
                new SplitPayerRequest(HET, null, money("450.00")),
                new SplitPayerRequest(HET, null, money("450.00"))))));
        assertEquals("The same person is listed more than once in payers.", message);
    }

    @Test
    void r4SumMustMatchExactly() {
        String message = messageOf(() -> SplitPayerResolver.requireSumEquals(
                money("900.00"), List.of(money("600.00"), money("299.99"))));
        assertEquals("Payer amounts must add up exactly to the split amount.", message);
        // Scale differences are not a mismatch: compareTo, not equals.
        SplitPayerResolver.requireSumEquals(money("900.00"), List.of(money("600"), money("300.0")));
    }

    @Test
    void primaryIsTheLargestAmountAndTheFirstOnATie() {
        assertEquals(1, SplitPayerResolver.primaryIndex(
                List.of(money("300.00"), money("600.00"))));
        assertEquals(0, SplitPayerResolver.primaryIndex(
                List.of(money("450.00"), money("450.00"))));
        assertEquals(1, SplitPayerResolver.primaryIndex(
                List.of(money("100.00"), money("400.00"), money("400.00"))));
    }

    @Test
    void multiPayerEntriesKeepRequestOrder() {
        List<SplitPayerResolver.RequestedPayer> payers = SplitPayerResolver.resolve(request(null, null,
                List.of(new SplitPayerRequest(RAJ, null, money("300.00")),
                        new SplitPayerRequest(null, CONTACT, money("600.00")))));
        assertEquals(RAJ, payers.get(0).userId());
        assertEquals(CONTACT, payers.get(1).contactId());
    }
}
