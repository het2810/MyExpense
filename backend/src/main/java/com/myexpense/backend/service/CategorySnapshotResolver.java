package com.myexpense.backend.service;

import java.util.UUID;

import org.springframework.stereotype.Service;

import com.myexpense.backend.entity.Category;
import com.myexpense.backend.entity.TransactionType;
import com.myexpense.backend.exception.CategoryNotFoundException;
import com.myexpense.backend.exception.TransactionRuleViolationException;
import com.myexpense.backend.repository.CategoryRepository;

/**
 * Resolves the {@link CategorySnapshot} a transaction write stamps onto a row —
 * <strong>the single place the income/expense rule lives</strong>
 * (docs/decisions/0018-income-is-not-a-category.md §3,
 * docs/api/api-overview.md §4.2's "income snapshot resolution rule").
 *
 * <p>It is a separate bean from {@code TransactionService} for one reason: both
 * {@code POST} and {@code PATCH} need identical resolution, and §4.4's two
 * {@code type} transitions are the documented place this goes wrong. One
 * resolver called from both paths means {@code expense → income} and
 * {@code income → expense} cannot diverge, and there is exactly one method to
 * read when checking the rule against the ADR.
 *
 * <p><strong>The database does not enforce this rule and cannot.</strong>
 * {@code CHECK ((type = 'expense') = (category_id IS NOT NULL))} would make
 * {@code category_id}'s own {@code ON DELETE SET NULL} unexecutable — the
 * cascade's {@code UPDATE} would violate it (Database Architect, 2026-10-24) —
 * so this class is the only enforcement that exists. Nothing may assume a
 * backstop. (That FK action is dormant since {@code V15} — categories are never
 * hard-deleted, ADR 0024 §4.5 — but it is kept for the future account purge,
 * so the reasoning still holds.)
 *
 * <p><strong>Every category this class reads is LIVE</strong> (ADR 0024
 * §4.2): a soft-deleted category resolves exactly like a non-existent one, so
 * no write can tag a row to it. The leaf a write stores is also
 * <strong>share-locked</strong> — see {@link #lockLiveLeaf}.
 *
 * <p><strong>No {@code noRollbackFor} concern here</strong> (backend/README.md
 * §3, points 3 and 4): this class never writes. It reads and either returns a
 * value object or throws, so there is no deliberate write-then-throw for a
 * rollback to silently undo.
 */
@Service
public class CategorySnapshotResolver {

    private final CategoryRepository categoryRepository;

    /**
     * Injected for one method and one reason: {@link #resolveForSplitExpense}
     * needs the protected {@code Misc} row, and
     * {@link CategoryService#resolveProtectedCategory} is the single
     * implementation of that lookup in the backend (ADR 0021 §2.1, ADR 0023 §3).
     * A repository call here would be a <em>second</em> implementation, which is
     * exactly what that method's Javadoc says lets a by-name match creep back in.
     *
     * <p>No cycle: {@code CategoryService} depends on
     * {@code CategoryRepository}/{@code UserRepository}/{@code TransactionRepository}
     * and on no service.
     */
    private final CategoryService categoryService;

    public CategorySnapshotResolver(
            CategoryRepository categoryRepository, CategoryService categoryService) {
        this.categoryRepository = categoryRepository;
        this.categoryService = categoryService;
    }

    /**
     * The whole rule, in the contract's own order.
     *
     * <ol>
     *   <li><strong>{@code income}</strong> → {@code category_id = NULL} plus
     *       the five constants. A non-null {@code categoryId} is a
     *       {@code 400 VALIDATION_ERROR}, <em>never</em> a silently ignored
     *       field — dropping it quietly would hide a client bug behind a row
     *       that looks fine. <strong>There is no "Income" category row to
     *       resolve</strong>, and nothing anywhere resolves a category by name,
     *       so a user-created category called "Income" can never be picked up
     *       here (ADR 0018 §5 — a correct consequence, not a gap).</li>
     *   <li><strong>{@code expense}</strong> → {@code categoryId} is required
     *       ({@code 400} if absent) and must resolve to a category owned by the
     *       caller ({@code 404 CATEGORY_NOT_FOUND}, api-overview.md §4.2).
     *       Owner-scoped, live and share-locked via {@link #lockLiveLeaf}, so
     *       another account's category id <em>and a soft-deleted one</em> are
     *       indistinguishable from a non-existent one — never a
     *       {@code 403}, which would confirm the id is real
     *       (security-architecture.md §2). That pre-resolution is also what
     *       keeps {@code fk_transactions_category_id} unreachable from a legal
     *       request: without it, a bad id would surface as an unmapped
     *       {@code 23503} and a {@code 500} (Database Architect, 2026-10-24).
     *       The foreign key stays the real guarantee; this is the clean
     *       error.</li>
     * </ol>
     *
     * <p>The resolved row may be a <strong>subcategory</strong>, in which case
     * the three display values come from its own row and
     * {@code parentCategoryName} from its parent; for a top-level category the
     * parent name is {@code null} (ADR 0019 §5). <strong>Nothing about this
     * rule needs to know whether a category has children</strong> — which is
     * why subcategories needed no new branch here.
     */
    public CategorySnapshot resolve(UUID userId, TransactionType type, UUID categoryId) {
        if (type == TransactionType.INCOME) {
            if (categoryId != null) {
                throw TransactionRuleViolationException.categoryIdNotAllowedForIncome();
            }
            return CategorySnapshot.forIncome();
        }

        if (categoryId == null) {
            throw TransactionRuleViolationException.categoryIdRequiredForExpense();
        }
        Category leaf = lockLiveLeaf(userId, categoryId);
        return CategorySnapshot.forExpense(leaf, parentNameOf(userId, leaf));
    }

    /**
     * The snapshot a <strong>split expense</strong> write stamps onto its row
     * (api-overview.md §9.1, ADR 0023 §3) — added by Domain 6 sub-step 3.
     *
     * <p>A second method rather than a branch inside {@link #resolve}, because the
     * two rules genuinely differ in the one place that matters and sharing a method
     * would mean a {@code type} parameter that {@code split_expenses} does not
     * have:
     *
     * <ul>
     *   <li><strong>A split expense is always an expense</strong> — there is no
     *       income split, {@code split_expenses} has no {@code type} column, and
     *       the income constants are unreachable from here.</li>
     *   <li><strong>An omitted {@code categoryId} is LEGAL and is not "no
     *       category".</strong> §9.1 makes the field optional while §4.6 makes the
     *       four snapshot columns {@code NOT NULL} — a contradiction ADR 0023 §3
     *       calls "a hard blocker, not a wart", because any request omitting it
     *       would have failed with a {@code 23502}. The resolution: snapshot the
     *       <strong>creator's protected {@code Misc} row</strong> and set
     *       {@code category_id} to it, so "no category chosen" becomes "the
     *       catch-all", which is what {@code Misc} is for. Leaving the id null
     *       while the snapshot said {@code Misc} would create a row that renders as
     *       {@code Misc} but matches no {@code Misc} filter.</li>
     * </ul>
     *
     * <p><strong>{@code Misc} is resolved through
     * {@link CategoryService#resolveProtectedCategory}, by {@code is_protected} and
     * never by name</strong> (ADR 0023 Backend follow-up item 4, {@code V8}'s
     * CONTRACT item 2). That method is the one implementation of this lookup in the
     * backend and this class deliberately does not add a second: a name match would
     * be hijackable by a rename, a user may already own a category called
     * {@code misc}, and nothing in this system resolves a category by name
     * (ADR 0018 §5).
     *
     * <p><strong>No snapshot value is ever written null.</strong>
     * {@code parentCategoryName} is the one nullable column of the five, and for
     * {@code Misc} it is always {@code null} because a protected row is always
     * top-level ({@code chk_categories_protected_is_top_level}) — resolved through
     * the same {@link #parentNameOf} as any other leaf rather than hardcoded, so
     * there is one rule for both branches.
     *
     * <p><strong>Whose {@code Misc}: the creator's.</strong> ADR 0023 §3 confirms
     * this is no new asymmetry — {@code split_expenses.category_id} has always
     * referenced a category owned by the creator, i.e. a shared record tagged with
     * one member's private row. What <em>is</em> new is that ADR 0021 lets the
     * creator's later rename or delete rewrite what other members see; that is
     * treated in ADR 0021 §2.8. <strong>The delete half is wired since
     * 2026-11-03</strong> ({@code CategoryService#deleteCategory} reassigns the
     * creator's split expenses to the creator's {@code Misc}, ADR 0024 §4.8);
     * rename propagation onto this table is still owed (ADR 0021 §2.5).
     *
     * @param categoryId the leaf the caller chose, or {@code null}/absent to take
     *                   the caller's protected {@code Misc} row
     * @throws CategoryNotFoundException if a non-null {@code categoryId} does not
     *                                   resolve to a category owned by the caller —
     *                                   including when it exists but belongs to
     *                                   someone else, never a {@code 403}
     */
    public CategorySnapshot resolveForSplitExpense(UUID userId, UUID categoryId) {
        // Misc needs no lock: chk_categories_protected_not_deleted means it
        // can never be soft-deleted.
        Category leaf = categoryId == null
                ? categoryService.resolveProtectedCategory(userId)
                : lockLiveLeaf(userId, categoryId);
        return CategorySnapshot.forExpense(leaf, parentNameOf(userId, leaf));
    }

    /**
     * Resolves the leaf a write is about to store, owner-scoped,
     * <strong>live</strong> and <strong>share-locked</strong>
     * ({@code SELECT ... FOR SHARE}; ADR 0024 §4.2/§4.4).
     *
     * <ul>
     *   <li><strong>Live:</strong> a soft-deleted category is
     *       {@code 404 CATEGORY_NOT_FOUND}, indistinguishable from one that
     *       never existed — a transaction or split expense can never be tagged
     *       to a deleted category.</li>
     *   <li><strong>Share-locked</strong> (ADR 0024 §4.4's recommendation,
     *       taken): the lock conflicts with {@code DELETE /categories/{id}}'s
     *       {@code FOR UPDATE} on the target and on its children. Either the
     *       delete commits first and this returns empty, or this write commits
     *       first and the delete's reassignment then sees the new row. Without
     *       it, a row inserted between the delete's reassignment and its soft
     *       delete would be left pointing at a hidden category, missed by both
     *       the reassignment and a future restore (ADR 0021 §2.4's accepted
     *       residual, now closed).</li>
     * </ul>
     *
     * <p>Every caller runs inside a read-write {@code @Transactional} method
     * ({@code TransactionService#createTransaction}/{@code #updateTransaction},
     * {@code SplitExpenseService#createSplitExpense}), which a pessimistic lock
     * requires.
     *
     * <p><strong>One accepted cost, recorded:</strong> {@code PATCH
     * /transactions/{id}} already holds that transaction row {@code FOR UPDATE}
     * when it gets here, and a concurrent category delete holds the category
     * {@code FOR UPDATE} and then needs the transaction row for its
     * reassignment. If both requests arrive in that exact interleaving,
     * PostgreSQL detects the deadlock and aborts one of them ({@code 40P01},
     * a logged {@code 500}). Nothing is written by the aborted one, and the
     * client can retry. The alternative — no lock — loses a row to a hidden
     * category silently, which is worse.
     */
    private Category lockLiveLeaf(UUID userId, UUID categoryId) {
        return categoryRepository.findForShareByIdAndUserIdAndDeletedAtIsNull(categoryId, userId)
                .orElseThrow(CategoryNotFoundException::new);
    }

    /**
     * The leaf's parent's name, or {@code null} when the leaf is top-level.
     *
     * <p><strong>One extra bounded query, and only when the chosen category has
     * a parent</strong> — a single-row primary-key lookup on a write path, not
     * an N+1: the list endpoint never comes here at all, because the snapshot
     * columns are what render (that is the entire point of the
     * denormalization). A top-level category costs no query to know it has no
     * parent.
     *
     * <p>The lookup is owner-scoped like every other, even though the composite
     * foreign key {@code (user_id, parent_category_id) → (user_id, id)} already
     * guarantees the parent belongs to the same user — consistency is worth more
     * than the micro-optimisation, and it means no query in this domain is
     * reachable without a {@code userId}.
     *
     * <p>If the parent somehow could not be read, this degrades to a
     * {@code null} parent name rather than failing the write. That state is
     * unreachable through this schema (the composite FK guarantees it), and the
     * graceful outcome is the right one for a field whose own contract says a
     * renderer ignoring it still produces a complete, correct row (ADR 0019
     * §5) — refusing to record a legitimate expense over a missing display
     * nicety would be the wrong trade.
     *
     * <p><strong>Live parent only, with no lock</strong> (ADR 0024 §4.2). The
     * leaf is already share-locked and live, and a live child never sits under
     * a deleted parent, so the filter cannot change the answer; it is there so
     * no read of {@code categories} goes unfiltered. Not locked, deliberately:
     * this reads a display value only, and locking the parent after the child
     * would invert the delete's parent-then-children lock order and invite a
     * deadlock.
     */
    private String parentNameOf(UUID userId, Category leaf) {
        UUID parentCategoryId = leaf.getParentCategoryId();
        if (parentCategoryId == null) {
            return null;
        }
        return categoryRepository.findByIdAndUserIdAndDeletedAtIsNull(parentCategoryId, userId)
                .map(Category::getName)
                .orElse(null);
    }
}
