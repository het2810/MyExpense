package com.myexpense.backend.repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;

/**
 * Persistence only for ADR 0028 §7.2's feeds: <strong>one native
 * {@code UNION ALL} page query and one count query per target</strong>.
 *
 * <p>The page query returns {@code (item_type, id, occurred_on, occurred_at)}
 * only — no {@code SELECT *} (constitution §10) — and the service batch-loads
 * the page's split expenses and settlements afterwards (no N+1).
 *
 * <p><strong>Deliberately includes deleted split expenses</strong> (§7.3
 * tombstones), which is why every method name says {@code IncludingDeleted}
 * (ADR 0028 §3.6). Settlements are never deleted.
 *
 * <p>Order: {@code occurred_on DESC, occurred_at DESC, item_type ASC, id DESC} —
 * total and deterministic. {@code item_type} is compared with
 * {@code COLLATE "C"} so the tie-break cannot depend on the database locale.
 *
 * <p><strong>Every value is a bound parameter</strong>, including the time zone
 * ({@code settled_at AT TIME ZONE cast(:timeZone as text)}), which the service has
 * already validated against the IANA region ids. Nothing is concatenated
 * (security-architecture.md §12).
 *
 * <p>Indexes: the settlement branches use V19's
 * {@code idx_settlements_group_id_settled_at} /
 * {@code idx_settlements_individual_balance_id_settled_at}; the group split branch
 * uses {@code idx_split_expenses_group_id}; the pair branch uses
 * {@code idx_split_expense_individual_balances_balance_expense} (through the link
 * table, never {@code split_expenses.individual_balance_id} — ADR 0026 §3).
 */
@Repository
public class SplitFeedQueryRepository {

    /** One row of a feed page, before assembly. */
    public record FeedRow(String itemType, UUID id, LocalDate occurredOn, OffsetDateTime occurredAt) {
    }

    /** Package-private so a unit test pins the exact §7.2 order. */
    static final String ORDER_AND_PAGE = """
             order by occurred_on desc, occurred_at desc, item_type collate "C" asc, id desc
             limit :pageLimit offset :pageOffset
            """;

    static final String GROUP_PAGE = """
            select item_type, id, occurred_on, occurred_at from (
                select cast('split_expense' as text) as item_type, s.id as id,
                       s.split_date as occurred_on, s.created_at as occurred_at
                  from split_expenses s
                 where s.group_id = cast(:targetId as uuid)
                union all
                select cast('settlement' as text), st.id,
                       cast(st.settled_at at time zone cast(:timeZone as text) as date), st.settled_at
                  from settlements st
                 where st.group_id = cast(:targetId as uuid)
            ) feed
            """ + ORDER_AND_PAGE;

    private static final String GROUP_COUNT = """
            select (select count(*) from split_expenses s where s.group_id = cast(:targetId as uuid))
                 + (select count(*) from settlements st where st.group_id = cast(:targetId as uuid))
            """;

    static final String PAIR_PAGE = """
            select item_type, id, occurred_on, occurred_at from (
                select cast('split_expense' as text) as item_type, s.id as id,
                       s.split_date as occurred_on, s.created_at as occurred_at
                  from split_expense_individual_balances l
                  join split_expenses s on s.id = l.split_expense_id
                 where l.individual_balance_id = cast(:targetId as uuid)
                union all
                select cast('settlement' as text), st.id,
                       cast(st.settled_at at time zone cast(:timeZone as text) as date), st.settled_at
                  from settlements st
                 where st.individual_balance_id = cast(:targetId as uuid)
            ) feed
            """ + ORDER_AND_PAGE;

    private static final String PAIR_COUNT = """
            select (select count(*) from split_expense_individual_balances l
                     where l.individual_balance_id = cast(:targetId as uuid))
                 + (select count(*) from settlements st where st.individual_balance_id = cast(:targetId as uuid))
            """;

    private final EntityManager entityManager;

    public SplitFeedQueryRepository(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public List<FeedRow> findGroupPageIncludingDeleted(UUID groupId, String timeZone, int limit, int offset) {
        return page(GROUP_PAGE, groupId, timeZone, limit, offset);
    }

    public long countGroupIncludingDeleted(UUID groupId) {
        return count(GROUP_COUNT, groupId);
    }

    public List<FeedRow> findPairPageIncludingDeleted(UUID individualBalanceId, String timeZone, int limit, int offset) {
        return page(PAIR_PAGE, individualBalanceId, timeZone, limit, offset);
    }

    public long countPairIncludingDeleted(UUID individualBalanceId) {
        return count(PAIR_COUNT, individualBalanceId);
    }

    private List<FeedRow> page(String sql, UUID targetId, String timeZone, int limit, int offset) {
        Query query = entityManager.createNativeQuery(sql);
        query.setParameter("targetId", targetId);
        query.setParameter("timeZone", timeZone);
        query.setParameter("pageLimit", limit);
        query.setParameter("pageOffset", offset);
        List<?> rows = query.getResultList();
        List<FeedRow> result = new ArrayList<>(rows.size());
        for (Object raw : rows) {
            Object[] row = (Object[]) raw;
            result.add(new FeedRow(
                    String.valueOf(row[0]),
                    toUuid(row[1]),
                    toLocalDate(row[2]),
                    toOffsetDateTime(row[3])));
        }
        return result;
    }

    private long count(String sql, UUID targetId) {
        Query query = entityManager.createNativeQuery(sql);
        query.setParameter("targetId", targetId);
        return ((Number) query.getSingleResult()).longValue();
    }

    // Driver/Hibernate return types for native scalars vary by version, so the
    // three conversions accept every shape PostgreSQL's JDBC driver produces.

    private static UUID toUuid(Object value) {
        return value instanceof UUID uuid ? uuid : UUID.fromString(String.valueOf(value));
    }

    private static LocalDate toLocalDate(Object value) {
        if (value instanceof LocalDate date) {
            return date;
        }
        if (value instanceof java.sql.Date date) {
            return date.toLocalDate();
        }
        return LocalDate.parse(String.valueOf(value));
    }

    private static OffsetDateTime toOffsetDateTime(Object value) {
        if (value instanceof OffsetDateTime dateTime) {
            return dateTime.withOffsetSameInstant(ZoneOffset.UTC);
        }
        if (value instanceof Instant instant) {
            return instant.atOffset(ZoneOffset.UTC);
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant().atOffset(ZoneOffset.UTC);
        }
        if (value instanceof LocalDateTime local) {
            return local.atOffset(ZoneOffset.UTC);
        }
        return OffsetDateTime.parse(String.valueOf(value));
    }
}
