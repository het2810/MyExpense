package com.myexpense.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.myexpense.backend.entity.SplitExpensePayer;

/**
 * ADR 0025 §5.2's payer order: primary first, then amount descending, ties by id
 * in PostgreSQL's UNSIGNED uuid order — the trap backend/README.md §16.5 note 2
 * records, where {@link UUID#compareTo} (signed) disagrees for about half of all
 * pairs.
 */
class SplitPayerOrderTest {

    /** Signed-negative high bits: Java's compareTo puts this FIRST, PostgreSQL LAST. */
    private static final UUID HIGH_BIT_ID = UUID.fromString("ffffffff-0000-0000-0000-000000000000");

    private static final UUID LOW_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private static SplitExpensePayer row(UUID id, UUID userId, String amount) {
        return SplitExpensePayer.builder()
                .id(id)
                .splitExpenseId(UUID.randomUUID())
                .payerUserId(userId)
                .amountPaid(new BigDecimal(amount))
                .build();
    }

    @Test
    void primaryComesFirstEvenWhenItIsNotTheLargestById() {
        UUID primaryUser = UUID.randomUUID();
        UUID otherUser = UUID.randomUUID();
        List<SplitExpensePayer> ordered = SplitExpenseResponseAssembler.orderForResponse(
                List.of(row(LOW_ID, otherUser, "450.00"), row(HIGH_BIT_ID, primaryUser, "450.00")),
                primaryUser, null);
        assertEquals(primaryUser, ordered.get(0).getPayerUserId());
    }

    @Test
    void restAreByAmountDescendingThenUnsignedId() {
        UUID primaryUser = UUID.randomUUID();
        List<SplitExpensePayer> ordered = SplitExpenseResponseAssembler.orderForResponse(
                List.of(row(HIGH_BIT_ID, UUID.randomUUID(), "100.00"),
                        row(LOW_ID, UUID.randomUUID(), "100.00"),
                        row(UUID.randomUUID(), UUID.randomUUID(), "200.00"),
                        row(UUID.randomUUID(), primaryUser, "600.00")),
                primaryUser, null);

        assertEquals(primaryUser, ordered.get(0).getPayerUserId());
        assertEquals(0, new BigDecimal("200.00").compareTo(ordered.get(1).getAmountPaid()));
        // The tie: PostgreSQL orders 00000000-... before ffffffff-...
        assertEquals(LOW_ID, ordered.get(2).getId());
        assertEquals(HIGH_BIT_ID, ordered.get(3).getId());
        // ...which is exactly where Java's signed UUID.compareTo disagrees.
        assertTrue(HIGH_BIT_ID.compareTo(LOW_ID) < 0);
    }
}
