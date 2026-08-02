package com.myexpense.backend.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.CategoryStatisticsQuery;
import com.myexpense.backend.dto.response.CategoryStatisticsResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.StatisticsService;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the Statistics domain (api-overview.md §14) — one
 * endpoint, requiring {@code Authorization: Bearer <accessToken>}, which
 * {@code SecurityConfig} enforces before any method here runs.
 *
 * <p>The caller's identity arrives only via {@link CurrentUserId}, i.e. from the
 * verified JWT (security-architecture.md §2) — the rule Domain 2 established and
 * Domains 3 and 4 followed. There is deliberately no path variable and no
 * {@code userId} parameter of any kind: this endpoint can only ever aggregate
 * the caller's own rows.
 *
 * <p><strong>Why {@code /statistics} and not {@code /transactions/statistics}</strong>
 * (api-overview.md §14): this is a derived read model over transactions, not a
 * sub-resource of one, and the future dimensions ADR 0022 names (spend over
 * time, spend by payment mode) are siblings of this path rather than renames of
 * it. Each of those would be a new method here, never an extra field on the
 * response below.
 *
 * <p><strong>There is no drill-down endpoint, and that is a decision</strong>
 * (ADR 0022 §6). Tapping a slice calls the existing
 * {@code GET /transactions?categoryId=&dateFrom=&dateTo=}, which already filters
 * by category <em>with the parent→subcategory roll-up built in</em>, is already
 * paginated, already owner-scoped and already returns every display field a row
 * needs. The split of responsibility is the rule: <strong>this endpoint owns
 * every total; {@code GET /transactions} owns every list.</strong> Do not add a
 * {@code /statistics/categories/{id}/transactions} here.
 *
 * <p><strong>No premium check</strong> (ADR 0022 §7) — {@code 403
 * PREMIUM_REQUIRED} is not a valid response from this path, and
 * {@code StatisticsService} performs no {@code is_premium} read at all.
 *
 * <p>Rate limiting needs nothing here: {@code ApiRateLimitFilter} (added with
 * Domain 2) keys the default per-user tier off every {@code /api/v1/**} path
 * except {@code /api/v1/auth/**}, so this path is covered the moment it exists —
 * <strong>confirmed, not assumed</strong>, and no second mechanism was added
 * (security-architecture.md §11, backend/README.md §6). §14.1's own error table
 * assigns it the default tier and says no stricter one is warranted.
 */
@RestController
@RequestMapping("/api/v1/statistics")
public class StatisticsController {

    private final StatisticsService statisticsService;

    public StatisticsController(StatisticsService statisticsService) {
        this.statisticsService = statisticsService;
    }

    /**
     * §14.1 — expense spend per <strong>parent</strong> category for an
     * optional, inclusive date range, with subcategory spend rolled up and
     * nested.
     *
     * <p>A plain object, not a {@code PageResponse}: the response is one bounded
     * array (a user's top-level categories), the contract defines no envelope
     * for it, and pagination would be actively wrong here — a page of slices is
     * a chart that does not add up to its own total.
     *
     * <p>The two query parameters are bound into a validated
     * {@link CategoryStatisticsQuery} rather than taken as loose
     * {@code @RequestParam}s, so Bean Validation covers them the same way it
     * covers request bodies (security-architecture.md §12.3) — including the
     * cross-field {@code dateFrom <= dateTo} rule, which §14.1 makes a
     * {@code 400 VALIDATION_ERROR}. Failures surface through
     * {@code GlobalExceptionHandler}'s {@code BindException} handler, added with
     * Domain 4 for precisely this and <strong>reused rather than duplicated</strong>.
     *
     * <p>Zero spend is a {@code 200} with an empty array — never a {@code 404}
     * (ADR 0022 §5). This method has no other outcome to map.
     */
    @GetMapping("/categories")
    public ResponseEntity<CategoryStatisticsResponse> getSpendByCategory(
            @CurrentUserId UUID userId,
            @Valid @ModelAttribute CategoryStatisticsQuery query) {
        return ResponseEntity.ok(statisticsService.getSpendByCategory(userId, query));
    }
}
