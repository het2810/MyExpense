package com.myexpense.backend.repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.SplitExpensePayer;

/**
 * Persistence only (constitution §9) for {@code split_expense_payers}
 * (ADR 0025 §2).
 *
 * <p><strong>Insert and batched read, nothing else.</strong> This interface
 * extends the bare {@link Repository} marker rather than {@code JpaRepository},
 * so it inherits no {@code delete*}, {@code deleteAll*} or {@code save} that could
 * be used as an update. The table is insert-only (ADR 0024 §1, ADR 0025 §2.5,
 * ADR 0028 §3), and the narrowest way to enforce that in code is to not expose the
 * methods at all. {@link #saveAllAndFlush} is declared here with the exact
 * signature {@code JpaRepository} uses, so Spring Data routes it to the same
 * {@code SimpleJpaRepository} implementation every other repository uses.
 *
 * <h2>The revision read rule (ADR 0028 §3.3, V19 CONTRACT item 3) — binding</h2>
 *
 * <p>Only rows whose {@code revision} equals {@code split_expenses.revision} are
 * current. Every finder here joins the parent on its current revision, or takes
 * an explicit revision and says so in its name.
 *
 * <p>The finders are served by {@code uq_split_expense_payers_expense_revision_user}'s
 * btree, which leads with {@code (split_expense_id, revision)} and, as a plain
 * non-partial {@code UNIQUE}, covers contact-payer rows too. It and
 * {@code ..._expense_revision_contact} guarantee one payer row per identity
 * <em>per split revision</em>.
 *
 * <p>No membership check here: callers prove the viewer's membership of the parent
 * split's target before loading payers.
 */
public interface SplitExpensePayerRepository extends Repository<SplitExpensePayer, UUID> {

    /**
     * Inserts one revision's payer rows and flushes, so the set-based
     * payer-credit statements in {@code GroupMemberBalanceRepository} can read
     * them in the same transaction (ADR 0025 §4.3 step 9).
     */
    <S extends SplitExpensePayer> List<S> saveAllAndFlush(Iterable<S> entities);

    /**
     * The <strong>current-revision</strong> payers of a batch of split expenses,
     * in <strong>one</strong> query, so building a list response never issues a
     * payer read per split (constitution §10).
     *
     * <p>Unordered on purpose. The response order (primary first, then amount
     * descending, ties by id) needs the primary payer, which is a property of the
     * parent row, so {@code SplitExpenseResponseAssembler#orderForResponse} applies
     * the whole order in one place.
     */
    @Query("""
            select p from SplitExpensePayer p
              join SplitExpense s on s.id = p.splitExpenseId
             where p.splitExpenseId in :splitExpenseIds
               and p.revision = s.revision
            """)
    List<SplitExpensePayer> findCurrentBySplitExpenseIdIn(
            @Param("splitExpenseIds") Collection<UUID> splitExpenseIds);

    /** One split's payers <strong>at an explicit revision</strong> (edit/delete). May read history. */
    List<SplitExpensePayer> findBySplitExpenseIdAndRevision(UUID splitExpenseId, int revision);
}
