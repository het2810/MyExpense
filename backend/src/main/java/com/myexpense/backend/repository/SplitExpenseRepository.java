package com.myexpense.backend.repository;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.SplitExpense;

import jakarta.persistence.LockModeType;

/**
 * Persistence only (constitution §9) for {@code split_expenses}. Derived queries
 * and JPQL with bound parameters — no native SQL and no concatenation
 * (security-architecture.md §12).
 *
 * <p><strong>Nothing here is owner-scoped or membership-scoped, and that is
 * deliberate.</strong> §9 is membership-gated, and membership lives on
 * {@code group_members} or on the linked {@code individual_balances} rows — not on this
 * table, which carries only {@code created_by_user_id} (a record, not a
 * permission: every member of the group may read a split another member created).
 * {@code SplitExpenseService} proves the caller's membership of the target
 * <em>before</em> calling any method here, and answers {@code 404} for a
 * non-member. A finder that looked owner-scoped would be the wrong check wearing
 * the right clothes.
 */
public interface SplitExpenseRepository extends JpaRepository<SplitExpense, UUID> {

    /**
     * {@code GET /split-expenses?groupId=} (§9.3) — a group's whole history.
     *
     * <p><strong>Not paginated</strong>, per the contract ("the frontend's own
     * equivalent view has no pagination concept either"), which is why
     * {@code idx_split_expenses_group_id} deliberately has no {@code split_date}
     * appended: every matching row is read regardless, so an in-memory sort is
     * cheaper than the random heap access an ordered index scan would cost
     * ({@code V11}). If pagination is ever added to §9.3, that index gains
     * {@code split_date} in that feature's own migration.
     *
     * <p>Newest-first with {@code id} as the tie-break — {@code split_date} is a
     * {@code DATE}, so same-day rows are the normal case and need a total order
     * for a stable list. §9.3 specifies no order; this is the implementation's
     * choice, flagged in backend/README.md §16.
     */
    List<SplitExpense> findByGroupIdAndDeletedAtIsNullOrderBySplitDateDescIdAsc(UUID groupId);

    /**
     * {@code GET /split-expenses?individualBalanceId=} (§9.3) — every split that
     * <strong>moved</strong> one pair row, including a multi-contact split whose
     * primary counterpart is someone else (ADR 0026 §5.3).
     *
     * <p><strong>A join through {@code split_expense_individual_balances}, never a
     * filter on {@code split_expenses.individual_balance_id}.</strong> That column
     * holds only the primary counterpart's pair, so filtering on it would hide a
     * multi-contact split from every other pair while still returning plausible
     * data. The join is served by
     * {@code idx_split_expense_individual_balances_balance_expense}
     * ({@code individual_balance_id, split_expense_id}). The UNIQUE on
     * {@code (split_expense_id, individual_balance_id)} guarantees at most one
     * link row per split here, so the join cannot duplicate a split.
     *
     * <p>Same order as before: newest first, {@code id} as the tie-break.
     */
    @Query("""
            select s from SplitExpense s
              join SplitExpenseIndividualBalance l on l.splitExpenseId = s.id
             where l.individualBalanceId = :individualBalanceId
               and s.deletedAt is null
             order by s.splitDate desc, s.id asc
            """)
    List<SplitExpense> findMovingIndividualBalance(
            @Param("individualBalanceId") UUID individualBalanceId);

    /**
     * Step 3 of {@code V11}'s CIRCULAR REFERENCE write order: set the
     * back-reference once the consumption-share {@code transactions} row exists.
     *
     * <p>A targeted JPQL update rather than a setter-plus-flush so the statement
     * is visibly the third step of a fixed three-step order, and so
     * {@code updated_at} is written explicitly (the database maintains it
     * nowhere). {@code uq_split_expenses_personal_transaction_id} guarantees one
     * transaction is claimed by at most one split expense; a violation here is a
     * {@code 500}, never a client error.
     *
     * @return the number of rows updated — {@code 1}; the caller treats {@code 0}
     *         as a failure rather than ignoring it, because a missing
     *         back-reference is exactly the half of §4.6's iff no constraint can
     *         hold
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    // The flag flips in the SAME statement as the back-reference: the row was
    // inserted with added_to_personal_expenses = false (V11's circular-reference
    // order), and chk_split_expenses_personal_transaction_requires_flag rejects
    // a non-null personal_transaction_id on a false flag. Setting only the id
    // made every "add to my expenses" save a 500.
    @Query("update SplitExpense s set s.personalTransactionId = :transactionId, "
            + "s.addedToPersonalExpenses = true, s.updatedAt = :now "
            + "where s.id = :id")
    int attachPersonalTransaction(
            @Param("id") UUID id,
            @Param("transactionId") UUID transactionId,
            @Param("now") OffsetDateTime now);

    /**
     * <strong>CATEGORY-DELETE REASSIGNMENT</strong> — moves every split expense
     * the caller <em>created</em> that is tagged to a category being deleted (or
     * to one of its cascaded subcategories) onto the caller's protected
     * {@code Misc} row (ADR 0024 §4.8, api-overview.md §3.4 step 3a). Called
     * only by {@code CategoryService#deleteCategory}, inside its transaction,
     * after the {@code transactions} reassignment.
     *
     * <p><strong>The one creator-scoped method on this repository, and that is
     * not the membership rule this interface's Javadoc warns about.</strong> It
     * is not a read and it is not authorization: a split expense's
     * {@code category_id} only ever references its <em>creator's</em> category
     * (ADR 0023 §3), so only the creator's delete can match it, and the target
     * {@code Misc} is the creator's own. {@code createdByUserId = :userId}
     * states that scope in the {@code WHERE} as defence in depth on a bulk write.
     *
     * <p>The SET list, exactly as ADR 0024 §4.8 specifies:
     * <ul>
     *   <li>{@code reassignedFromCategoryId} ← the row's {@code category_id}
     *       <em>before</em> this statement — the restore marker (§6.2).
     *       PostgreSQL evaluates every right-hand side of an {@code UPDATE}
     *       against the old row, so the order of assignments does not matter;
     *       it is written first only for readability;</li>
     *   <li>{@code categoryId} → {@code Misc}, and the name/icon/glyph →
     *       {@code Misc}'s current values;</li>
     *   <li>{@code parentCategoryName} → {@code null} with no branch, safe
     *       because the protected row is always top-level
     *       ({@code chk_categories_protected_is_top_level});</li>
     *   <li>{@code updatedAt} explicit — a bulk update bypasses
     *       {@code @UpdateTimestamp}, and {@code updated_at} is how the change
     *       reaches every member's offline client (§13.2).</li>
     * </ul>
     * {@code categoryTone} is untouched: a split expense is always an expense.
     *
     * <p>{@code flushAutomatically} so nothing pending is overtaken. No
     * {@code clearAutomatically}: no {@code SplitExpense} is loaded in the
     * category-delete transaction.
     *
     * @return how many split expenses were reassigned. Deliberately not returned
     *         to the client: {@code CategoryDeletionResponse} gains no field
     *         (ADR 0024 §4.8), and the count is logged only
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            update SplitExpense s
               set s.reassignedFromCategoryId = s.categoryId,
                   s.categoryId = :fallbackCategoryId,
                   s.categoryName = :categoryName,
                   s.parentCategoryName = null,
                   s.categoryIconName = :categoryIconName,
                   s.categoryGlyph = :categoryGlyph,
                   s.updatedAt = :updatedAt
             where s.createdByUserId = :userId
               and s.categoryId in :categoryIds
               and s.deletedAt is null
            """)
    // ADR 0028 §3.6: "and s.deletedAt is null" — a deleted split keeps its
    // category; reassigning it is harmless but pointless.
    int reassignToFallbackCategory(
            @Param("userId") UUID userId,
            @Param("categoryIds") Collection<UUID> categoryIds,
            @Param("fallbackCategoryId") UUID fallbackCategoryId,
            @Param("categoryName") String categoryName,
            @Param("categoryIconName") String categoryIconName,
            @Param("categoryGlyph") String categoryGlyph,
            @Param("updatedAt") OffsetDateTime updatedAt);

    // =====================================================================
    // ADR 0028 — edit, delete, feed
    // =====================================================================

    /**
     * ADR 0028 §4.4 step 3: the split's immutable head, read <strong>without a
     * lock and including deleted rows</strong>, as a constructor projection so
     * no managed entity is created — the locked re-read in step 6
     * ({@link #findForUpdateById}) then loads current state rather than
     * returning a stale managed instance.
     */
    @Query("""
            select new com.myexpense.backend.repository.SplitExpenseHeadRow(
                   s.id, s.createdByUserId, s.groupId, s.categoryId, s.personalTransactionId)
              from SplitExpense s
             where s.id = :id
            """)
    Optional<SplitExpenseHeadRow> findHeadById(@Param("id") UUID id);

    /**
     * ADR 0028 §4.4 step 6: the split row {@code SELECT ... FOR UPDATE},
     * <strong>including deleted rows</strong> (so a deleted split answers
     * superseded/404 under the lock). Third in §4.5's global lock order.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from SplitExpense s where s.id = :id")
    Optional<SplitExpense> findForUpdateById(@Param("id") UUID id);

    /**
     * ADR 0028 §2.3: the soft delete — {@code deleted_at}, {@code deleted_by_user_id}
     * and {@code updated_at} from <strong>one instant</strong>, in one statement
     * ({@code chk_split_expenses_deleted_by_iff_deleted}). {@code revision} and
     * {@code last_client_write_at} are untouched. A bulk update so
     * {@code @UpdateTimestamp} cannot substitute its own instant.
     *
     * @return {@code 1}; the caller treats anything else as a failure
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update SplitExpense s
               set s.deletedAt = :now, s.deletedByUserId = :deletedByUserId, s.updatedAt = :now
             where s.id = :id
               and s.deletedAt is null
            """)
    int markDeleted(
            @Param("id") UUID id,
            @Param("deletedByUserId") UUID deletedByUserId,
            @Param("now") OffsetDateTime now);
}
