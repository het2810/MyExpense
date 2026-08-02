package com.myexpense.backend.repository;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.Notification;

/**
 * Persistence only (constitution §9) for {@code notifications}.
 *
 * <p>The one insert follows the same rule and the same mechanism as
 * {@link ActivityRepository#insertFanout}: <strong>one multi-row INSERT per table
 * per event</strong> ({@code V13} contract item 2). Here it really is one
 * statement rather than two, because <strong>a notification never goes to the
 * actor</strong> — you do not notify someone of their own action — so there is no
 * second sentence to compose.
 *
 * <p>{@code read} is inserted as {@code false} explicitly rather than left to the
 * column default, matching this backend's convention of writing every value it
 * means (the same reason {@code group_members.role} is always written from
 * {@code GroupMember.ROLE_MEMBER}).
 *
 * <h2>The reads and the one bulk update, added with Domain 7</h2>
 *
 * <p>§12.1's two list queries, §12.2's owner-scoped lookup and §12.3's bulk
 * mark-all-read. Both rules {@code V13} recorded here for whoever would build
 * them are discharged, in the two places they bite:
 * <ul>
 *   <li><strong>{@code updated_at} is bumped explicitly in
 *       {@link #markAllReadForUser}</strong> — the database maintains it nowhere
 *       in this schema and a bulk UPDATE bypasses {@code @UpdateTimestamp}
 *       entirely (contract item 4). §12.2 goes through the persistence context
 *       instead, where {@code @UpdateTimestamp} does run; see
 *       {@code NotificationService#markRead}.</li>
 *   <li><strong>{@link #markAllReadForUser} writes only the rows that need
 *       it</strong> ({@code where userId = ? and read = false}) — that predicate
 *       is what {@code idx_notifications_user_id_read} exists for, and touching
 *       already-read rows would bump their {@code updated_at} for nothing.</li>
 * </ul>
 *
 * <p><strong>{@code read} is the only column any of this writes.</strong> There is
 * no insert here other than the fan-out above, no delete, and no path that can
 * change {@code type}, {@code message}, {@code notif_date} or {@code notif_time} —
 * every one of those is server-composed and frozen at fan-out
 * ({@code Notification}'s {@code updatable = false} mappings make three of them
 * structurally so).
 */
public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    /**
     * Inserts one unread notification per recipient, in one statement.
     *
     * @param userIds the recipients — <strong>never including the actor</strong>,
     *                and must be non-empty (the service skips the call otherwise,
     *                because {@code IN ()} is a syntax error). A split or
     *                settlement whose only affected registered party is the actor
     *                therefore writes no notification at all, which is correct
     *                rather than a gap.
     * @return the number of rows inserted
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into notifications (user_id, type, message, notif_date, notif_time, read,
                                       created_at, updated_at)
            select u.id, :type, :message, cast(:notifDate as date), cast(:notifTime as time), false,
                   cast(:now as timestamptz), cast(:now as timestamptz)
              from users u
             where u.id in (:userIds)
            """, nativeQuery = true)
    int insertFanout(
            @Param("userIds") Collection<UUID> userIds,
            @Param("type") String type,
            @Param("message") String message,
            @Param("notifDate") LocalDate notifDate,
            @Param("notifTime") LocalTime notifTime,
            @Param("now") OffsetDateTime now);

    /**
     * {@code GET /api/v1/notifications} with <strong>no</strong> {@code read}
     * filter (api-overview.md §12.1) — the caller's whole list, newest first.
     *
     * <p>Served by {@code idx_notifications_user_id_notif_date_time}, which
     * {@code V13} created for exactly this read: the specified
     * {@code (user_id, read)} index supplies the equality but nothing of the
     * ordering, so an unfiltered newest-first page would otherwise sort every one
     * of the user's notifications to return twenty of them.
     *
     * <p><strong>Ordering is the {@code notif_date}/{@code notif_time} pair, made
     * total by {@code id}, and {@code created_at} appears nowhere</strong> —
     * identical rule and identical reasoning as
     * {@code ActivityRepository#findFiltered}, which that method's Javadoc states
     * in full. A fan-out writes several rows per day from one computed instant, so
     * same-date-and-time ties are normal and the {@code id} tie-break is what
     * makes pagination stable.
     *
     * <p>A <strong>derived</strong> query rather than JPQL, and that is the one
     * design choice in this pair worth stating. Two methods map onto the two
     * indexes {@code V13} built, which a single {@code (:read is null or read =
     * :read)} query could not: that shape puts a parameter where the planner needs
     * a constant, so it cannot use {@code idx_notifications_user_id_read} for
     * either filter value. It also keeps the {@code ORDER BY} inside the method
     * <em>name</em>, where no client string can reach it, and it avoids binding a
     * null {@link Boolean} — which this backend has no precedent for, unlike the
     * null {@code UUID} binds {@code findFiltered} already relies on.
     */
    Page<Notification> findByUserIdOrderByNotifDateDescNotifTimeDescIdDesc(
            UUID userId, Pageable pageable);

    /**
     * {@code GET /api/v1/notifications?read=true|false} (api-overview.md §12.1) —
     * the same list narrowed to one value of {@code read}.
     *
     * <p>Served by {@code idx_notifications_user_id_read} for <strong>either</strong>
     * value, which is why {@code V13} declined the smaller partial index
     * {@code (user_id) WHERE read = FALSE}: a partial index only serves a query
     * whose predicate implies its own, so it could never answer {@code read=true}.
     *
     * <p>This is also the query behind <strong>the unread badge</strong>. §12
     * defines no count endpoint ({@code V13} FLAG 3), so ADR 0012 §4's
     * {@code 1}–{@code 9} / {@code "9+"} badge reads
     * {@code PageResponse.totalElements} from {@code read=false} — i.e. the count
     * half of this method's {@link Page}, which is
     * {@code select count(*) ... where user_id = ? and read = false}. Both columns
     * are in the index, so that is an index scan (index-only when the visibility
     * map allows) and never a heap scan of the user's rows. The page of rows the
     * badge discards is the known cost, and the recommendation is in
     * backend/README.md §17.8.
     *
     * <p>Ordering and the {@code id} tie-break are identical to the unfiltered
     * method above. Note this index supplies no ordering at all, so the ordered
     * page over the matching rows is a sort — correct, and bounded to one user's
     * rows of one {@code read} value. {@code V13} considered and declined a single
     * {@code (user_id, read, notif_date, notif_time)} index because {@code read}
     * sits between the user and the ordering columns, which would serve this
     * filtered read beautifully and the unfiltered one not at all.
     */
    Page<Notification> findByUserIdAndReadOrderByNotifDateDescNotifTimeDescIdDesc(
            UUID userId, boolean read, Pageable pageable);

    /**
     * {@code PATCH /api/v1/notifications/{id}/read} (api-overview.md §12.2) —
     * owner-scoped resolution.
     *
     * <p><strong>{@code userId} is part of the lookup, not a check applied
     * afterwards.</strong> An unknown id and another account's id both resolve to
     * empty and therefore to one identical {@code 404 NOTIFICATION_NOT_FOUND},
     * never a {@code 403} — there is deliberately no bare {@code findById} usage
     * in this domain's service (security-architecture.md §2). Ownership is the
     * whole access control: these rows are fanned out one per member, each
     * privately owned, so there is no membership question to ask.
     */
    Optional<Notification> findByIdAndUserId(UUID id, UUID userId);

    /**
     * {@code PATCH /api/v1/notifications/read-all} (api-overview.md §12.3) — one
     * bulk UPDATE over the caller's unread rows.
     *
     * <p><strong>{@code updatedAt} is set EXPLICITLY, and that is the single most
     * load-bearing line in this method</strong> ({@code V13} contract item 4). A
     * bulk JPQL update bypasses the persistence context entirely, so
     * {@code @UpdateTimestamp} never runs, and this schema has no trigger for it
     * either ({@code V7} contract item 2) — the database maintains
     * {@code updated_at} <em>nowhere</em>. Without the assignment, every row this
     * statement marks read would keep the timestamp it was inserted with.
     *
     * <p>This project has already been bitten by exactly this on the
     * category-rename propagation; {@code TransactionRepository#refreshCategorySnapshot}
     * is the established pattern and this method follows it deliberately.
     * {@code updated_at} is the confirmed last-write-wins / sync-cursor column
     * (security-architecture.md §9), and {@code V13} records that
     * {@code notifications} is the one table in this domain with "a real mutation
     * to propagate (a mark-read on one device must reach the others)" — so a
     * missing bump would mean a notification read on the phone stays unread on
     * every other device forever, with no error anywhere.
     *
     * <p><strong>{@code and n.read = false} is not an optimization.</strong> It is
     * what keeps the statement from bumping {@code updated_at} on rows that did
     * not change — which {@code V13} contract item 4 asks for by name, both
     * because the predicate is exactly what
     * {@code idx_notifications_user_id_read} indexes and because a needlessly
     * bumped row would re-sync to every device for no reason. It also makes the
     * endpoint cheaply idempotent: a second call matches zero rows and writes
     * nothing.
     *
     * <p>{@code n.userId = :userId} scopes the write. On a bulk UPDATE that clause
     * <em>is</em> the access control — there is no prior owner check to fall back
     * on, because no row is fetched first (security-architecture.md §2/§3).
     *
     * <p>{@code flushAutomatically} for consistency with every other bulk write in
     * this backend. <strong>No {@code clearAutomatically}</strong>: no
     * {@code Notification} entity is loaded in this transaction — the method is
     * called from a service method that fetches nothing — so there is nothing in
     * the persistence context to go stale.
     *
     * @return how many notifications were marked read; {@code 0} is normal and is
     *         <strong>not</strong> an error (an account with no unread
     *         notifications still gets §12.3's {@code 200})
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            update Notification n
               set n.read = true,
                   n.updatedAt = :updatedAt
             where n.userId = :userId
               and n.read = false
            """)
    int markAllReadForUser(
            @Param("userId") UUID userId,
            @Param("updatedAt") OffsetDateTime updatedAt);
}
