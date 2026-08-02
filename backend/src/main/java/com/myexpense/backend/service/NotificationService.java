package com.myexpense.backend.service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.ListNotificationsQuery;
import com.myexpense.backend.dto.response.MessageResponse;
import com.myexpense.backend.dto.response.NotificationResponse;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.entity.Notification;
import com.myexpense.backend.exception.NotificationNotFoundException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.NotificationRepository;
import com.myexpense.backend.repository.UserRepository;

/**
 * Business rules for the Notifications domain (api-overview.md §12.1–§12.3) —
 * one list and two mark-read writes.
 *
 * <h2>{@code read} is the only column this service writes, in the only table in
 * this domain that has a mutable one</h2>
 *
 * <p>{@code ActivityFanoutService} is still the <strong>only</strong> writer that
 * creates a notification; nothing here inserts or deletes a row, and nothing here
 * can change {@code type}, {@code message}, {@code notif_date} or
 * {@code notif_time} (three of those are mapped {@code updatable = false}, and
 * all four are server-composed at fan-out). The two writes below flip one boolean
 * and bump one timestamp.
 *
 * <h2>Owner scoping, and {@code 404} rather than {@code 403}</h2>
 *
 * <p>The caller's id arrives from the verified JWT via {@code @CurrentUserId}
 * (security-architecture.md §2). Every read and the mark-one-read lookup carry it
 * in their own predicate, so an unknown id and another account's id are one
 * identical {@code 404 NOTIFICATION_NOT_FOUND} — never a {@code 403}, which would
 * confirm to a non-owner that the id is real. There is no bare {@code findById}
 * call in this class.
 *
 * <p><strong>No membership check anywhere, and that is sufficient rather than
 * lax:</strong> notifications are fanned out one privately-owned row per
 * recipient, so {@code user_id} is the correct authorization test. This is the
 * opposite of Domain 6's {@code /groups} and {@code /splits} routes, where
 * ownership is the <em>wrong</em> test because a group row is legitimately shared.
 *
 * <h2>{@code updated_at}: two paths, two mechanisms, both deliberate</h2>
 *
 * <p>The database maintains {@code updated_at} nowhere in this schema ({@code V7}
 * contract item 2), so a mark-read that fails to move it would make a read
 * notification invisible to {@code /sync/pull} — it is the confirmed
 * last-write-wins cursor column (security-architecture.md §9), and {@code V13}
 * names {@code notifications} as the one table in this domain with "a real
 * mutation to propagate".
 *
 * <ul>
 *   <li><strong>§12.2 goes through the persistence context</strong>, where
 *       {@code @UpdateTimestamp} on {@code Notification#updatedAt} runs on flush.
 *       Nothing is assigned by hand, because assigning it would make the field
 *       dirty on an already-read row and bump the timestamp for a no-op.</li>
 *   <li><strong>§12.3 is a bulk UPDATE and sets it explicitly</strong>, because a
 *       bulk statement bypasses the persistence context and
 *       {@code @UpdateTimestamp} with it ({@code V13} contract item 4). See
 *       {@code NotificationRepository#markAllReadForUser} — the same trap, and the
 *       same fix, as {@code TransactionRepository#refreshCategorySnapshot}.</li>
 * </ul>
 *
 * <h2>Rollback: checked, not assumed</h2>
 *
 * <p>backend/README.md §3 records how the write-then-throw trap silently broke two
 * Domain 1 features: a method that writes and <em>then</em> throws needs
 * {@code noRollbackFor} on every transactional boundary in the call chain. There
 * is <strong>no {@code noRollbackFor} in this class and nothing here needs
 * one</strong>:
 *
 * <ul>
 *   <li>{@link #listNotifications} is {@code readOnly} and writes nothing;</li>
 *   <li>{@link #markRead} decides its only rejection — the {@code 404} — before it
 *       mutates anything, so there is no path that writes and then throws;</li>
 *   <li>{@link #markAllRead} issues one statement and cannot throw afterwards.</li>
 * </ul>
 *
 * <p>Re-check this conclusion if either write ever gains a follow-on step (an
 * audit row, a counter, a push dispatch) that must survive a later rejection.
 */
@Service
public class NotificationService {

    /**
     * The contract's {@code "HH:mm"} (api-overview.md §12.1). Formatted explicitly
     * for the reason {@code ActivityService#ACTIVITY_TIME_FORMAT} records in full.
     */
    private static final DateTimeFormatter NOTIF_TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");

    /**
     * §12.3's response text, specified verbatim by the contract
     * (api-overview.md §12.3: {@code {"message": "All notifications marked as
     * read."}}) and therefore a constant rather than an inline literal — it is a
     * contract value, not a log line.
     */
    private static final String ALL_MARKED_READ_MESSAGE = "All notifications marked as read.";

    private final NotificationRepository notificationRepository;
    private final UserRepository userRepository;

    public NotificationService(
            NotificationRepository notificationRepository,
            UserRepository userRepository) {
        this.notificationRepository = notificationRepository;
        this.userRepository = userRepository;
    }

    /**
     * {@code GET /api/v1/notifications} — paginated, newest first, optionally
     * filtered by {@code read} (api-overview.md §12.1).
     *
     * <p><strong>The branch is the whole method, and it exists to hit the right
     * index.</strong> {@code V13} created two: {@code (user_id, read)} serves
     * either filter value (and the unread count behind the badge), while
     * {@code (user_id, notif_date, notif_time)} serves the unfiltered
     * newest-first page. One query with a null-guarded {@code read} parameter
     * would put a bind where the planner needs a constant and could use neither
     * well — see {@code NotificationRepository} for the full argument.
     *
     * <p><strong>This is also the unread-count endpoint, by default rather than by
     * design.</strong> §12 defines no count endpoint ({@code V13} FLAG 3), so
     * ADR 0012 §4's {@code 1}–{@code 9} / {@code "9+"} badge reads
     * {@code totalElements} from {@code ?read=false} and discards {@code content}.
     * That is the contract-supported route and it is correctly indexed; the cost —
     * a page of rows the badge throws away, on every screen with a bell — and the
     * recommended fix are in backend/README.md §17.8. <strong>No
     * {@code /unread-count} endpoint is invented here</strong> (constitution
     * §15/§30).
     */
    @Transactional(readOnly = true)
    public PageResponse<NotificationResponse> listNotifications(UUID userId, ListNotificationsQuery query) {
        requireUser(userId);

        Pageable pageable = PageRequest.of(query.getPage(), query.getSize());
        Boolean readFilter = query.getRead();

        Page<Notification> page = readFilter == null
                ? notificationRepository.findByUserIdOrderByNotifDateDescNotifTimeDescIdDesc(userId, pageable)
                : notificationRepository.findByUserIdAndReadOrderByNotifDateDescNotifTimeDescIdDesc(
                        userId, readFilter, pageable);

        List<NotificationResponse> content = page.getContent().stream()
                .map(NotificationService::toResponse)
                .toList();
        return PageResponse.of(page, content);
    }

    /**
     * {@code PATCH /api/v1/notifications/{id}/read} — mark one notification read
     * (api-overview.md §12.2), returning the updated {@code NotificationResponse}
     * with {@code read: true}.
     *
     * <p>Owner-scoped in the lookup itself: an unknown id and another account's id
     * both produce {@code 404 NOTIFICATION_NOT_FOUND}, never {@code 403}.
     *
     * <p><strong>Marking an already-read notification read again is a {@code 200},
     * and it writes nothing.</strong> The operation is idempotent — which is
     * precisely why {@code V13} gives this table no {@code version} column — and
     * the guard below is what keeps it free of side effects: assigning
     * {@code read = true} to a row that already has it would still dirty the
     * entity, still issue an UPDATE, and still bump {@code updated_at}, which would
     * re-sync an unchanged row to every one of the user's devices. The same
     * reasoning as §12.3's {@code read = false} predicate, applied to one row.
     *
     * <p>No explicit {@code updatedAt} assignment here, on purpose:
     * {@code @UpdateTimestamp} runs on this path because the write goes through the
     * persistence context. The explicit bump belongs to the bulk statement, which
     * is the one that bypasses it.
     */
    @Transactional
    public NotificationResponse markRead(UUID userId, UUID notificationId) {
        requireUser(userId);

        Notification notification = notificationRepository.findByIdAndUserId(notificationId, userId)
                .orElseThrow(NotificationNotFoundException::new);

        if (!notification.isRead()) {
            notification.setRead(true);
            notificationRepository.save(notification);
        }

        return toResponse(notification);
    }

    /**
     * {@code PATCH /api/v1/notifications/read-all} — mark every unread
     * notification read (api-overview.md §12.3), returning the contract's
     * {@code MessageResponse}.
     *
     * <p><strong>One bulk UPDATE, never a page-and-loop.</strong> Loading the
     * caller's unread rows and saving each one would be the N+1 constitution §10
     * forbids and would also be unbounded in memory for an account that has not
     * opened the app in months.
     *
     * <p>The statement writes only rows that need it and sets {@code updated_at}
     * explicitly — both required by {@code V13} contract item 4, both argued in
     * {@code NotificationRepository#markAllReadForUser}. The timestamp is computed
     * here, in UTC, so the application stays the source of time ({@code V7}
     * contract item 2) and so one call cannot stamp two different instants onto
     * rows it wrote in one statement.
     *
     * <p><strong>Zero rows is a {@code 200}, not an error.</strong> §12.3 defines no
     * error at all, and "there was nothing unread" is a successful outcome of
     * "mark everything read" — the same response an account with a hundred unread
     * notifications gets. The affected-row count is deliberately <em>not</em>
     * returned: §12.3 specifies a fixed {@code MessageResponse} and adding a count
     * would be inventing a field (constitution §15/§30), unlike §3.4 where the
     * contract asks for one.
     */
    @Transactional
    public MessageResponse markAllRead(UUID userId) {
        requireUser(userId);

        notificationRepository.markAllReadForUser(userId, OffsetDateTime.now(ZoneOffset.UTC));

        return new MessageResponse(ALL_MARKED_READ_MESSAGE);
    }

    /**
     * Entity to DTO — a plain field copy with one conversion ({@code notifTime} to
     * the contract's {@code "HH:mm"}).
     *
     * <p>{@code userId} and {@code updatedAt} are deliberately not carried across:
     * every row returned already belongs to the caller, and {@code updated_at} is
     * a sync cursor rather than a display value (§12.1 lists neither).
     */
    private static NotificationResponse toResponse(Notification notification) {
        return new NotificationResponse(
                notification.getId(),
                notification.getType(),
                notification.getMessage(),
                notification.getNotifDate(),
                notification.getNotifTime().format(NOTIF_TIME_FORMAT),
                notification.isRead(),
                notification.getCreatedAt());
    }

    /**
     * A valid token whose user row no longer exists is a {@code 401}, not a
     * {@code 404} — the missing resource <em>is</em> the principal (the same rule
     * every domain since Domain 2 applies). A {@code null} principal is treated as
     * {@code 401} rather than thrown past, so a misconfigured
     * {@code @CurrentUserId} resolver can never reach the bulk UPDATE with a null
     * owner.
     */
    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }
}
