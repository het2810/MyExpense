package com.myexpense.backend.dto.request;

import java.time.LocalDate;

import org.springframework.format.annotation.DateTimeFormat;

import jakarta.validation.constraints.AssertTrue;

/**
 * Query parameters for {@code GET /api/v1/statistics/categories}
 * (api-overview.md §14.1) — <strong>two, both optional</strong>, and
 * deliberately no others.
 *
 * <p><strong>A bound DTO rather than two loose {@code @RequestParam}s</strong>,
 * for the reason {@link ListTransactionsQuery} already records
 * (security-architecture.md §12.3 — "Bean Validation on every DTO, in every
 * domain"): constraints placed directly on controller parameters resolve
 * through a different, less predictable exception path. Spring binds each query
 * parameter through this class's setters and reports any binding or constraint
 * failure as the standard {@code 400 VALIDATION_ERROR} through
 * {@code GlobalExceptionHandler}'s {@code BindException} handler — the one
 * Domain 4 added for exactly this, and the only mechanism used here (no second
 * one was introduced).
 *
 * <h2>The four parameters that are NOT here, each because a document says so</h2>
 *
 * <ul>
 *   <li><strong>No {@code type}.</strong> This endpoint counts expenses, and
 *       income is excluded <em>structurally</em> rather than by a default that
 *       a caller could flip (ADR 0022 §1, api-overview.md §14.1). The exclusion
 *       lives in the shape of
 *       {@code TransactionRepository#aggregateSpendByCategory}'s join, where
 *       there is no clause to weaken. <strong>Do not add this parameter, in
 *       either direction.</strong></li>
 *   <li><strong>No {@code budgetPeriodId}.</strong> The client reads
 *       {@code GET /budget/active-period} and passes that period's dates as
 *       {@code dateFrom}/{@code dateTo}, so the Statistics tab aligns with the
 *       user's budget period by the <em>client's choice of range</em> rather
 *       than a server-side join (ADR 0022 §2). Statistics must also answer for
 *       a user who has never saved a period, and a period id cannot express a
 *       calendar month or a custom range.</li>
 *   <li><strong>No {@code scope}.</strong> Not asked for this round; purely
 *       additive later (ADR 0022 §2).</li>
 *   <li><strong>No {@code page}/{@code size}, and no {@code sort}.</strong> The
 *       response is one bounded array — a user's top-level categories — and its
 *       order is part of the contract, applied in {@code StatisticsService}.
 *       A client string must never reach an {@code ORDER BY}
 *       (security-architecture.md §12.2).</li>
 * </ul>
 *
 * <h2>Injection hardening</h2>
 *
 * <p>Both fields are typed, validated {@link LocalDate}s bound as parameters
 * against the single fixed query shape in {@code TransactionRepository}. Nothing
 * a client sends ever becomes a field name, a table name or a SQL fragment.
 */
public class CategoryStatisticsQuery {

    /**
     * <strong>Inclusive</strong> lower bound on {@code txn_date} — the same
     * name, format and semantics as §4.1's, deliberately, because a second
     * spelling for one concept is drift (api-overview.md §14.1,
     * constitution §3.4).
     *
     * <p>{@code null} (omitted) means "no lower bound"; omitting both bounds
     * means all of the caller's history.
     */
    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
    private LocalDate dateFrom;

    /** <strong>Inclusive</strong> upper bound on {@code txn_date}. */
    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
    private LocalDate dateTo;

    /**
     * {@code dateFrom} later than {@code dateTo} is
     * {@code 400 VALIDATION_ERROR} (api-overview.md §14.1's error table,
     * ADR 0022 follow-up item 8, which asks for Bean Validation on both dates
     * "including {@code dateFrom <= dateTo}").
     *
     * <p><strong>This is the one place this endpoint deliberately differs from
     * §4.1, and the difference is the contract's, not an invention.</strong>
     * {@code GET /transactions} treats a reversed range as a legal empty range
     * because §4.1 defines no error for it (backend/README.md §13.10). §14.1
     * defines one explicitly, so it is rejected here. Flagged in
     * backend/README.md §14 so the asymmetry reads as a decision rather than an
     * inconsistency to "fix".
     *
     * <p>Written as an {@link AssertTrue} on a derived property rather than as a
     * check inside the service, so that the cross-field rule is reported through
     * the same {@code fieldErrors} shape as every single-field failure and needs
     * no new exception type. The property's name ({@code dateRangeValid}) is what
     * appears in {@code fieldErrors[].field}; the message carries the actual
     * instruction.
     *
     * <p>A missing bound is not an error — an open-ended range is well defined.
     */
    @AssertTrue(message = "dateFrom must not be later than dateTo")
    public boolean isDateRangeValid() {
        return dateFrom == null || dateTo == null || !dateFrom.isAfter(dateTo);
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
}
