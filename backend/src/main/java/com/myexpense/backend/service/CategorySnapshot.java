package com.myexpense.backend.service;

import java.util.UUID;

import com.myexpense.backend.entity.Category;
import com.myexpense.backend.entity.SplitExpense;
import com.myexpense.backend.entity.Transaction;
import com.myexpense.backend.entity.TransactionType;

/**
 * The six values a transaction write stamps onto a row to describe its category
 * — {@code category_id} plus the five snapshot columns
 * ({@code category_name}, {@code parent_category_name},
 * {@code category_icon_name}, {@code category_glyph}, {@code category_tone};
 * docs/architecture/data-model.md §2.2).
 *
 * <p><strong>All six are server-authoritative and are never request
 * fields</strong> (docs/decisions/0018-income-is-not-a-category.md §3.1,
 * docs/decisions/0019-subcategories-one-optional-level.md §5,
 * security-architecture.md §3). Grouping them into one value object exists so
 * that the three call sites that need them — create, the {@code type}
 * transition, and a {@code categoryId} change — apply <em>all six together or
 * none</em>. The failure mode that matters is a partial application: ADR 0018
 * §3.3 warns that getting a {@code type} transition half-right "leaves a row
 * nothing in the system can render correctly or explain", and six loose
 * assignments at three call sites is exactly how that happens.
 *
 * <p>The snapshot is a <strong>deliberate denormalization</strong>: renaming a
 * category later must not rewrite transaction history, which is why these
 * values are copied at write time and never refreshed by a join.
 *
 * <h2>Where each tone literal lives</h2>
 *
 * <p>{@code category_tone} is derived from {@link TransactionType} and from
 * nothing else — {@code 'success'} for income, {@code 'neutral'} for expense
 * (ADR 0018 §3.3, api-overview.md §4.1). It cannot come from the category,
 * because {@code CategoryResponse} carries no tone field, deliberately.
 *
 * <p>The two literals are split exactly as {@link IncomeCategorySnapshot}'s own
 * Javadoc instructs: {@code 'success'} stays there with the rest of the income
 * block (that class is untouched by this domain), and {@code 'neutral'} is
 * declared once here, in the class that performs the derivation. What that
 * Javadoc forbids — "a second, inline copy of either literal" — does not happen:
 * search the backend and each string appears exactly once.
 */
public record CategorySnapshot(
        UUID categoryId,
        String categoryName,
        String parentCategoryName,
        String categoryIconName,
        String categoryGlyph,
        String categoryTone) {

    /**
     * {@code transactions.category_tone} for an <strong>expense</strong> row —
     * the counterpart of {@link IncomeCategorySnapshot#TONE}, declared here
     * because this class is where the {@code type}-based derivation happens.
     */
    public static final String EXPENSE_TONE = "neutral";

    /**
     * The income snapshot: {@code category_id = NULL} and the five display
     * values from {@link IncomeCategorySnapshot} — the constants' first and
     * only consumer (ADR 0018 §3, and that class's "why this exists before its
     * consumer does" note).
     *
     * <p>{@code parentCategoryName} is {@code null}, and <strong>that is not an
     * income special case</strong> (ADR 0019 §5): there is no parent, for
     * exactly the same reason a top-level expense has none. The server does not
     * have to know income is different in order to get this right.
     */
    public static CategorySnapshot forIncome() {
        return new CategorySnapshot(
                null,
                IncomeCategorySnapshot.NAME,
                null,
                IncomeCategorySnapshot.ICON_NAME,
                IncomeCategorySnapshot.GLYPH,
                IncomeCategorySnapshot.TONE);
    }

    /**
     * The expense snapshot, taken from the <strong>leaf</strong> category the
     * user chose — which may be a subcategory, in which case the three display
     * values come from the subcategory's own row and {@code parentCategoryName}
     * from its parent (ADR 0019 §5).
     *
     * <p>{@code categoryName} is always the leaf's own name and
     * <strong>never a composed path</strong>: a separator is a presentation
     * choice, and freezing one into financial history would make every past row
     * wrong the moment the UI changed it. The client composes
     * {@code Food › Snacks} at render time from the two names.
     *
     * @param leaf               the resolved, caller-owned category row
     * @param parentCategoryName the leaf's parent's name, or {@code null} when
     *                           the leaf is top-level
     */
    public static CategorySnapshot forExpense(Category leaf, String parentCategoryName) {
        return new CategorySnapshot(
                leaf.getId(),
                leaf.getName(),
                parentCategoryName,
                leaf.getIconName(),
                leaf.getGlyph(),
                EXPENSE_TONE);
    }

    /**
     * Applies all six values to a transaction at once.
     *
     * <p>Living on the value object rather than in the service is what makes
     * "all six together or none" structural: there is no way to call this and
     * write five of them.
     */
    public void applyTo(Transaction transaction) {
        transaction.setCategoryId(categoryId);
        transaction.setCategoryName(categoryName);
        transaction.setParentCategoryName(parentCategoryName);
        transaction.setCategoryIconName(categoryIconName);
        transaction.setCategoryGlyph(categoryGlyph);
        transaction.setCategoryTone(categoryTone);
    }

    /**
     * The same six values on a {@code split_expenses} row — added by Domain 6
     * sub-step 3.
     *
     * <p>{@code split_expenses} carries the <strong>identical</strong> five
     * snapshot columns as {@code transactions}, at identical lengths
     * ({@code varchar(100)/100/4/20} plus {@code parent_category_name
     * varchar(100)}), which ADR 0023 §5.1 confirms must stay equal across the two
     * tables: "both hold copies of the same {@code categories} values, and a
     * shorter column on one table would silently truncate or reject a value the
     * other accepts."
     *
     * <p><strong>An overload rather than an interface or a generic.</strong> The
     * two entities share no supertype and should not gain one for this — they are
     * unrelated records that happen to denormalize the same source. What matters is
     * the property the single-method form exists to guarantee, and it holds here
     * too: there is no way to call this and write five of the six. ADR 0018 §3.3's
     * warning is the reason ("getting it half-right leaves a row nothing in the
     * system can render correctly or explain"), and on a <em>shared</em> record
     * that row is visible to every member of the group rather than to one user.
     *
     * <p>{@code categoryTone} is always {@link #EXPENSE_TONE} on this path: a split
     * expense is always an expense, {@code split_expenses} has no {@code type}
     * column, and {@link #forIncome()} is unreachable from
     * {@code CategorySnapshotResolver#resolveForSplitExpense}.
     */
    public void applyTo(SplitExpense splitExpense) {
        splitExpense.setCategoryId(categoryId);
        splitExpense.setCategoryName(categoryName);
        splitExpense.setParentCategoryName(parentCategoryName);
        splitExpense.setCategoryIconName(categoryIconName);
        splitExpense.setCategoryGlyph(categoryGlyph);
        splitExpense.setCategoryTone(categoryTone);
    }
}
