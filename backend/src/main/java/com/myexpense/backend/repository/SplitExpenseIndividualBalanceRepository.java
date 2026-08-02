package com.myexpense.backend.repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.repository.Repository;

import com.myexpense.backend.entity.SplitExpenseIndividualBalance;

/**
 * Persistence only (constitution §9) for {@code split_expense_individual_balances}
 * (ADR 0026 §2).
 *
 * <p><strong>Insert and batched read, nothing else.</strong> Like
 * {@link SplitExpensePayerRepository}, this extends the bare {@link Repository}
 * marker rather than {@code JpaRepository}, so it inherits no {@code delete*},
 * {@code deleteAll*} or {@code save} that could be used as an update. The table is
 * insert-only (ADR 0024 §1, ADR 0026 §2.4). {@link #saveAllAndFlush} is declared
 * with the exact signature {@code JpaRepository} uses, so Spring Data routes it to
 * the same {@code SimpleJpaRepository} implementation.
 *
 * <p>The list filter's join on {@code individual_balance_id} lives on
 * {@link SplitExpenseRepository#findMovingIndividualBalance}, because it returns
 * split expenses; it reads this table through
 * {@code idx_split_expense_individual_balances_balance_expense}.
 *
 * <p>No membership check here: callers prove the viewer's access to the parent
 * split before loading links.
 */
public interface SplitExpenseIndividualBalanceRepository
        extends Repository<SplitExpenseIndividualBalance, UUID> {

    /**
     * Inserts one split's link rows, one per counterpart, in request order, in the
     * split's own transaction (ADR 0026 §4.6 step 11).
     */
    <S extends SplitExpenseIndividualBalance> List<S> saveAllAndFlush(Iterable<S> entities);

    /**
     * Every link row of a batch of split expenses, in <strong>one</strong> query
     * ({@code WHERE split_expense_id IN (...)}), served by
     * {@code uq_split_expense_individual_balances_expense_balance}'s btree, which
     * leads with {@code split_expense_id} (V17 creates no separate index for it).
     *
     * <p>Unordered on purpose: the response order (primary counterpart first,
     * then {@code individualBalanceId} ascending) needs the parent row, so
     * {@code SplitExpenseResponseAssembler} applies it in one place.
     */
    List<SplitExpenseIndividualBalance> findBySplitExpenseIdIn(Collection<UUID> splitExpenseIds);
}
