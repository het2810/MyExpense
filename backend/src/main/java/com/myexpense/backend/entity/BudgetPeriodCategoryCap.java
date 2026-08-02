package com.myexpense.backend.entity;

import java.math.BigDecimal;
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
 * Maps to the {@code budget_period_category_caps} table
 * (docs/architecture/data-model.md §3.2 as amended by ADR 0021 §2.5,
 * {@code database/migrations/V14__budget.sql}).
 *
 * <p><strong>A save-time snapshot, not a live join.</strong> Each row records a
 * decision the user took when the period was saved — "this period I capped Food
 * at ₹3,000" — so {@link #categoryName} is frozen and nothing in this domain
 * joins {@code categories} to "freshen" it (§3.2, {@code V14} contract item 7).
 *
 * <p><strong>Neither a category RENAME nor a category DELETE rewrites a row
 * here</strong> (ADR 0021 §2.5, confirmed 2026-10-25). That ADR makes a rename
 * propagate onto {@code transactions} and makes a delete reassign them to
 * {@code Misc}; this table is deliberately excluded from both, because
 * rewriting a saved cap would rewrite a budget the user never set. <strong>Do
 * not add propagation to this table</strong> — whether a rename should reach it
 * is ADR 0021's Open Question 3 and belongs to the Project Owner.
 *
 * <p><strong>{@link #categoryId} is nullable, and is NOT nulled when the
 * category is deleted</strong> (ADR 0024 §4.6, superseding ADR 0021 §2.5's
 * first bullet). Categories are soft-deleted since {@code V15}, so the column's
 * {@code ON DELETE SET NULL} is dormant and the stored link survives — it is
 * user data, and it is what lets a future restore bring the link back with no
 * write. The API still reports {@code categoryId: null} for a deleted category:
 * that {@code null} is produced on read, by
 * {@code BudgetPeriodCategoryCapRepository#findCapRowsByBudgetPeriodId}'s
 * liveness-only join, and this service must never emulate the old FK action
 * by writing {@code null} here. A stored {@code null} can still exist on a
 * legacy row and reads the same way. It never means "no category" — §5.2
 * requires {@code categoryId} on every entry, so every row this service
 * <em>writes</em> has a non-null id. It is mapped as a reference type for those
 * legacy rows ({@code V14} contract item 5).
 *
 * <p><strong>Only top-level categories can appear here</strong> (ADR 0019 §4,
 * §5.2's own rule). {@code V14} deliberately does <em>not</em> enforce that
 * structurally — the fact lives on another table's row, so a CHECK cannot see
 * it ({@code V14} FLAG 3) — so {@code BudgetService} is the only enforcement,
 * answering {@code 400 VALIDATION_ERROR} exactly as
 * {@code POST}/{@code PATCH /categories} already do for a cap on a subcategory.
 * That is also why there is no {@code parentCategoryName} column: a top-level
 * name is unambiguous without one.
 *
 * <p><strong>No {@code userId} column, deliberately.</strong> The owner is
 * reachable only through {@link #budgetPeriodId}; a second copy could disagree
 * with its parent (constitution §10/§17). Every read in this domain is scoped
 * by first resolving the period owner-scoped.
 *
 * <p><strong>No currency field.</strong> {@code monthlyCap} is a plain figure in
 * the one unit of account, {@link BigDecimal} against {@code numeric(12,2)} and
 * never {@code double} ({@code V14} contract item 5).
 *
 * <p><strong>Effectively immutable once written.</strong> {@code PUT
 * /budget/periods} replaces a period's cap rows rather than editing them
 * ({@code V14} contract item 3), so {@code updated_at} will equal
 * {@code created_at} on every row — the one write that would ever change that is
 * the propagation ADR 0021 Open Question 3 has not authorized.
 */
@Entity
@Table(name = "budget_period_category_caps")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class BudgetPeriodCategoryCap {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * The owning period. {@code updatable = false}: a cap is never moved between
     * periods — it is deleted and re-inserted with the period it belongs to.
     */
    @Column(name = "budget_period_id", nullable = false, updatable = false)
    private UUID budgetPeriodId;

    /**
     * The capped category, as stored at save time. Kept when that category is
     * soft-deleted (ADR 0024 §4.6); the API's {@code categoryId: null} for a
     * deleted category is produced on read, not here. See the class Javadoc —
     * a legacy {@code null} here is a normal, readable row, not a missing value.
     */
    @Column(name = "category_id")
    private UUID categoryId;

    /**
     * <strong>Server-resolved and frozen at save time</strong> — §5.2 does not
     * accept it from the client at all, because the client should not be trusted
     * to supply, or be burdened with knowing, the current category name. It is
     * this row's whole display identity: after the category is deleted,
     * the API reports {@code categoryId: null} and this is the only thing that
     * makes the cap readable.
     *
     * <p>Never blank ({@code chk_budget_period_category_caps_category_name_not_blank});
     * a violation there means a service bug, not bad input, and surfaces as an
     * honest {@code 500}.
     */
    @Column(name = "category_name", nullable = false, length = 100)
    private String categoryName;

    /**
     * Always {@code > 0}
     * ({@code chk_budget_period_category_caps_monthly_cap_positive}). A zero cap
     * is not "no cap": §3.2's omission-over-null-entry convention means a
     * category with no cap simply has no row here.
     */
    @Column(name = "monthly_cap", nullable = false, precision = 12, scale = 2)
    private BigDecimal monthlyCap;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
