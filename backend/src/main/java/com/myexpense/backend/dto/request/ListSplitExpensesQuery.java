package com.myexpense.backend.dto.request;

import java.util.UUID;

/**
 * Query parameters for {@code GET /api/v1/split-expenses} (api-overview.md §9.3)
 * — "exactly one of {@code groupId} or {@code individualBalanceId} required".
 *
 * <p><strong>A bound DTO rather than two loose {@code @RequestParam}s, so that
 * query-parameter binding resolves through the same path Domain 4 already
 * established</strong> (security-architecture.md §12.3; see
 * {@link ListTransactionsQuery}'s Javadoc for the full argument). A malformed
 * uuid is a {@link org.springframework.validation.BindException}, which
 * {@code GlobalExceptionHandler#handleBinding} — added with Domain 4 and
 * deliberately API-wide — already answers as
 * {@code 400 VALIDATION_ERROR} with the offending parameter named in
 * {@code fieldErrors}. No new handler is needed and none is added.
 *
 * <h2>Why there are no Bean Validation annotations here at all</h2>
 *
 * <p>The only rule §9.3 states is "exactly one of", which is a cross-field rule
 * that no single-field constraint can express. It lives in
 * {@code SplitExpenseService} as
 * {@code SplitRuleViolationException#exactlyOneListFilterRequired()}, which is
 * also where the membership gate is — and the two must be evaluated in that
 * order, so splitting them across two layers would only make the order harder to
 * see.
 *
 * <h2>Injection hardening (security-architecture.md §12.2)</h2>
 *
 * <p>Both fields are typed, bound {@link UUID}s against two fixed derived
 * queries on {@code SplitExpenseRepository}. Nothing a client sends ever becomes
 * a field name, a table name or a SQL fragment, and <strong>there is no
 * {@code sort} parameter</strong> — the contract defines none, so the
 * {@code ORDER BY} is part of the repository method name and cannot be influenced
 * from outside.
 *
 * <h2>No pagination, per the contract</h2>
 *
 * <p>§9.3 returns a plain array: "not paginated in this phase — the frontend's own
 * equivalent view has no pagination concept either". So there is no {@code page}
 * or {@code size} here, and this endpoint is this domain's departure from
 * constitution §11 alongside {@code GET /contacts} and {@code GET /groups}.
 * Flagged in backend/README.md §16.6.
 */
public class ListSplitExpensesQuery {

    private UUID groupId;

    private UUID individualBalanceId;

    public UUID getGroupId() {
        return groupId;
    }

    public void setGroupId(UUID groupId) {
        this.groupId = groupId;
    }

    public UUID getIndividualBalanceId() {
        return individualBalanceId;
    }

    public void setIndividualBalanceId(UUID individualBalanceId) {
        this.individualBalanceId = individualBalanceId;
    }
}
