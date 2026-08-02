package com.myexpense.backend.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.CreateSettlementRequest;
import com.myexpense.backend.dto.request.SplitFeedQuery;
import com.myexpense.backend.dto.response.IndividualBalanceResponse;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.dto.response.SettlementResponse;
import com.myexpense.backend.dto.response.SplitFeedItemResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.IndividualBalanceService;
import com.myexpense.backend.service.SettlementService;
import com.myexpense.backend.service.SplitFeedService;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the two endpoints under {@code /api/v1/splits} —
 * Individual balances (api-overview.md §8.1) and Settle up (§10.1). Both require
 * {@code Authorization: Bearer <accessToken>}, which {@code SecurityConfig}
 * enforces before any method here runs.
 *
 * <p>One controller for two sections because they share a path prefix and neither
 * is more than a few lines; {@code /split-expenses} (§9) is a different prefix and
 * has its own controller.
 *
 * <p><strong>Both are MEMBERSHIP-GATED, and neither check is here.</strong>
 * {@code GET /splits/individuals} is gated by "the caller is a party to this pair"
 * — ADR 0023 §1.4 finally gives the API's §2 convention a call site for the second
 * half of its own definition — and {@code POST /splits/settle} is gated on the
 * group's membership or the pair's parties, <em>including the counterpart</em>.
 * Both live in the services, so there is exactly one place each rule can be got
 * wrong (ADR 0014 §1: "a controller-only security posture ... is insufficient once
 * a resource can legitimately be written to by more than one user").
 *
 * <p>The caller's identity arrives only via {@link CurrentUserId} — from the
 * verified JWT, never a path variable, a query parameter or a body field
 * (security-architecture.md §2).
 *
 * <p>The default per-user rate-limit tier covers both routes automatically
 * ({@code ApiRateLimitFilter} keys off every {@code /api/v1/**} path except
 * {@code /api/v1/auth/**}), so <strong>no second mechanism is added here</strong>.
 * Neither endpoint has an external side effect — no SMS, no payment provider — so
 * neither warrants the stricter tier {@code POST /contacts/{id}/invite} needed.
 *
 * <p><strong>No GET for settlements</strong>, deliberately: §10 defines exactly one
 * endpoint, and {@code V12} verified against the endpoint list that "no endpoint
 * reads this table at all in this phase" before declining every index on it.
 * A settlement-history endpoint is named for later in that migration.
 */
@RestController
@RequestMapping("/api/v1/splits")
public class SplitController {

    private final IndividualBalanceService individualBalanceService;
    private final SettlementService settlementService;
    private final SplitFeedService splitFeedService;

    public SplitController(
            IndividualBalanceService individualBalanceService,
            SettlementService settlementService,
            SplitFeedService splitFeedService) {
        this.individualBalanceService = individualBalanceService;
        this.settlementService = settlementService;
        this.splitFeedService = splitFeedService;
    }

    /**
     * §8.2 (ADR 0028 §7) — one pair's chronological feed: every split with a link
     * row to this pair (deleted ones as tombstones) and every settlement against
     * it. Party-gated in {@code SplitFeedService}:
     * {@code 404 INDIVIDUAL_BALANCE_NOT_FOUND}.
     */
    @GetMapping("/individuals/{id}/feed")
    public ResponseEntity<PageResponse<SplitFeedItemResponse>> getPairFeed(
            @CurrentUserId UUID userId, @PathVariable("id") UUID id, @Valid @ModelAttribute SplitFeedQuery query) {
        return ResponseEntity.ok(splitFeedService.pairFeed(userId, id, query));
    }

    /**
     * §8.1 — the caller's pairwise balances.
     *
     * <p>A plain array, not a {@code PageResponse}: the contract specifies
     * {@code IndividualBalanceResponse[]} and the set is bounded by one person's
     * counterparts.
     *
     * <p>Two properties of the body that are easy to get wrong on the client side
     * and are therefore worth stating here too (ADR 0023's Frontend follow-up):
     * <strong>{@code balance} arrives already oriented to the caller</strong> — do
     * not negate it again — and <strong>a pairwise balance is shared</strong>, so
     * it can change because the other party acted.
     */
    @GetMapping("/individuals")
    public ResponseEntity<List<IndividualBalanceResponse>> listIndividualBalances(
            @CurrentUserId UUID userId) {
        return ResponseEntity.ok(individualBalanceService.listIndividualBalances(userId));
    }

    /**
     * §10.1 — record a settlement against a group or a pairwise balance;
     * {@code 201 Created}.
     *
     * <p>Either party may record one — "this is a membership check, not a check
     * against 'did this specific principal originate the debt'".
     *
     * <p>Four distinct failures, and their codes are <strong>not</strong>
     * interchangeable: {@code 400 VALIDATION_ERROR} (field constraints, a target
     * shape that contradicts itself, or <strong>a direction the ledger
     * denies</strong>), {@code 400 AMOUNT_EXCEEDS_BALANCE} (the amount is greater
     * than the outstanding position — or than the lesser of the two positions on a
     * group settlement), {@code 404 GROUP_NOT_FOUND} (the caller <em>or the
     * counterpart</em> is not a member) and
     * {@code 404 INDIVIDUAL_BALANCE_NOT_FOUND}.
     */
    @PostMapping("/settle")
    public ResponseEntity<SettlementResponse> settle(
            @CurrentUserId UUID userId, com.myexpense.backend.sync.WriteContext writeContext,
            @Valid @RequestBody CreateSettlementRequest request) {
        // 201 on a settle and on a replay (current remainingBalance), ADR 0027 §4.3.
        return settlementService.settle(userId, request, writeContext).toResponseEntity();
    }
}
