package com.myexpense.backend.repository;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.Activity;

/**
 * Persistence only (constitution §9) for {@code activities}.
 *
 * <p>Two methods: one write and one read. The write exists to satisfy one rule —
 * <strong>ONE MULTI-ROW INSERT PER TABLE PER EVENT, never one statement per
 * member</strong> ({@code V13} contract item 2, constitution §10's no-N+1 rule).
 * A five-member group event writes five rows in one statement.
 *
 * <h2>Why native SQL, and why {@code FROM users}</h2>
 *
 * <p>A multi-row insert over a caller-supplied id set has no JPQL form (JPQL has
 * no {@code INSERT ... SELECT} for arbitrary value lists, and {@code saveAll}
 * issues one statement per entity unless JDBC batching happens to be configured —
 * which is a provider setting, not a guarantee). Driving the insert from
 * {@code users} with an {@code IN} list is the same shape
 * {@link GroupMemberBalanceRepository}'s proven upserts already use, and it buys
 * one extra property: a recipient id that is not a real account simply inserts no
 * row instead of raising {@code fk_activities_user_id}. The statement is
 * <strong>fixed developer-written text with typed bound parameters</strong> —
 * nothing concatenated, nothing derived from client input
 * (security-architecture.md §12); the id set comes from
 * {@code group_members}/{@code individual_balances} rows read in the same
 * transaction, never from a request body.
 *
 * <p>{@code id} is omitted and supplied by {@code DEFAULT gen_random_uuid()} —
 * the same necessary departure from the application-assigned-id convention that
 * every multi-row insert in this backend makes.
 * {@code created_at}/{@code updated_at} are passed in rather than left to
 * {@code now()}, keeping the application the source of time ({@code V7} contract
 * item 2). Rows here are immutable, so {@code updated_at} will equal
 * {@code created_at} forever.
 *
 * <h2>Two calls per event, not one, and that is bounded rather than N+1</h2>
 *
 * <p>{@code activities} gets a row for <strong>the actor too</strong> ({@code V13}
 * contract item 2), and the actor's sentence genuinely differs from everyone
 * else's — "You paid ₹X…" versus "{name} paid ₹X…" (ADR 0008 §2.2's four
 * templates), and on an individual split even {@code entity_name} differs,
 * because each side's highlighted name is the <em>other</em> party. So
 * {@code ActivityFanoutService} calls this method twice: once for the actor, once
 * for every other affected member. That is <strong>two statements regardless of
 * how many members there are</strong> — the identical trade-off
 * {@link GroupMemberBalanceRepository} documents for its two per-member-kind
 * upserts, and it satisfies what item 2 is actually guarding against ("a
 * five-member group settlement is two INSERTs, not ten").
 *
 * <h2>The one read, added with Domain 7</h2>
 *
 * <p>{@link #findFiltered} is {@code GET /activities} (§11.1). It obeys the two
 * rules this file previously recorded for whoever would write it: it orders by
 * {@code activity_date DESC, activity_time DESC} and <strong>never by
 * {@code created_at}</strong> ({@code V13} contract item 3), and it joins
 * <strong>nothing</strong> — the four {@code related_*} targets are navigation
 * only, and {@code entity_name}/{@code icon_name}/{@code glyph}/{@code tone} are
 * on the row precisely so a page of twenty entries is one query (item 7).
 *
 * <p><strong>No write method is added and none ever should be.</strong>
 * {@code activities} rows are immutable: §11 is one {@code GET} and nothing else,
 * {@code ActivityFanoutService} remains the only producer of rows in this table,
 * and there is no update, delete or second insert path anywhere.
 */
public interface ActivityRepository extends JpaRepository<Activity, UUID> {

    /**
     * Inserts one activity row per recipient, in one statement.
     *
     * <p>Every caller-visible value is a bound parameter; the four
     * {@code related_*} ids and {@code entityName} are nullable and are cast
     * explicitly so PostgreSQL can type a {@code NULL} bind.
     *
     * @param userIds the recipients — must be non-empty (the service skips the
     *                call otherwise, because {@code IN ()} is a syntax error)
     * @return the number of rows inserted, which the caller compares against the
     *         recipient count so a silent partial fan-out cannot pass unnoticed
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into activities (user_id, type, activity_date, activity_time,
                                    description_prefix, entity_name, description_suffix,
                                    related_transaction_id, related_group_id, related_contact_id,
                                    related_split_expense_id, related_change_log_id,
                                    icon_name, glyph, tone,
                                    created_at, updated_at)
            select u.id, :type, cast(:activityDate as date), cast(:activityTime as time),
                   :descriptionPrefix, cast(:entityName as varchar), :descriptionSuffix,
                   cast(:relatedTransactionId as uuid), cast(:relatedGroupId as uuid),
                   cast(:relatedContactId as uuid), cast(:relatedSplitExpenseId as uuid),
                   cast(:relatedChangeLogId as uuid),
                   :iconName, :glyph, :tone,
                   cast(:now as timestamptz), cast(:now as timestamptz)
              from users u
             where u.id in (:userIds)
            """, nativeQuery = true)
    int insertFanout(
            @Param("userIds") Collection<UUID> userIds,
            @Param("type") String type,
            @Param("activityDate") LocalDate activityDate,
            @Param("activityTime") LocalTime activityTime,
            @Param("descriptionPrefix") String descriptionPrefix,
            @Param("entityName") String entityName,
            @Param("descriptionSuffix") String descriptionSuffix,
            @Param("relatedTransactionId") UUID relatedTransactionId,
            @Param("relatedGroupId") UUID relatedGroupId,
            @Param("relatedContactId") UUID relatedContactId,
            @Param("relatedSplitExpenseId") UUID relatedSplitExpenseId,
            // ADR 0027 §6.4: set only when the statement's single recipient is
            // the actor whose change_log row this entry explains.
            @Param("relatedChangeLogId") UUID relatedChangeLogId,
            @Param("iconName") String iconName,
            @Param("glyph") String glyph,
            @Param("tone") String tone,
            @Param("now") OffsetDateTime now);

    /**
     * {@code GET /api/v1/activities} — the caller's own feed, newest first,
     * paginated and optionally narrowed by any of §11.1's four {@code related_*}
     * filters.
     *
     * <h2>Owner scoping IS the access control here</h2>
     *
     * <p>{@code a.userId = :userId} is the whole authorization test, and that is a
     * deliberate difference from every V10/V11 table rather than a shortcut:
     * {@code activities} is <strong>fanned out one row per affected member, each
     * privately owned</strong>, so a shared event produces N rows and no row is
     * ever shared between two readers. <strong>No membership check is needed on
     * this read and none is added</strong> ({@code V13}'s own words on the table).
     * {@code :userId} always comes from the verified JWT via
     * {@code @CurrentUserId}, never from a request parameter
     * (security-architecture.md §2).
     *
     * <p>The consequence that makes the feed correct is the same fact read the
     * other way: §11.1's feed "includes fanned-out entries from shared-ledger
     * events other members triggered, not only entries the caller personally
     * caused." Those entries are <em>already the caller's own rows</em>, so no
     * extra clause produces them — which is exactly why a reviewer should not
     * expect one.
     *
     * <h2>Ordering: the DATE+TIME PAIR, made total by {@code id}</h2>
     *
     * <p>{@code order by a.activityDate desc, a.activityTime desc, a.id desc}.
     *
     * <ul>
     *   <li><strong>The pair is authoritative and {@code created_at} is not in the
     *       clause at all</strong> ({@code V13} contract item 3). This is the one
     *       place this domain departs from Domain 4's
     *       {@code txn_date, txn_time, created_at, id} shape, and the departure is
     *       required rather than stylistic: mixing {@code created_at} into one
     *       read path and not another is how two rows written in a single
     *       transaction come back in two different orders on two screens.</li>
     *   <li><strong>{@code id} is the tie-break, and it is what makes pagination
     *       stable.</strong> Some total order is mandatory or two rows sharing a
     *       date and a time are free to swap pages between requests — and
     *       same-date-and-time ties are the <em>normal</em> case here, not an edge
     *       case, because one fan-out writes several rows from one computed
     *       instant. {@code id} is the primary key, so the order is total by
     *       construction; it is not a second ordering fact competing with the
     *       pair, it is the deterministic resolution of its ties.</li>
     *   <li>{@code idx_activities_user_id_activity_date_time} is built for exactly
     *       the leading three columns. It is declared ASCENDING with no
     *       {@code DESC}, which serves this descending page directly: PostgreSQL
     *       scans a btree backwards and both ordering columns descend together, so
     *       the reversal is uniform.</li>
     * </ul>
     *
     * <h2>The filters, and why none of them is indexed</h2>
     *
     * <p>One fixed, developer-written query shape; each filter is a typed bound
     * {@link UUID} and a {@code null} disables its clause. The four combine as
     * <strong>AND</strong> — §11.1 states no "exactly one of" rule, unlike §9.3,
     * so none is imposed. Nothing a client sends becomes a field name, a table
     * name or a SQL fragment, and <strong>there is no {@code sort} parameter</strong>
     * (security-architecture.md §12.2).
     *
     * <p>{@code V13} deliberately created <strong>no index on the four
     * {@code related_*} columns</strong>, and that is still the right answer for
     * this query: every filtered read is also scoped by the caller, so the index
     * above supplies {@code user_id} <em>and</em> the ordering and the filter is a
     * cheap recheck over one user's rows — never a scan of the table. Four extra
     * indexes would be four extra entries per row on <em>every</em> fan-out insert
     * to speed up a secondary filter nobody has measured. If a filtered feed ever
     * becomes a real read path, the shape {@code V13} names for later is
     * {@code (user_id, related_group_id, activity_date)} and its siblings, measured
     * with {@code EXPLAIN ANALYZE} first (constitution §11).
     *
     * <p>An unknown, other-user or already-deleted filter id matches nothing and
     * yields an empty page rather than an error — §11.1 defines no error for these
     * parameters, and a {@code 404} would confirm whether an id is real. Note that
     * a deleted entity's id matches nothing for a second reason: the FK's
     * {@code ON DELETE SET NULL} has already cleared the column, which is what
     * keeps the row readable (its snapshot columns survive).
     *
     * <p>The {@code countQuery} is supplied explicitly rather than derived, matching
     * {@code TransactionRepository#findFiltered}'s precedent. <strong>Both halves
     * must keep the same {@code WHERE} clause — change them together.</strong>
     */
    @Query(value = """
            select a from Activity a
            where a.userId = :userId
              and (:transactionId is null or a.relatedTransactionId = :transactionId)
              and (:groupId is null or a.relatedGroupId = :groupId)
              and (:contactId is null or a.relatedContactId = :contactId)
              and (:splitExpenseId is null or a.relatedSplitExpenseId = :splitExpenseId)
            order by a.activityDate desc, a.activityTime desc, a.id desc
            """,
            countQuery = """
            select count(a) from Activity a
            where a.userId = :userId
              and (:transactionId is null or a.relatedTransactionId = :transactionId)
              and (:groupId is null or a.relatedGroupId = :groupId)
              and (:contactId is null or a.relatedContactId = :contactId)
              and (:splitExpenseId is null or a.relatedSplitExpenseId = :splitExpenseId)
            """)
    Page<Activity> findFiltered(
            @Param("userId") UUID userId,
            @Param("transactionId") UUID transactionId,
            @Param("groupId") UUID groupId,
            @Param("contactId") UUID contactId,
            @Param("splitExpenseId") UUID splitExpenseId,
            Pageable pageable);
}
