package com.myexpense.backend.repository;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.myexpense.backend.entity.Settlement;

/**
 * Persistence only (constitution §9) for {@code settlements}.
 *
 * <p><strong>Insert-only, and that is the complete interface rather than a
 * placeholder.</strong> §10 defines exactly one endpoint,
 * {@code POST /splits/settle}, which INSERTs — and <strong>no endpoint in this
 * phase reads this table at all</strong>: not by group, not by pair, not by user,
 * not by date. {@code V12} checked that against the endpoint list before
 * declining every index on the table, and adding a finder with no caller here
 * would invite one.
 *
 * <p>Rows are immutable by design, so there is no update or delete method either:
 * if a settlement is ever recorded in error the fix is a new compensating row
 * ({@code V12}'s "what this migration deliberately does NOT do").
 *
 * <p><strong>Named for later</strong> ({@code V12}): when a settlement-history
 * endpoint is designed it will want {@code findByGroupIdOrderBySettledAtDesc} /
 * {@code findByIndividualBalanceIdOrderBySettledAtDesc}, and the two indexes
 * {@code (group_id, settled_at)} / {@code (individual_balance_id, settled_at)} —
 * in that feature's own migration, measured with {@code EXPLAIN ANALYZE} rather
 * than guessed at.
 *
 * <p>{@code 400 AMOUNT_EXCEEDS_BALANCE} has no constraint behind it and never can
 * — the outstanding balance lives on another table, so it is pure service-layer
 * validation. See {@link IndividualBalanceRepository} and
 * {@link GroupMemberBalanceRepository} for where that bound is actually enforced
 * race-safely.
 */
public interface SettlementRepository extends JpaRepository<Settlement, UUID> {
}
