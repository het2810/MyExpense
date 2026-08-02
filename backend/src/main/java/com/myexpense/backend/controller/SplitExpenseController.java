package com.myexpense.backend.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.CreateSplitExpenseRequest;
import com.myexpense.backend.dto.request.ListSplitExpensesQuery;
import com.myexpense.backend.dto.request.UpdateSplitExpenseRequest;
import com.myexpense.backend.dto.response.SplitExpenseResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.SplitExpenseEditService;
import com.myexpense.backend.service.SplitExpenseService;
import com.myexpense.backend.sync.WriteContext;

import jakarta.validation.Valid;

/**
 * HTTP layer only for Split expenses (api-overview.md §9) — three endpoints, all
 * requiring {@code Authorization: Bearer <accessToken>}, which
 * {@code SecurityConfig} enforces before any method here runs.
 *
 * <p><strong>All three are MEMBERSHIP-GATED, and that check is not here.</strong>
 * §9 is "the write path that triggers the shared-ledger domain's central
 * correctness contract", and ADR 0014 §1 makes its point precisely about this
 * domain: an authenticated route is necessary and nowhere near sufficient once a
 * resource can legitimately be written to by more than one user.
 * {@code SplitExpenseService} re-derives membership of the <em>target</em> — the
 * group, or the pair — on every request and answers {@code 404}, never
 * {@code 403}. This class contains no authorization logic at all.
 *
 * <p>{@code {id}} always identifies the <strong>split expense</strong>, and the
 * caller's identity arrives only via {@link CurrentUserId} — from the verified
 * JWT, never a path variable, a query parameter or a body field.
 *
 * <p>The default per-user rate-limit tier covers all three routes automatically
 * ({@code ApiRateLimitFilter}), so no second mechanism is added here. §9.1 has no
 * external side effect: unlike §7's write paths it triggers no SMS, so there is
 * nothing for a bucket to protect that the default tier does not.
 *
 * <p><strong>PUT and DELETE since ADR 0028 (2026-11-12)</strong> — §9.4/§9.5. No
 * PATCH: amount, payers and participants are coupled by two exact-sum rules. The
 * DELETE is a soft delete (V19's {@code deleted_at}); nothing is hard-deleted.
 */
@RestController
@RequestMapping("/api/v1/split-expenses")
public class SplitExpenseController {

    private final SplitExpenseService splitExpenseService;
    private final SplitExpenseEditService splitExpenseEditService;

    public SplitExpenseController(
            SplitExpenseService splitExpenseService, SplitExpenseEditService splitExpenseEditService) {
        this.splitExpenseService = splitExpenseService;
        this.splitExpenseEditService = splitExpenseEditService;
    }

    /**
     * §9.4 (ADR 0028 §6) — edit a split expense; {@code 200} + the current
     * entity. Permission, LWW, U1/U2 and the ledger live in
     * {@link SplitExpenseEditService}. {@code 409 WRITE_SUPERSEDED} is raised here,
     * after the service's transaction committed its log rows.
     */
    @PutMapping("/{id}")
    public ResponseEntity<SplitExpenseResponse> updateSplitExpense(
            @CurrentUserId UUID userId,
            @PathVariable("id") UUID id,
            WriteContext writeContext,
            @Valid @RequestBody UpdateSplitExpenseRequest request) {
        return splitExpenseEditService.updateSplitExpense(userId, id, request, writeContext).toResponseEntity();
    }

    /**
     * §9.5 (ADR 0028 §2.3) — soft-delete a split expense; {@code 204}. Never
     * {@code 409}; an already-deleted split is {@code 404}, which clients treat
     * as success.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSplitExpense(
            @CurrentUserId UUID userId, @PathVariable("id") UUID id, WriteContext writeContext) {
        return splitExpenseEditService.deleteSplitExpense(userId, id, writeContext).toResponseEntity();
    }

    /**
     * §9.1 — create a split expense; {@code 201 Created}.
     *
     * <p>One transaction performs four things (see {@code SplitExpenseService}):
     * the participant-sum re-validation, the balance recalculation for every
     * affected member, the caller's own <strong>consumption-share</strong>
     * transaction if asked, and the {@code activities}/{@code notifications}
     * fan-out.
     *
     * <p>Errors: {@code 400 VALIDATION_ERROR} (field constraints, the target
     * shape, the payer/participant XORs, a duplicate participant, a participant who
     * is not a member of the named group, or <strong>a participant sum that does
     * not match {@code amount}</strong>), {@code 404 GROUP_NOT_FOUND},
     * {@code 404 CONTACT_NOT_FOUND} (the named counterpart contact is not the
     * caller's own), {@code 404 CATEGORY_NOT_FOUND}.
     */
    @PostMapping
    public ResponseEntity<SplitExpenseResponse> createSplitExpense(
            @CurrentUserId UUID userId, WriteContext writeContext,
            @Valid @RequestBody CreateSplitExpenseRequest request) {
        // 201 on a create and on a replay (ADR 0027 §4.3).
        return splitExpenseService.createSplitExpense(userId, request, writeContext).toResponseEntity();
    }

    /**
     * §9.2 — one split expense, same shape as the list item.
     *
     * <p>{@code 404 SPLIT_EXPENSE_NOT_FOUND} covers all three failure modes
     * identically: the id does not exist, it targets a group the caller is not a
     * member of, or it targets a pair the caller is not a party to.
     */
    @GetMapping("/{id}")
    public ResponseEntity<SplitExpenseResponse> getSplitExpense(
            @CurrentUserId UUID userId, @PathVariable("id") UUID id) {
        return ResponseEntity.ok(splitExpenseService.getSplitExpense(userId, id));
    }

    /**
     * §9.3 — a group's or a pair's history. <strong>Exactly one of
     * {@code groupId} or {@code individualBalanceId} is required</strong>; neither
     * or both is {@code 400 VALIDATION_ERROR}.
     *
     * <p><strong>Not paginated</strong>, per the contract: "the frontend's own
     * equivalent view has no pagination concept either". A plain array, like §8.1,
     * §6.1 and §7.1.
     *
     * <p>{@code @ModelAttribute} binds the two query parameters through
     * {@link ListSplitExpensesQuery} rather than as loose {@code @RequestParam}s,
     * so a malformed uuid resolves through {@code GlobalExceptionHandler}'s
     * API-wide {@code BindException} handler as a {@code 400} naming the parameter
     * — the same arrangement {@code GET /transactions} established.
     */
    @GetMapping
    public ResponseEntity<List<SplitExpenseResponse>> listSplitExpenses(
            @CurrentUserId UUID userId, @ModelAttribute ListSplitExpensesQuery query) {
        return ResponseEntity.ok(splitExpenseService.listSplitExpenses(userId, query));
    }
}
