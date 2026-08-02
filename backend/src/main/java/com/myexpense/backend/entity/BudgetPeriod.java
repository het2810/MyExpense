package com.myexpense.backend.entity;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Maps to the {@code budget_periods} table (docs/architecture/data-model.md
 * §3.1, {@code database/migrations/V14__budget.sql}).
 *
 * <p><strong>This table accumulates history.</strong> Unlike the frontend's
 * single-slot {@code useBudgetStore.activePeriod}, every period a user has ever
 * saved stays a row (§3.1). {@code PUT /budget/periods} edits a row in place
 * when an {@code id} is supplied and inserts a new one when it is not
 * (api-overview.md §5.2).
 *
 * <p><strong>"The active period" is the caller's most recently CREATED row</strong>
 * — not the one covering today — and the client decides whether it has ended by
 * comparing {@code endDate} to today (§3.1, §5's intro, ADR 0011's
 * {@code getPostAuthDestination}). {@code created_at} is therefore a read key
 * rather than audit decoration, which is why it is {@code updatable = false}:
 * editing an old period must not promote it to "active". {@code V14} indexes
 * {@code (user_id, created_at)} for exactly this read. <strong>data-model.md's
 * own Indexes section contradicts this</strong> by naming
 * {@code (user_id, end_date)} as the "active-period lookup"; the Database
 * Architect flagged that ({@code V14} FLAG 1) and implemented the
 * most-recently-created reading, which this entity and
 * {@code BudgetPeriodRepository} follow. Flagged onward in backend/README.md
 * §18.6, not resolved here.
 *
 * <p><strong>The period range is INCLUSIVE on both ends.</strong> {@code V14}'s
 * exclusion constraint builds {@code daterange(start_date, end_date, '[]')}, so
 * two periods sharing a single day overlap while adjacent periods (Jan 31 /
 * Feb 1) do not. {@code BudgetService}'s own overlap pre-check matches those
 * semantics exactly; see its {@code countOverlapping} call.
 *
 * <p>{@code period_type} carries <strong>no database CHECK</strong> ({@code V14}
 * applied V7's test: nothing keys off the literal and it partitions no money),
 * so the vocabulary {@code 'automatic' | 'custom'} is owned by Bean Validation
 * on {@code UpsertBudgetPeriodRequest} (security-architecture.md §3). It is
 * mapped as a plain {@link String} rather than an enum plus
 * {@code AttributeConverter} for the same reason: no behaviour in this domain
 * branches on the value, so a converter would add a type with no reader.
 *
 * <p><strong>No currency field, deliberately.</strong> {@code amount} is a plain
 * figure in the one unit of account; currency is a display symbol only and
 * {@code users.default_currency_code} is the single currency column in the whole
 * schema (ADR 0017's Scope Narrowing banner). Do not add one here.
 *
 * <p>{@code amount} is {@link BigDecimal} against {@code numeric(12,2)} — never
 * {@code double} ({@code V14} contract item 5). It is compared against sums of
 * transaction amounts that are themselves {@code numeric(12,2)}, and a binary
 * float at this boundary would make "exactly at the budget" a value that is
 * sometimes not reached.
 *
 * <p>The primary key is application-assigned ({@link UUID#randomUUID()} in the
 * service layer) rather than relying on the column's {@code gen_random_uuid()}
 * default — the same convention {@link User} and {@link Category} already use.
 *
 * <p>{@code created_at}/{@code updated_at} are maintained by Hibernate
 * ({@link CreationTimestamp}/{@link UpdateTimestamp}); the schema has no trigger
 * for them on either budget table ({@code V14} contract item 4).
 */
@Entity
@Table(name = "budget_periods")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class BudgetPeriod {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Owner. Never settable from a request body — it comes from the JWT principal. */
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /**
     * {@code 'automatic'} (a rolling calendar month) or {@code 'custom'} (the
     * user's own two dates) — ADR 0010 §2's PERIOD control.
     *
     * <p>A display discriminator: no endpoint filters on it and no arithmetic
     * reads it. The server does not recompute an {@code 'automatic'} period's
     * dates, because §5.2 requires {@code startDate}/{@code endDate} on every
     * request regardless of {@code periodType} and the client computes the month
     * range itself (ADR 0010 §2's {@code getCurrentMonthRange}).
     */
    @Column(name = "period_type", nullable = false, length = 10)
    private String periodType;

    /** Inclusive lower bound of the period. */
    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    /**
     * Inclusive upper bound of the period — <strong>inclusive</strong>, matching
     * {@code V14}'s {@code '[]'} range bounds and the client's own
     * {@code endDate >= today} comparison.
     *
     * <p>{@code end_date >= start_date} is enforced by
     * {@code chk_budget_periods_date_order}, and that CHECK is load-bearing
     * rather than decorative: without it a reversed range would reach
     * {@code daterange()}, which raises {@code SQLSTATE 22000} with <em>no</em>
     * constraint name and so cannot be translated into a client error at all.
     * Both {@code UpsertBudgetPeriodRequest#isDateRangeValid()} and
     * {@code BudgetService} reject a reversed range before the write.
     */
    @Column(name = "end_date", nullable = false)
    private LocalDate endDate;

    /**
     * The period's Monthly Budget figure. Always {@code > 0}
     * ({@code chk_budget_periods_amount_positive}) — a zero or negative budget
     * is not a budget.
     */
    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    /** The LWW clock (ADR 0027 §5.1, V18); set only by an applied client PUT. */
    @Column(name = "last_client_write_at")
    private OffsetDateTime lastClientWriteAt;

    /**
     * <strong>The read key for "the active period", not audit decoration.</strong>
     * {@code updatable = false} records the invariant in the mapping itself: an
     * edit-in-place must leave it alone, or editing a historical period would
     * silently make it the active one.
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
