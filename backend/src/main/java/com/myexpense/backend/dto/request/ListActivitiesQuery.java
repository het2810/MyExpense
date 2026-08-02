package com.myexpense.backend.dto.request;

import java.util.UUID;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Query parameters for {@code GET /api/v1/activities} (api-overview.md §11.1)
 * — all optional, with the contract's own defaults for {@code page} and
 * {@code size}.
 *
 * <p><strong>A bound DTO rather than six loose {@code @RequestParam}s</strong>,
 * so Bean Validation applies to query parameters exactly as it does to request
 * bodies (security-architecture.md §12.3; see {@link ListTransactionsQuery}'s
 * Javadoc for the full argument, which this class follows rather than restates).
 * A malformed uuid or an out-of-range {@code size} is a
 * {@link org.springframework.validation.BindException}, which
 * {@code GlobalExceptionHandler#handleBinding} — added with Domain 4 and
 * deliberately API-wide — already answers as {@code 400 VALIDATION_ERROR} with
 * the offending parameter named in {@code fieldErrors}. <strong>No second
 * validation mechanism and no new handler is added.</strong>
 *
 * <h2>Exactly four filters, because the contract defines exactly four</h2>
 *
 * <p>§11.1 offers {@code transactionId}, {@code groupId}, {@code contactId} and
 * {@code splitExpenseId}, which are precisely the four {@code related_*} columns
 * {@code activities} carries. Nothing else is accepted: there is
 * <strong>no {@code type} filter, no date range and no {@code settlementId}</strong>
 * — the last of those because there is no {@code related_settlement_id} column to
 * filter on ({@code V13} FLAG 1), so a settlement activity can be filtered by its
 * group or its contact and not by the settlement itself. Inventing any of the
 * three would be inventing API (constitution §15/§30).
 *
 * <p>The four are <strong>combinable</strong> and combine as AND. The contract
 * neither requires nor forbids that; one fixed query shape with four independent
 * null-guarded clauses is the simplest reading, and "exactly one of" (§9.3's
 * rule) is deliberately <em>not</em> imposed here because §11.1 does not state
 * it. Flagged in backend/README.md §17.8.
 *
 * <p>An unknown, deleted or other-user filter id yields an <strong>empty
 * page</strong> rather than an error — §11.1 defines no error for any of these
 * parameters, and a {@code 404} would confirm to a non-owner whether an id is
 * real (security-architecture.md §2). Every row in this feed already belongs to
 * the caller, so "matches nothing" is both the truthful and the leak-free answer.
 * Same rule, same reason, as §4.1's {@code categoryId}.
 *
 * <h2>Injection hardening (security-architecture.md §12.2)</h2>
 *
 * <p>Every field is a <strong>typed, validated value</strong> bound as a
 * parameter against the single fixed query shape in
 * {@code ActivityRepository#findFiltered}. Nothing a client sends ever becomes a
 * field name, a table name or a SQL fragment, and <strong>there is no
 * {@code sort} parameter</strong> — the contract defines none, so the
 * {@code ORDER BY} is a literal in the repository and cannot be influenced from
 * outside.
 */
public class ListActivitiesQuery {

    /**
     * Contract default. {@code size} is additionally <strong>capped</strong> for
     * the reason {@link ListTransactionsQuery} gives: an unbounded page size is a
     * trivially-abusable way to make one request read an entire table, which is
     * the problem pagination exists to solve (constitution §11).
     *
     * <p>{@code 100} is the same derived number Domain 4 chose, reused rather
     * than re-derived so two paginated endpoints cannot drift apart. It matters
     * more here than anywhere else in the API: {@code activities} is the one
     * table in this schema that <strong>grows without bound and is never deleted
     * from</strong> ({@code V13} FLAG 4).
     */
    private static final int MAX_PAGE_SIZE = 100;

    /** Navigation filter — {@code activities.related_transaction_id}. */
    private UUID transactionId;

    /** Navigation filter — {@code activities.related_group_id}. */
    private UUID groupId;

    /** Navigation filter — {@code activities.related_contact_id}. */
    private UUID contactId;

    /** Navigation filter — {@code activities.related_split_expense_id}. */
    private UUID splitExpenseId;

    @Min(0)
    private int page = 0;

    @Min(1)
    @Max(MAX_PAGE_SIZE)
    private int size = 20;

    public UUID getTransactionId() {
        return transactionId;
    }

    public void setTransactionId(UUID transactionId) {
        this.transactionId = transactionId;
    }

    public UUID getGroupId() {
        return groupId;
    }

    public void setGroupId(UUID groupId) {
        this.groupId = groupId;
    }

    public UUID getContactId() {
        return contactId;
    }

    public void setContactId(UUID contactId) {
        this.contactId = contactId;
    }

    public UUID getSplitExpenseId() {
        return splitExpenseId;
    }

    public void setSplitExpenseId(UUID splitExpenseId) {
        this.splitExpenseId = splitExpenseId;
    }

    public int getPage() {
        return page;
    }

    public void setPage(int page) {
        this.page = page;
    }

    public int getSize() {
        return size;
    }

    public void setSize(int size) {
        this.size = size;
    }
}
