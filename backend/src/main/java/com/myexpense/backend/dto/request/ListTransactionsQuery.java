package com.myexpense.backend.dto.request;

import java.time.LocalDate;
import java.util.UUID;

import org.springframework.format.annotation.DateTimeFormat;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;

/**
 * Query parameters for {@code GET /api/v1/transactions} (api-overview.md §4.1)
 * — all optional, with the contract's own defaults for {@code page} and
 * {@code size}.
 *
 * <p><strong>A bound DTO rather than six loose {@code @RequestParam}s, so that
 * Bean Validation applies here too</strong> (security-architecture.md §12.3 —
 * "Bean Validation on every DTO, in every domain"; constraints placed directly
 * on controller parameters resolve through a different, less predictable
 * exception path). Spring binds each query parameter through this class's
 * setters and reports any binding or constraint failure as the standard
 * {@code 400 VALIDATION_ERROR} with the offending parameter named in
 * {@code fieldErrors}.
 *
 * <h2>Injection hardening (security-architecture.md §12.2, which names this
 * endpoint's filters as its own example)</h2>
 *
 * <p>Every field here is a <strong>typed, validated value</strong> bound as a
 * parameter against the single fixed query shape in
 * {@code TransactionRepository#findFiltered}. Nothing a client sends ever
 * becomes a field name, a table name or a SQL fragment, and there is
 * <strong>no {@code sort} parameter at all</strong> — the contract defines none,
 * so the {@code ORDER BY} is a literal in the repository and cannot be
 * influenced from outside. If sorting is ever added it must map through a fixed
 * allow-list, never pass a client string into an {@code ORDER BY}.
 *
 * <p>{@code scope} and {@code type} are validated Strings rather than enums
 * because Spring's default enum binding is case-sensitive on the enum
 * <em>constant name</em> ({@code EXPENSE}), while the contract's values are
 * lowercase ({@code expense}). Validating the exact contract literal here and
 * converting in the service keeps the accepted vocabulary identical to the
 * documented one, with no framework converter to register and nothing to
 * mis-register.
 */
public class ListTransactionsQuery {

    /**
     * Contract default. {@code size} is additionally <strong>capped</strong>:
     * an unbounded page size is a trivially-abusable way to make one request
     * read an entire table, which is the problem pagination exists to solve
     * (constitution §11). {@code 100} is a derived number — the contract gives
     * a default but no maximum — chosen as five pages' worth of the default and
     * flagged as an assumption in backend/README.md §13.
     */
    private static final int MAX_PAGE_SIZE = 100;

    @Pattern(regexp = "personal|group", message = "must be 'personal' or 'group'")
    private String scope;

    @Pattern(regexp = "expense|income", message = "must be 'expense' or 'income'")
    private String type;

    /**
     * Rolls up: a <strong>top-level</strong> id matches transactions tagged to
     * it and to any of its subcategories; a subcategory id matches that
     * subcategory alone (ADR 0019 §5). Never matches an income row, which has
     * no category — {@link #type} is the filter for that.
     *
     * <p>An unknown or other-user id yields an empty page rather than an error;
     * see {@code TransactionRepository#findFiltered} for why that is both the
     * truthful and the leak-free answer.
     */
    private UUID categoryId;

    /** Inclusive lower bound on {@code txn_date}. */
    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
    private LocalDate dateFrom;

    /**
     * Inclusive upper bound on {@code txn_date}.
     *
     * <p>A {@code dateFrom} later than {@code dateTo} is deliberately
     * <em>not</em> an error: it is a well-defined, empty range, the contract
     * defines no error for it, and rejecting it would be inventing one.
     */
    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
    private LocalDate dateTo;

    @Min(0)
    private int page = 0;

    @Min(1)
    @Max(MAX_PAGE_SIZE)
    private int size = 20;

    public String getScope() {
        return scope;
    }

    public void setScope(String scope) {
        this.scope = scope;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public UUID getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(UUID categoryId) {
        this.categoryId = categoryId;
    }

    public LocalDate getDateFrom() {
        return dateFrom;
    }

    public void setDateFrom(LocalDate dateFrom) {
        this.dateFrom = dateFrom;
    }

    public LocalDate getDateTo() {
        return dateTo;
    }

    public void setDateTo(LocalDate dateTo) {
        this.dateTo = dateTo;
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
