package com.myexpense.backend.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.UpsertBudgetPeriodRequest;
import com.myexpense.backend.dto.response.BudgetPeriodResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.BudgetService;
import com.myexpense.backend.sync.WriteContext;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the Budget domain (api-overview.md §5) — three endpoints,
 * all requiring {@code Authorization: Bearer <accessToken>}, which
 * {@code SecurityConfig} enforces before any method here runs.
 *
 * <p>The caller's identity arrives only via {@link CurrentUserId}, i.e. from the
 * verified JWT (security-architecture.md §2). Neither request body nor path
 * carries a user id, and {@code UpsertBudgetPeriodRequest} deliberately has no
 * field for one.
 *
 * <p>{@code {id}} identifies the <em>period</em>, never the user: the service
 * resolves it with a lookup that is itself filtered by the authenticated user
 * id, so an id belonging to another account is a
 * {@code 404 BUDGET_PERIOD_NOT_FOUND} and never a {@code 403}. A malformed
 * {@code {id}} is a {@code 400 VALIDATION_ERROR} through
 * {@code GlobalExceptionHandler}'s API-wide type-mismatch handler.
 *
 * <p><strong>§5.1's {@code 404 NO_ACTIVE_PERIOD} is a normal, expected
 * answer</strong> — ADR 0011's post-auth gate calls this endpoint before it can
 * route anywhere, and the {@code 404} is what sends a brand-new account to Budget
 * Settings. After {@code V14} it is the answer for every existing user, because
 * nothing is backfilled.
 *
 * <p><strong>Three endpoints, and deliberately no fourth.</strong> §5 defines two
 * {@code GET}s and one {@code PUT}: there is no list endpoint (so nothing here is
 * paginated), no {@code DELETE} (deleting a period is blocked by its caps'
 * foreign key anyway, and no contract defines the semantics), and no
 * {@code /budget/periods/{id}/spent} — a server-computed spend figure is an API
 * contract change and the System Architect's call (backend/README.md §18.7).
 *
 * <p>Rate limiting needs nothing here: {@code ApiRateLimitFilter} keys the
 * default per-user tier off every {@code /api/v1/**} path except
 * {@code /api/v1/auth/**}, so these three are covered the moment they exist.
 * None has an external side effect — no SMS, no upload, no provider — so none
 * warrants a stricter tier (security-architecture.md §11). Do not add a second
 * mechanism.
 */
@RestController
@RequestMapping("/api/v1/budget")
public class BudgetController {

    private final BudgetService budgetService;

    public BudgetController(BudgetService budgetService) {
        this.budgetService = budgetService;
    }

    /**
     * §5.1 — the caller's most recently <strong>created</strong> period,
     * regardless of whether its {@code endDate} has passed. The client decides
     * "ended" itself.
     *
     * <p>{@code 404 NO_ACTIVE_PERIOD} when the caller has never saved one.
     */
    @GetMapping("/active-period")
    public ResponseEntity<BudgetPeriodResponse> getActivePeriod(@CurrentUserId UUID userId) {
        return ResponseEntity.ok(budgetService.getActivePeriod(userId));
    }

    /**
     * §5.2 — upsert: {@code 201 Created} for a new period, {@code 200 OK} when an
     * existing {@code id} was edited in place.
     *
     * <p>The status code is the one HTTP fact the body does not carry, so the
     * service reports which happened via a {@code WriteResult} and the
     * choice is made here — an HTTP concern, in the HTTP layer (constitution §9).
     *
     * <p>No {@code Location} header on the {@code 201}: §5.2 specifies none, and
     * the created resource's own URL (§5.3) is derivable from the {@code id} in
     * the body the client already has.
     *
     * <p><strong>Mapped at the collection path, not at {@code /{id}}</strong>,
     * exactly as §5.2 defines it. The optional {@code id} travels in the body
     * because one request serves both create and edit — the frontend's
     * {@code setPeriod} semantics — so there is no path variable to disagree with
     * it.
     */
    @PutMapping("/periods")
    public ResponseEntity<BudgetPeriodResponse> upsertPeriod(
            @CurrentUserId UUID userId,
            WriteContext writeContext,
            @Valid @RequestBody UpsertBudgetPeriodRequest request) {
        // Since ADR 0027 the service reports created/updated/superseded as a
        // WriteResult (which replaced BudgetPeriodUpsertResult); the status is
        // still chosen here. An id that exists nowhere now creates (201).
        return budgetService.upsertPeriod(userId, request, writeContext).toResponseEntity();
    }

    /**
     * §5.3 — one period by id, owner-scoped. The Budget Summary retrospective's
     * read, so a period that has already ended is the expected subject rather
     * than an edge case.
     */
    @GetMapping("/periods/{id}")
    public ResponseEntity<BudgetPeriodResponse> getPeriod(
            @CurrentUserId UUID userId,
            @PathVariable("id") UUID id) {
        return ResponseEntity.ok(budgetService.getPeriod(userId, id));
    }
}
