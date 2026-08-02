package com.myexpense.backend.repository;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * ADR 0028 §7.2 — pins the feed's ORDER BY and its injection-safe shape without
 * a database. The ordering itself (across a day boundary in Asia/Kolkata vs UTC,
 * tombstones, pagination totals) needs the integration suite: it is executed by
 * PostgreSQL, not by Java.
 */
class SplitFeedQueryShapeTest {

    private static String normalise(String sql) {
        return sql.replaceAll("\\s+", " ").trim();
    }

    @Test
    void orderIsTotalAndDeterministic() {
        String order = normalise(SplitFeedQueryRepository.ORDER_AND_PAGE);
        assertTrue(order.startsWith(
                "order by occurred_on desc, occurred_at desc, item_type collate \"C\" asc, id desc"));
        assertTrue(order.contains("limit :pageLimit offset :pageOffset"));
    }

    @Test
    void bothFeedsBindTheTimeZoneAndNeverFilterDeletedSplits() {
        for (String sql : new String[] {SplitFeedQueryRepository.GROUP_PAGE, SplitFeedQueryRepository.PAIR_PAGE}) {
            String text = normalise(sql);
            assertTrue(text.contains("at time zone cast(:timeZone as text)"));
            assertFalse(text.contains("deleted_at"), "tombstones must stay in the feed (§7.3)");
            assertFalse(text.contains("*"), "no SELECT * (constitution §10)");
        }
        // The pair feed goes through the link table, never split_expenses.individual_balance_id.
        assertTrue(normalise(SplitFeedQueryRepository.PAIR_PAGE).contains("split_expense_individual_balances l"));
        assertFalse(normalise(SplitFeedQueryRepository.PAIR_PAGE).contains("s.individual_balance_id"));
    }
}
