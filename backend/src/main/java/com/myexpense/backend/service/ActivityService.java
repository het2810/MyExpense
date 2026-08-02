package com.myexpense.backend.service;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.ListActivitiesQuery;
import com.myexpense.backend.dto.response.ActivityResponse;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.entity.Activity;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.ActivityRepository;
import com.myexpense.backend.repository.UserRepository;

/**
 * Business rules for the Activity log (api-overview.md §11) — <strong>one
 * endpoint, one query, and no write path of any kind</strong>.
 *
 * <p>{@code activities} rows are immutable: §11 defines a single {@code GET} and
 * nothing else, so there is no create, update or delete method here and none
 * belongs here. {@code ActivityFanoutService} remains the <strong>only</strong>
 * producer of rows in this table, which is the property that makes the feed an
 * audit trail rather than a mutable list ({@code V13}: "an audit trail that can
 * be rewritten is not an audit trail"). This service only reads.
 *
 * <h2>Owner scoping, and why there is no membership check</h2>
 *
 * <p>The caller's id arrives from the verified JWT via {@code @CurrentUserId} and
 * is passed straight into the query's {@code user_id} predicate
 * (security-architecture.md §2). <strong>That predicate is the whole access
 * control</strong>, and unlike Domain 6's shared-ledger reads it is also
 * sufficient: the fan-out writes one privately-owned row per affected member, so
 * a shared event is N rows rather than one row with N readers.
 *
 * <p>The same fact is what makes §11.1's headline promise work with no extra
 * clause — the feed "includes fanned-out entries from shared-ledger events other
 * members triggered, not only entries the caller personally caused", because
 * those entries <em>are</em> the caller's own rows. A reviewer looking for the
 * code that pulls in other people's events will not find it, and should not.
 *
 * <h2>No join, for any row</h2>
 *
 * <p>{@code entityName}, {@code iconName}, {@code glyph} and {@code tone} are
 * snapshots on the row and are what render it; the four {@code related_*} ids are
 * navigation and filtering only. A page of twenty entries is therefore
 * <strong>one query</strong>, with nothing read from
 * {@code transactions}/{@code groups}/{@code contacts}/{@code split_expenses}
 * ({@code V13} contract item 7, constitution §10's no-N+1 rule). Joining them
 * would also reintroduce exactly the null-handling the {@code ON DELETE SET NULL}
 * cascade exists to avoid.
 *
 * <h2>Rollback: not applicable, stated rather than omitted</h2>
 *
 * <p>backend/README.md §3 records how the write-then-throw trap silently broke two
 * Domain 1 features: a method that writes and <em>then</em> throws needs
 * {@code noRollbackFor} on every transactional boundary in the call chain. There
 * is <strong>no {@code noRollbackFor} anywhere in this class, and nothing here
 * could need one</strong> — {@link #listActivities} is
 * {@code @Transactional(readOnly = true)} and performs no write at all, so there
 * is no write for a rollback to discard.
 */
@Service
public class ActivityService {

    /**
     * The contract's {@code "HH:mm"} (api-overview.md §11.1).
     *
     * <p>Formatted explicitly rather than left to Jackson, for the reason
     * {@code TransactionResponse#txnTime} records: {@code LocalTime}'s own
     * serialization emits {@code "HH:mm:ss"} whenever seconds are non-zero, and
     * the fan-out writes a wall-clock instant whose seconds almost never are.
     *
     * <p>A private constant rather than a shared utility, matching
     * {@code TransactionService}'s own. That makes this the third copy of a
     * two-token format string in {@code /backend}, which is the point at which
     * constitution §25 says to evaluate extraction — evaluated, and declined for
     * now: a shared holder used by three services would be a new type carrying one
     * field, and the three contracts could still legitimately diverge. Recorded in
     * backend/README.md §17.8 rather than left as an accident.
     */
    private static final DateTimeFormatter ACTIVITY_TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");

    private final ActivityRepository activityRepository;
    private final UserRepository userRepository;

    public ActivityService(ActivityRepository activityRepository, UserRepository userRepository) {
        this.activityRepository = activityRepository;
        this.userRepository = userRepository;
    }

    /**
     * {@code GET /api/v1/activities} — paginated, newest first, optionally
     * narrowed by any of §11.1's four {@code related_*} filters.
     *
     * <p>Paginated per the contract. §11.1 flags its own pagination as that
     * document's addition rather than a stated requirement ({@code V13} FLAG 4),
     * and it is implemented as written: a plain unpaginated array would be the
     * wrong default for the one table in this schema that grows without bound and
     * is never deleted from (constitution §11). {@link ListActivitiesQuery} caps
     * the page size, so no single request can be made to read the whole feed. The
     * ambiguity is flagged, not resolved, in backend/README.md §17.8.
     *
     * <p>Everything else — the four filters and the total newest-first ordering —
     * is one fixed JPQL query on {@code ActivityRepository#findFiltered}. This
     * method binds validated values and maps the page; it computes nothing.
     */
    @Transactional(readOnly = true)
    public PageResponse<ActivityResponse> listActivities(UUID userId, ListActivitiesQuery query) {
        requireUser(userId);

        Page<Activity> page = activityRepository.findFiltered(
                userId,
                query.getTransactionId(),
                query.getGroupId(),
                query.getContactId(),
                query.getSplitExpenseId(),
                PageRequest.of(query.getPage(), query.getSize()));

        List<ActivityResponse> content = page.getContent().stream()
                .map(ActivityService::toResponse)
                .toList();
        return PageResponse.of(page, content);
    }

    /**
     * Entity to DTO — a plain field copy with one conversion ({@code activityTime}
     * to the contract's {@code "HH:mm"}).
     *
     * <p>{@code userId} is deliberately not carried across: every row returned
     * already belongs to the caller by construction, so echoing an owner id would
     * only invite a client to start sending one back. {@code updatedAt} is not
     * carried either — it equals {@code createdAt} for the life of every row, and
     * §11.1 does not list it.
     */
    private static ActivityResponse toResponse(Activity activity) {
        return new ActivityResponse(
                activity.getId(),
                activity.getType(),
                activity.getActivityDate(),
                activity.getActivityTime().format(ACTIVITY_TIME_FORMAT),
                activity.getDescriptionPrefix(),
                activity.getEntityName(),
                activity.getDescriptionSuffix(),
                activity.getRelatedTransactionId(),
                activity.getRelatedGroupId(),
                activity.getRelatedContactId(),
                activity.getRelatedSplitExpenseId(),
                activity.getIconName(),
                activity.getGlyph(),
                activity.getTone(),
                activity.getCreatedAt(),
                activity.getRelatedChangeLogId());
    }

    /**
     * A valid token whose user row no longer exists is a {@code 401}, not an empty
     * page — the missing resource <em>is</em> the principal (the same rule every
     * domain since Domain 2 applies). A {@code null} principal is treated as
     * {@code 401} rather than thrown past, so a misconfigured
     * {@code @CurrentUserId} resolver fails loudly but safely instead of running a
     * query with a null owner.
     */
    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }
}
