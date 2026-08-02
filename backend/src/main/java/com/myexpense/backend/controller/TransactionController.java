package com.myexpense.backend.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.CreateTransactionRequest;
import com.myexpense.backend.dto.request.ListTransactionsQuery;
import com.myexpense.backend.dto.request.UpdateTransactionRequest;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.dto.response.TransactionResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.TransactionService;
import com.myexpense.backend.sync.WriteContext;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the Transactions domain (api-overview.md §4) — five
 * endpoints, all requiring {@code Authorization: Bearer <accessToken>}, which
 * {@code SecurityConfig} enforces before any method here runs.
 *
 * <p>The caller's identity arrives only via {@link CurrentUserId}, i.e. from
 * the verified JWT (security-architecture.md §2) — the rule Domain 2
 * established and Domain 3 followed. {@code {id}} in the paths identifies the
 * <em>transaction</em>, never the user: the service resolves it with a lookup
 * that is itself filtered by the authenticated user id, so an id belonging to
 * another account is a {@code 404}, not someone else's data. A malformed
 * {@code {id}} is a {@code 400 VALIDATION_ERROR} through
 * {@code GlobalExceptionHandler}'s API-wide type-mismatch handler, added with
 * Domain 3.
 *
 * <p>Every business rule — the income snapshot, the five server-authoritative
 * snapshot values, the payment-mode arithmetic, the scope/group pairing, the
 * receipt claim check, optimistic concurrency and the soft delete — lives in
 * {@code TransactionService}. This class only maps HTTP.
 *
 * <p><strong>{@code POST /api/v1/receipts/upload-signature} is deliberately not
 * here</strong>, and not anywhere: api-overview.md lists it inside §4 because a
 * receipt is per-transaction, but the Cloudinary plan's signed-delivery support
 * is unconfirmed and no credentials exist (Project Owner, 2026-10-24). It is a
 * sequencing deferral, not a design gap — the column and the
 * {@code receiptPublicId} field land here either way, so receipts can be
 * finished later with no second migration. When it does land it belongs on its
 * own {@code /api/v1/receipts} controller (it addresses no transaction, which is
 * precisely what lets it be called before one exists) and it must generate its
 * {@code public_id} from {@code ReceiptPublicIdPolicy} rather than its own copy
 * of the path format.
 */
@RestController
@RequestMapping("/api/v1/transactions")
public class TransactionController {

    private final TransactionService transactionService;

    public TransactionController(TransactionService transactionService) {
        this.transactionService = transactionService;
    }

    /**
     * §4.1 — paginated, filterable list of the caller's own transactions.
     *
     * <p>A {@code PageResponse<TransactionResponse>}, not a plain array: the
     * contract specifies the envelope, and this is the first genuinely unbounded
     * list in the API (constitution §11). Domain 3's categories list stays a
     * plain array because its contract says so and the set is bounded.
     *
     * <p>The six query parameters are bound into a validated
     * {@link ListTransactionsQuery} rather than taken as loose
     * {@code @RequestParam}s, so Bean Validation covers them the same way it
     * covers request bodies (security-architecture.md §12.3) and so the
     * {@code page}/{@code size} bounds live next to their defaults. There is no
     * {@code sort} parameter — the contract defines none and the ordering is a
     * literal in the repository.
     */
    @GetMapping
    public ResponseEntity<PageResponse<TransactionResponse>> listTransactions(
            @CurrentUserId UUID userId,
            @Valid @ModelAttribute ListTransactionsQuery query) {
        return ResponseEntity.ok(transactionService.listTransactions(userId, query));
    }

    /** §4.2 — create a transaction; {@code 201 Created}. */
    @PostMapping
    public ResponseEntity<TransactionResponse> createTransaction(
            @CurrentUserId UUID userId,
            WriteContext writeContext,
            @Valid @RequestBody CreateTransactionRequest request) {
        // 201 on a create AND on a replay (ADR 0027 §4.3).
        return transactionService.createTransaction(userId, request, writeContext).toResponseEntity();
    }

    /**
     * §4.3 — one transaction (owner-scoped), with the premium payment-method
     * enrichment applied server-side.
     *
     * <p>This is the only endpoint in the API that may ever mint a
     * {@code receiptSignedUrl}, and only after its owner check has passed — that
     * ordering is the access control (ADR 0020 §6). Not implemented this pass.
     */
    @GetMapping("/{id}")
    public ResponseEntity<TransactionResponse> getTransaction(
            @CurrentUserId UUID userId,
            @PathVariable("id") UUID id) {
        return ResponseEntity.ok(transactionService.getTransaction(userId, id));
    }

    /**
     * §4.4 — partial update (owner-scoped). {@code version} is required in the
     * body; a stale one is {@code 409 VERSION_CONFLICT}.
     */
    @PatchMapping("/{id}")
    public ResponseEntity<TransactionResponse> updateTransaction(
            @CurrentUserId UUID userId,
            @PathVariable("id") UUID id,
            WriteContext writeContext,
            @Valid @RequestBody UpdateTransactionRequest request) {
        // A superseded LWW write has already committed its log rows when
        // toResponseEntity() maps it to 409 WRITE_SUPERSEDED (ADR 0027 §4.3).
        return transactionService.updateTransaction(userId, id, request, writeContext).toResponseEntity();
    }

    /**
     * §4.5 — soft delete (owner-scoped); {@code 204 No Content} with no body.
     *
     * <p>No request body and no {@code version} check: the contract gives this
     * endpoint neither. Deleting an already-deleted transaction is a
     * {@code 404}, because the row is excluded from every read in this domain.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteTransaction(
            @CurrentUserId UUID userId,
            @PathVariable("id") UUID id,
            WriteContext writeContext) {
        return transactionService.deleteTransaction(userId, id, writeContext).toResponseEntity();
    }
}
