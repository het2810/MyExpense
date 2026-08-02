package com.myexpense.backend.repository;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.BudgetPeriod;

import jakarta.persistence.LockModeType;

/**
 * Persistence for {@code budget_periods} (api-overview.md §5).
 *
 * <p>Every method is owner-scoped: {@code user_id} is a real column on every row
 * and the authenticated principal's id is bound into every query
 * (security-architecture.md §2). An id belonging to another account resolves to
 * empty, i.e. a {@code 404} — never a {@code 403}, which would confirm the id is
 * real.
 *
 * <p>Three reads, matching §5's three endpoints exactly. No pagination: §5
 * defines no list endpoint, so there is nothing here to page.
 */
public interface BudgetPeriodRepository extends JpaRepository<BudgetPeriod, UUID> {

    /**
     * <strong>§5.1's "active period" — the caller's most recently CREATED
     * row.</strong>
     *
     * <p>Not the row covering today. data-model.md §3.1, api-overview.md §5's
     * intro and ADR 0011 all define it this way, and all three state the
     * consequence: the row is returned "regardless of whether its
     * {@code end_date} has already passed — the client determines 'ended' status
     * itself by comparing {@code endDate} to today". {@code V14} created
     * {@code idx_budget_periods_user_id_created_at} for precisely this query.
     *
     * <p><strong>data-model.md's Indexes section contradicts the above</strong>
     * by naming {@code budget_periods(user_id, end_date)} the "active-period
     * lookup", which would be right only under a "covering today" definition.
     * The Database Architect flagged the contradiction ({@code V14} FLAG 1) and
     * implemented the majority reading; this method follows it. Flagged onward
     * in backend/README.md §18.6 rather than resolved here.
     *
     * <p>Empty is the <strong>normal</strong> answer for a user who has never
     * saved a period — {@code 404 NO_ACTIVE_PERIOD} is ADR 0011's first-run
     * signal, not a failure (see {@code BudgetService#getActivePeriod}).
     *
     * <p>{@code IdDesc} is a tie-break, so the order is <em>total</em> and the
     * answer deterministic. {@code V14}'s own comment writes the query as
     * {@code ORDER BY created_at DESC LIMIT 1} with no tie-break; two rows
     * cannot normally share a {@code created_at} (each period is written in its
     * own transaction), but "normally" is not a guarantee and an endpoint whose
     * answer could flip between two rows would be a hard bug to see. An
     * ascending-declared btree on {@code (user_id, created_at)} is scanned
     * backwards for free; only the ties, if any, are sorted.
     */
    Optional<BudgetPeriod> findFirstByUserIdOrderByCreatedAtDescIdDesc(UUID userId);

    /**
     * §5.3, and the {@code id}-supplied half of §5.2's upsert — one period by
     * id, owner-scoped. Answered by the primary key before {@code user_id} is
     * even compared, which is why {@code V14} creates no {@code (user_id, id)}
     * index.
     */
    Optional<BudgetPeriod> findByIdAndUserId(UUID id, UUID userId);

    /**
     * {@code PUT /budget/periods} with an {@code id} (ADR 0027 §3.4): the row by
     * id <strong>whoever owns it</strong>, write-locked, so the service can tell
     * "exists nowhere" (create with this id, {@code 201}) from "another user's"
     * ({@code 404 BUDGET_PERIOD_NOT_FOUND}, never {@code ID_CONFLICT}) from
     * "the caller's" (LWW edit). The owner check is the service's, immediately
     * after; nothing from another user's row is ever returned or written.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<BudgetPeriod> findForUpdateById(UUID id);

    /**
     * <strong>§5.2's overlap pre-check: how many of the caller's OTHER periods
     * intersect {@code [startDate, endDate]}.</strong>
     *
     * <p><strong>Both ends inclusive, matching {@code V14}'s
     * {@code daterange(start_date, end_date, '[]')} exactly.</strong> Two closed
     * intervals intersect if and only if each starts no later than the other
     * ends, which is what the two predicates below say:
     *
     * <pre>
     *   p.startDate &lt;= :endDate   and   p.endDate &gt;= :startDate
     * </pre>
     *
     * So {@code [Jan 1, Jan 31]} and {@code [Jan 31, Feb 28]} DO overlap (they
     * share Jan 31) while {@code [Jan 1, Jan 31]} and {@code [Feb 1, Feb 28]} do
     * NOT (adjacent periods are legal). That is ADR 0010 §5's rule — "the new
     * period's {@code startDate} must be strictly after the old period's
     * {@code endDate}" — expressed as an intersection test. An exclusive bound
     * on either side would silently permit two periods to share a day, which is
     * a double-counted day of budget; a bound one day wider would reject the
     * adjacent periods the product requires.
     *
     * <p><strong>{@code excludeId} is how "excluding the period being
     * edited" is honoured</strong> (§5.2's own wording). It is {@code null} on a
     * create, where there is no row to exclude. {@code V14}'s exclusion
     * constraint gets the same carve-out for free, because an exclusion
     * constraint compares a row only against <em>other</em> rows.
     *
     * <p><strong>Parameter-binding notes, both deliberate</strong>
     * (backend/README.md §13.11's incident):
     * <ul>
     *   <li>Neither {@link LocalDate} parameter appears inside an {@code is
     *       null} check. Each is bound <strong>once</strong>, in a comparison
     *       against a {@code DATE NOT NULL} column that fixes its type, so no
     *       untyped placeholder can reach PostgreSQL. <strong>Never write
     *       {@code (:dateParam is null or ...)} in this backend.</strong></li>
     *   <li>{@code excludeId} <em>does</em> use that idiom, which is correct for
     *       a {@code UUID}: the driver binds it with a concrete type OID, which
     *       is exactly why {@code scope}, {@code type} and {@code categoryId}
     *       survive the idiom in {@code TransactionRepository} and the dates
     *       could not.</li>
     * </ul>
     *
     * <p>Served by the GiST index {@code V14}'s exclusion constraint creates
     * (its own FLAG 1, reason 5): equality on {@code user_id} plus a range
     * question is that index's shape.
     *
     * <p>A count rather than a boolean so the service can log how many periods
     * collided without issuing a second query; it is still one round trip.
     */
    @Query("""
            select count(p) from BudgetPeriod p
            where p.userId = :userId
              and p.startDate <= :endDate
              and p.endDate >= :startDate
              and (:excludeId is null or p.id <> :excludeId)
            """)
    long countOverlapping(
            @Param("userId") UUID userId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate,
            @Param("excludeId") UUID excludeId);
}
