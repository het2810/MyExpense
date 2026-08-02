package com.myexpense.backend.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.ListActivitiesQuery;
import com.myexpense.backend.dto.response.ActivityResponse;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.ActivityService;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the Activity log (api-overview.md §11) — <strong>one
 * endpoint, and §11 defines no second one</strong>. It requires
 * {@code Authorization: Bearer <accessToken>}, which {@code SecurityConfig}
 * enforces before this method runs.
 *
 * <p>There is <strong>no POST, PATCH or DELETE here, and none should be
 * added</strong>: an {@code activities} row is immutable and is written only by
 * the Domain 6 fan-out, in the same transaction as the ledger write that caused
 * it ({@code ActivityFanoutService}, api-overview.md §9.1 step 4 / §10.1 step 5).
 * A client-writable activity feed would be an audit trail a client can forge.
 *
 * <p>The caller's identity arrives only via {@link CurrentUserId}, i.e. from the
 * verified JWT (security-architecture.md §2). Every row returned is the caller's
 * own — including the entries fanned out from events other members triggered,
 * which are the caller's rows too.
 *
 * <p>The six query parameters bind into a validated {@link ListActivitiesQuery}
 * rather than loose {@code @RequestParam}s, so Bean Validation covers them the
 * same way it covers request bodies and a bad value is the API-wide
 * {@code 400 VALIDATION_ERROR} from {@code GlobalExceptionHandler#handleBinding}
 * — no second validation mechanism and no new handler. There is no {@code sort}
 * parameter: the contract defines none, so the ordering is a literal in the
 * repository.
 *
 * <p>Rate limiting needs nothing here. {@code ApiRateLimitFilter} (added with
 * Domain 2) keys the default per-user tier off every {@code /api/v1/**} path
 * except {@code /api/v1/auth/**}, so this path inherits it — and an owner-scoped
 * read warrants no stricter tier (security-architecture.md §11). Do not add a
 * second mechanism.
 */
@RestController
@RequestMapping("/api/v1/activities")
public class ActivityController {

    private final ActivityService activityService;

    public ActivityController(ActivityService activityService) {
        this.activityService = activityService;
    }

    /**
     * §11.1 — the caller's activity feed: paginated, newest first, filterable by
     * any of the four {@code related_*} ids.
     *
     * <p>A {@code PageResponse<ActivityResponse>}, not a plain array. §11.1 flags
     * its own pagination as that document's unconfirmed addition ({@code V13}
     * FLAG 4) and it is implemented as written — see
     * {@code ActivityService#listActivities} for why that is the right default for
     * this table, and backend/README.md §17.8 for the flag.
     */
    @GetMapping
    public ResponseEntity<PageResponse<ActivityResponse>> listActivities(
            @CurrentUserId UUID userId,
            @Valid @ModelAttribute ListActivitiesQuery query) {
        return ResponseEntity.ok(activityService.listActivities(userId, query));
    }
}
