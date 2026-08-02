package com.myexpense.backend.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.BudgetPeriodCategoryCap;

/**
 * Persistence for {@code budget_period_category_caps} (data-model.md §3.2).
 *
 * <p><strong>Not owner-scoped, because this table has no {@code user_id}
 * column</strong> — the owner is reachable only through
 * {@code budget_period_id}, which is correct normalization ({@code V14}'s "what
 * this migration deliberately does NOT do"). Every caller in
 * {@code BudgetService} therefore resolves the <em>period</em> owner-scoped
 * first and passes an id it has already proved belongs to the caller. That order
 * is mandatory: a method here cannot tell whose period it is being handed.
 */
public interface BudgetPeriodCategoryCapRepository extends JpaRepository<BudgetPeriodCategoryCap, UUID> {

    /**
     * One period's complete cap list, in <strong>one</strong> query — never one
     * query per cap (constitution §10, {@code V14} contract item 7). Used by
     * §5.1, §5.3 and the response of §5.2 — every place a
     * {@code BudgetPeriodResponse} is built.
     *
     * <p><strong>The one join to {@code categories} in this domain, and it reads
     * LIVENESS ONLY</strong> (ADR 0024 §4.6, Project Owner ruling 2026-11-03).
     * Categories are soft-deleted now, so a cap's stored {@code category_id}
     * survives a delete — it is user data, and it is what lets a future restore
     * bring the link back with no write. The contract still says
     * {@code categoryId} is {@code null} if and only if the category was
     * deleted, so the {@code null} is produced here, on read:
     * {@code left join Category c on c.id = cap.categoryId and c.deletedAt is null}
     * and {@code c.id} is returned as {@code categoryId}. That is {@code null}
     * both for a soft-deleted category and for a legacy row whose stored id is
     * already {@code NULL}.
     *
     * <p><strong>{@code categoryName} comes from the cap row, never from
     * {@code c.name}.</strong> The join must not read a display value from
     * {@code categories}, or it would silently answer ADR 0021 Open Question 3
     * (whether a rename reaches a saved cap) on every read. This amends
     * {@code V14} contract item 7 from "no join to {@code categories}" to "no
     * join that reads a display value from {@code categories}".
     *
     * <p>A left join on the primary key of {@code categories}, so it adds at
     * most one indexed lookup per cap and can never drop or duplicate a cap row.
     * Not owner-scoped on {@code c.userId}: the caller has already resolved the
     * period owner-scoped, and every cap it holds was written against the
     * caller's own category.
     *
     * <p>Ordered by the frozen name, with {@code id} as a tie-break so the order
     * is total and the response byte-stable between calls. §5.1 specifies no
     * order for {@code categoryCaps}; name order is the one a user can predict,
     * and {@code created_at} would have been a worse choice here because every
     * cap of one period is written in a single transaction. A deleted category's
     * cap sorts by its frozen name like any other.
     */
    @Query("""
            select new com.myexpense.backend.repository.BudgetCategoryCapRow(
                       c.id, cap.categoryName, cap.monthlyCap)
              from BudgetPeriodCategoryCap cap
              left join Category c
                     on c.id = cap.categoryId
                    and c.deletedAt is null
             where cap.budgetPeriodId = :budgetPeriodId
             order by cap.categoryName asc, cap.id asc
            """)
    List<BudgetCategoryCapRow> findCapRowsByBudgetPeriodId(@Param("budgetPeriodId") UUID budgetPeriodId);

    /**
     * Removes every cap of one period, returning how many rows were deleted.
     *
     * <p><strong>§5.2 REPLACES a period's caps rather than merging them</strong>
     * ({@code V14} contract item 3): the request's {@code categoryCaps} array is
     * the complete new set, and §3.2's omission-over-null-entry convention means
     * a category absent from the array has no cap for that period. This delete
     * and the inserts that follow it are one {@code @Transactional} unit — a
     * partially-replaced cap set is a budget the user never set.
     *
     * <p><strong>Why a bulk JPQL delete and NOT entity-level removal, which is a
     * real trap rather than a style preference.</strong> Within one flush,
     * Hibernate orders inserts <em>before</em> deletes. Loading the old cap rows
     * and calling {@code deleteAll} would therefore try to insert the new
     * {@code (budget_period_id, category_id)} pairs while the old ones are still
     * present, and any cap kept across an edit would violate
     * {@code uq_budget_period_category_caps_period_category} — a {@code 23505}
     * on a perfectly legal request. A bulk delete executes its own statement at
     * invocation, so the rows are gone before the first insert is issued.
     *
     * <p>{@code flushAutomatically = true} pushes the pending {@code INSERT}/
     * {@code UPDATE} of the parent period before this statement runs, so the
     * period row always exists by the time its caps are rewritten.
     * {@code clearAutomatically} is deliberately <strong>not</strong> set: the
     * caller keeps using the managed period instance it just saved (its
     * {@code created_at}/{@code updated_at} are what the response carries), and
     * nothing in this path holds a cap entity that this statement could make
     * stale — no caller loads cap rows before deleting them.
     *
     * <p>Bounded by one period id, which the caller has already resolved
     * owner-scoped. An unscoped {@code DELETE} on financial data is the most
     * expensive kind of mistake, so the scoping is stated at every call site.
     */
    @Modifying(flushAutomatically = true)
    @Query("delete from BudgetPeriodCategoryCap c where c.budgetPeriodId = :budgetPeriodId")
    int deleteByBudgetPeriodId(@Param("budgetPeriodId") UUID budgetPeriodId);
}
