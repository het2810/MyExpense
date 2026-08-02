package com.myexpense.backend.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.CreateCategoryRequest;
import com.myexpense.backend.dto.request.UpdateCategoryRequest;
import com.myexpense.backend.dto.response.CategoryDeletionResponse;
import com.myexpense.backend.dto.response.CategoryResponse;
import com.myexpense.backend.dto.response.CategoryUsageResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.CategoryService;
import com.myexpense.backend.sync.WriteContext;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the Categories domain (api-overview.md §3) — five
 * endpoints, all requiring {@code Authorization: Bearer <accessToken>}, which
 * {@code SecurityConfig} enforces before any method here runs.
 *
 * <p>The caller's identity arrives only via {@link CurrentUserId}, i.e. from
 * the verified JWT (security-architecture.md §2) — the same rule Domain 2
 * established. {@code {id}} in the PATCH, DELETE and usage paths identifies the
 * <em>category</em> being addressed, never the user: the service resolves it
 * with a lookup that is itself filtered by the authenticated user id, so an id
 * belonging to another account is a {@code 404}, not someone else's data.
 *
 * <p>The default per-user rate-limit tier covers all five routes automatically
 * ({@code ApiRateLimitFilter} keys off the {@code /api/v1/} prefix and excludes
 * only {@code /api/v1/auth/}), so <strong>no second mechanism was added for the
 * two new endpoints</strong> and neither warrants a stricter tier
 * (security-architecture.md §11/§12, ADR 0021 follow-up item 9).
 *
 * <p>Business rules (trimming, name uniqueness, the "omitted vs. explicitly
 * null" cap semantics, ownership, the protected row's per-field immutability,
 * the delete cascade, the reassignment and every subcategory rule) live in
 * {@link CategoryService}; this class only maps HTTP.
 *
 * <p><strong>A delete endpoint EXISTS as of 2026-10-25</strong> (ADR 0021 §2,
 * api-overview.md §3.4/§3.5), superseding the "no delete endpoint exists this
 * phase" note that stood here. It arrived with a second new route — the
 * side-effect-free usage pre-flight — because the app must warn before the user
 * confirms, and a client cannot derive that count from its own paginated
 * transactions store. <strong>Reparenting still does not exist</strong>
 * (ADR 0019 §9, unchanged by ADR 0021 §2.6), so the tree is deliberately
 * half-editable this round.
 *
 * <p><strong>Subcategories added no endpoint</strong> (ADR 0019 §7, 2026-10-22).
 * There is deliberately no {@code /categories/{id}/subcategories}
 * sub-resource: a subcategory <em>is</em> a category row, so one would
 * duplicate these methods' validation, trimming, uniqueness handling and
 * DTO mapping, and would create two shapes for one write (parent as a path
 * variable here, parent as a body field nowhere). The whole feature is one
 * optional request field on the POST and two added response fields — and the
 * delete endpoint inherited it as a cascade rather than as a second route.
 */
@RestController
@RequestMapping("/api/v1/categories")
public class CategoryController {

    private final CategoryService categoryService;

    public CategoryController(CategoryService categoryService) {
        this.categoryService = categoryService;
    }

    /**
     * §3.1 — list the caller's categories as a two-level tree: top-level
     * entries only at the root, each carrying its own {@code subcategories}.
     *
     * <p>A plain array, not a {@code PageResponse}: the contract specifies
     * {@code CategoryResponse[]} and the set is small and bounded (8 seeded
     * defaults plus the user's own additions, at either level).
     *
     * <p><strong>No {@code transactionCount} is added here, deliberately</strong>
     * (ADR 0021 §2.2): this is the app's most-read structural endpoint and an
     * aggregate over {@code transactions} would be computed for all eight rows
     * on every read to answer a question asked about one, rarely — and it would
     * be stale the moment it is cached. §3.5 answers that question instead.
     *
     * <p>Always the complete tree — {@code subcategoriesEnabled} (§2.3) is a
     * client affordance and never changes this response (ADR 0019 §6.1).
     */
    @GetMapping
    public ResponseEntity<List<CategoryResponse>> listCategories(@CurrentUserId UUID userId) {
        return ResponseEntity.ok(categoryService.listCategories(userId));
    }

    /** §3.2 — create a category, or a subcategory; {@code 201 Created}. */
    @PostMapping
    public ResponseEntity<CategoryResponse> createCategory(
            @CurrentUserId UUID userId, WriteContext writeContext,
            @Valid @RequestBody CreateCategoryRequest request) {
        // 201 on a create and on a replay (ADR 0027 §4.3).
        return categoryService.createCategory(userId, request, writeContext).toResponseEntity();
    }

    /**
     * §3.3 — partial update of name/icon/glyph/cap (owner-scoped), on either
     * level. A row's level is fixed at creation: the request DTO carries no
     * {@code parentCategoryId} and must not gain one (ADR 0019 §9).
     */
    @PatchMapping("/{id}")
    public ResponseEntity<CategoryResponse> updateCategory(
            @CurrentUserId UUID userId,
            @PathVariable("id") UUID id,
            WriteContext writeContext,
            @Valid @RequestBody UpdateCategoryRequest request) {
        // Superseded -> 409 WRITE_SUPERSEDED after the log rows committed.
        return categoryService.updateCategory(userId, id, request, writeContext).toResponseEntity();
    }

    /**
     * §3.4 — <strong>soft</strong>-delete a category (owner-scoped, ADR 0024),
     * cascading to its subcategories and reassigning every affected transaction
     * and every affected split expense the caller created to the caller's
     * protected {@code Misc} category. A deleted category is a {@code 404} on
     * every later request, a second delete included.
     *
     * <p><strong>{@code 200} with a body, not {@code 204}</strong> — the one
     * place this domain departs from {@code DELETE /transactions/{id}}'s
     * {@code 204}, because this delete mutates rows the caller did not name
     * (ADR 0021 §2.3). The two counts let a client invalidate exactly what
     * changed; a client that reads only the status code is still correct.
     *
     * <p>No request body and no query parameters: there is no two-phase delete,
     * no confirmation token, and §3.5's pre-flight count is never sent back
     * here.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<CategoryDeletionResponse> deleteCategory(
            @CurrentUserId UUID userId, @PathVariable("id") UUID id, WriteContext writeContext) {
        return categoryService.deleteCategory(userId, id, writeContext).toResponseEntity();
    }

    /**
     * §3.5 — the delete pre-flight: how many transactions and subcategories a
     * delete of {@code {id}} would affect (owner-scoped, side-effect-free).
     *
     * <p>A {@code GET} because it is a plain read that writes nothing and
     * reserves nothing. It is <strong>advisory</strong>: a client that cannot
     * reach it must show the unconditional warning rather than suppress it
     * (§3.5).
     *
     * <p>No {@code CATEGORY_PROTECTED} here, deliberately — asking about the
     * protected category is a legal question with a legal answer; only deleting
     * it is refused.
     */
    @GetMapping("/{id}/usage")
    public ResponseEntity<CategoryUsageResponse> getCategoryUsage(
            @CurrentUserId UUID userId, @PathVariable("id") UUID id) {
        return ResponseEntity.ok(categoryService.getCategoryUsage(userId, id));
    }
}
