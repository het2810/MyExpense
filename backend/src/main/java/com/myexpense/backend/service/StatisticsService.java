package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.CategoryStatisticsQuery;
import com.myexpense.backend.dto.response.CategoryStatisticsResponse;
import com.myexpense.backend.dto.response.CategoryStatisticsResponse.CategorySpend;
import com.myexpense.backend.dto.response.CategoryStatisticsResponse.SubcategorySpend;
import com.myexpense.backend.entity.Category;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.CategoryRepository;
import com.myexpense.backend.repository.CategorySpendRow;
import com.myexpense.backend.repository.TransactionRepository;
import com.myexpense.backend.repository.UserRepository;

/**
 * Business rules for the Statistics domain (api-overview.md §14,
 * {@code docs/decisions/0022-statistics-expenses-by-parent-category.md}).
 *
 * <p>One endpoint, one method, <strong>read-only</strong>: this is a derived
 * read model over {@code transactions} and {@code categories} that writes
 * nothing, creates no table and owns no column.
 *
 * <h2>This class does not add anything up — SQL does</h2>
 *
 * <p>ADR 0022 §8 and api-overview.md §14.1 both state the aggregation as part of
 * the contract: <strong>one {@code GROUP BY}</strong>
 * ({@code TransactionRepository#aggregateSpendByCategory}), <strong>one
 * {@code categories} query</strong> for the roll-up and the display values, and
 * <strong>never</strong> a page-by-page fetch summed in Java or a query per
 * category (constitution §10's no-N+1 rule).
 *
 * <p>So the only arithmetic here is <em>re-adding numbers SQL already
 * produced</em> — folding each leaf group into its parent, and adding the
 * resulting slices up to get {@code totalSpent}. That is the §4 contract
 * ("{@code totalSpent} is exactly the sum of {@code categories[].amount}")
 * expressed as code rather than as a promise: {@code totalSpent} is computed
 * from the very list that is returned beside it, so no second query exists that
 * could drift from it.
 *
 * <h2>Expenses only, and income is unreachable rather than filtered</h2>
 *
 * <p>There is no {@code type} check in this class and no {@code type} parameter
 * on the request. The exclusion is a property of the repository query's join —
 * see its Javadoc, which is where that reasoning belongs and the only place it
 * is stated. <strong>Nothing here should re-state it as an {@code if}.</strong>
 *
 * <h2>No premium gate, and no logging</h2>
 *
 * <p>{@code 403 PREMIUM_REQUIRED} is not a valid response from this endpoint
 * (ADR 0022 §7): seeing where your own money went is the product working. There
 * is therefore no {@code users.is_premium} read on this path at all — not even
 * an unused one.
 *
 * <p>Nothing on this path logs, matching every other read in this API. It is
 * also the honest choice for this particular response: a per-category spend
 * breakdown and its total are <strong>personal financial information</strong>,
 * which constitution §23 forbids logging outright. Whether the request
 * succeeded is already visible in access logs, and the failure path is
 * {@code GlobalExceptionHandler}'s, which logs unexpected exceptions centrally.
 *
 * <h2>The rollback trap does not apply — checked, not assumed</h2>
 *
 * <p>backend/README.md §3 (points 3 and 4) records how a method that writes and
 * <em>then</em> throws silently loses the write unless every transactional
 * boundary in the chain carries {@code noRollbackFor}. Nothing in this class
 * writes: the single {@code @Transactional} is {@code readOnly = true} and both
 * queries are {@code SELECT}s. If anything here ever needs to write, that is the
 * signal to stop and re-read ADR 0022 §8 — a cached or materialized aggregate
 * was explicitly rejected, with a measured-bottleneck revisit trigger.
 */
@Service
public class StatisticsService {

    /**
     * {@code 0.00} — the contract's zero total (api-overview.md §14.1), and the
     * identity the slices are summed onto.
     *
     * <p>Scale 2, explicitly, so a zero-spend range answers {@code 0.00} rather
     * than {@code 0}: the response's other amounts come from
     * {@code numeric(12,2)} columns and carry two decimal places, and a lone
     * bare {@code 0} beside them would read as a different kind of number.
     */
    private static final BigDecimal ZERO_AMOUNT = BigDecimal.ZERO.setScale(2);

    /**
     * api-overview.md §14.1's ordering, <strong>as a total order</strong>:
     * {@code amount} descending, ties by {@code categoryName} ascending, then by
     * {@code categoryId}.
     *
     * <p>The contract specifies the first two. The third is this
     * implementation's own addition and exists for one reason: the contract's
     * reason for specifying an order at all is that "a pie legend and a bar list
     * must not reshuffle between two identical requests", and two keys only
     * achieve that if no two entries can tie on both. Sibling names are unique
     * case-insensitively, so a real tie is already unreachable — but "already
     * unreachable" is not the same guarantee as "cannot happen", and
     * {@code categoryId} makes it the latter for free. Domain 4's list ordering
     * ends with {@code id desc} for exactly the same reason.
     *
     * <p>Name ties are compared <strong>case-insensitively</strong>. Flagged as
     * derived in backend/README.md §14: the contract says "by
     * {@code categoryName} ascending" without naming a collation, and plain
     * code-point order would sort {@code Zebra} before {@code apple} in a
     * user-facing legend, which reads as a bug. Because sibling names are unique
     * case-insensitively, this comparison cannot itself create a tie between two
     * real siblings.
     *
     * <p>Note the shape: {@code comparing(...).reversed().thenComparing(...)}
     * reverses <em>only</em> the amount key. Chaining first and reversing last
     * would reverse the tie-breaks too, which is the opposite of the contract.
     */
    private static final Comparator<CategorySpend> CATEGORY_ORDER =
            Comparator.<CategorySpend, BigDecimal>comparing(CategorySpend::amount).reversed()
                    .thenComparing(CategorySpend::categoryName, String.CASE_INSENSITIVE_ORDER)
                    .thenComparing(CategorySpend::categoryId);

    /** The same total order, applied inside each parent's {@code subcategories}. */
    private static final Comparator<SubcategorySpend> SUBCATEGORY_ORDER =
            Comparator.<SubcategorySpend, BigDecimal>comparing(SubcategorySpend::amount).reversed()
                    .thenComparing(SubcategorySpend::categoryName, String.CASE_INSENSITIVE_ORDER)
                    .thenComparing(SubcategorySpend::categoryId);

    private final TransactionRepository transactionRepository;
    private final CategoryRepository categoryRepository;
    private final UserRepository userRepository;

    public StatisticsService(
            TransactionRepository transactionRepository,
            CategoryRepository categoryRepository,
            UserRepository userRepository) {
        this.transactionRepository = transactionRepository;
        this.categoryRepository = categoryRepository;
        this.userRepository = userRepository;
    }

    /**
     * {@code GET /api/v1/statistics/categories} — the caller's expense spend per
     * top-level category for an optional, inclusive date range, with subcategory
     * spend rolled up into its parent (api-overview.md §14.1).
     *
     * <p><strong>Two queries, in this order, and the order is deliberate:</strong>
     *
     * <ol>
     *   <li>the aggregate. If it is empty the method returns
     *       {@code { totalSpent: 0.00, categories: [] }} immediately — a
     *       zero-spend range therefore costs <em>one</em> query, and the
     *       second one is never issued for a user who has spent nothing in the
     *       range;</li>
     *   <li>the caller's categories — one flat read of both levels, reusing the
     *       method Domain 3's list endpoint already uses (so no new query shape
     *       was added, and the roll-up is resolved from {@code categories}
     *       exactly as §4.1's filter resolves it).</li>
     * </ol>
     *
     * <p><strong>Zero spend is a {@code 200}, never a {@code 404} and never an
     * error code</strong> (ADR 0022 §5). "Nothing was spent in this range" is a
     * successful answer to a well-formed question; it is deliberately not
     * analogous to §5.1's {@code 404 NO_ACTIVE_PERIOD}, where a resource
     * genuinely does not exist. The client renders its own empty state.
     *
     * <p><strong>Every display value comes from the category row, from this one
     * read</strong> — never from a transaction's category snapshot columns
     * (ADR 0022 §3). This is a live aggregate over current categories, not a
     * historical record; grouping by a snapshot <em>name</em> would also silently
     * merge two same-named leaves under different parents, which ADR 0019 §3
     * deliberately allows to exist.
     *
     * @param userId the authenticated caller, resolved from the verified JWT by
     *               {@code @CurrentUserId} — never a request parameter
     *               (security-architecture.md §2). Every row aggregated below is
     *               scoped to it, in the query itself
     */
    @Transactional(readOnly = true)
    public CategoryStatisticsResponse getSpendByCategory(UUID userId, CategoryStatisticsQuery query) {
        requireUser(userId);

        List<CategorySpendRow> spendByLeafCategory = transactionRepository.aggregateSpendByCategory(
                userId, query.getDateFrom(), query.getDateTo());
        if (spendByLeafCategory.isEmpty()) {
            return new CategoryStatisticsResponse(
                    query.getDateFrom(), query.getDateTo(), ZERO_AMOUNT, List.of());
        }

        // Live categories only (ADR 0024 §4.2) — a soft-deleted category is
        // never emitted as a slice. The aggregate's own join filters the same
        // way, so the two reads agree.
        Map<UUID, Category> categoriesById = new LinkedHashMap<>();
        for (Category category : categoryRepository.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAscNameAsc(userId)) {
            categoriesById.put(category.getId(), category);
        }

        List<CategorySpend> categories = rollUpIntoParents(spendByLeafCategory, categoriesById);
        BigDecimal totalSpent = categories.stream()
                .map(CategorySpend::amount)
                .reduce(ZERO_AMOUNT, BigDecimal::add);

        return new CategoryStatisticsResponse(
                query.getDateFrom(), query.getDateTo(), totalSpent, categories);
    }

    /**
     * Folds the leaf-level aggregate into the contract's two-level shape: one
     * entry per top-level category, carrying its rolled-up {@code amount} and
     * its children's own amounts (api-overview.md §14.1).
     *
     * <p>One pass over the aggregate, no further queries. Each leaf group lands
     * in <strong>exactly one</strong> parent slice — its parent's if it has one,
     * its own otherwise — which is what makes
     * {@code totalSpent = Σ categories[].amount} hold by construction rather
     * than by a second calculation that agrees. A subcategory's amount appears
     * in two places in the payload (its own entry and its parent's rolled-up
     * total) but is counted once here, because the total sums the parents.
     *
     * <p><strong>A parent's own direct spend is never materialized</strong> — it
     * is {@code amount} minus the sum of the children, and the client computes
     * that one subtraction if it needs it (ADR 0022 §3). There is no third field
     * and none is to be added.
     *
     * <p>Two states this cannot produce through the API, handled explicitly
     * rather than left to chance — the same treatment, and the same reasoning,
     * as {@code CategoryService#toTree}'s note on impossible states:
     *
     * <ul>
     *   <li><strong>a leaf that is not in the category map.</strong> The
     *       aggregate's own join already requires each leaf to be one of this
     *       caller's live category rows, so this needs the category to have been
     *       soft-deleted between the two queries. The group is skipped; because
     *       {@code totalSpent} is summed from the emitted slices, the contract's
     *       sum invariant still holds, and the next request is correct;</li>
     *   <li><strong>a subcategory whose parent is not in the map.</strong>
     *       Impossible by the composite foreign key
     *       {@code (user_id, parent_category_id) → (user_id, id)}. Rather than
     *       drop real spend, the child is emitted as its own top-level slice —
     *       the total stays truthful and the shape degrades instead of the
     *       money.</li>
     * </ul>
     */
    private static List<CategorySpend> rollUpIntoParents(
            List<CategorySpendRow> spendByLeafCategory, Map<UUID, Category> categoriesById) {

        Map<UUID, ParentSlice> slicesByTopLevelId = new LinkedHashMap<>();
        for (CategorySpendRow row : spendByLeafCategory) {
            Category leaf = categoriesById.get(row.categoryId());
            if (leaf == null) {
                continue;
            }

            Category parent = leaf.getParentCategoryId() == null
                    ? null
                    : categoriesById.get(leaf.getParentCategoryId());
            Category sliceCategory = parent != null ? parent : leaf;

            ParentSlice slice = slicesByTopLevelId.computeIfAbsent(
                    sliceCategory.getId(), id -> new ParentSlice(sliceCategory));
            slice.addSpend(row.amount());
            if (parent != null) {
                slice.addSubcategorySpend(leaf, row.amount());
            }
        }

        return slicesByTopLevelId.values().stream()
                .map(ParentSlice::toResponse)
                .sorted(CATEGORY_ORDER)
                .toList();
    }

    /**
     * One top-level category's slice while it is still being accumulated.
     *
     * <p>A small mutable accumulator rather than repeated rebuilding of an
     * immutable record: a parent can be reached twice in one pass — once by its
     * own direct spend and once per subcategory with spend — and "add to the
     * running total" is what that is.
     */
    private static final class ParentSlice {

        private final Category category;
        private final List<SubcategorySpend> subcategories = new ArrayList<>();
        private BigDecimal amount = ZERO_AMOUNT;

        private ParentSlice(Category category) {
            this.category = category;
        }

        private void addSpend(BigDecimal spend) {
            amount = amount.add(spend);
        }

        private void addSubcategorySpend(Category subcategory, BigDecimal spend) {
            subcategories.add(new SubcategorySpend(
                    subcategory.getId(),
                    subcategory.getName(),
                    subcategory.getIconName(),
                    subcategory.getGlyph(),
                    spend));
        }

        /**
         * {@code subcategories} is sorted here and copied — so the DTO handed to
         * Jackson holds no reference to this mutable accumulator, which is the
         * same sharp edge {@code CategoryService#toTree} avoids with
         * {@code List.copyOf}. {@code Stream#toList} already returns an
         * unmodifiable copy.
         */
        private CategorySpend toResponse() {
            return new CategorySpend(
                    category.getId(),
                    category.getName(),
                    category.getIconName(),
                    category.getGlyph(),
                    amount,
                    subcategories.stream().sorted(SUBCATEGORY_ORDER).toList());
        }
    }

    /**
     * A valid token whose user row no longer exists is a {@code 401}, not a
     * {@code 404} — the missing resource <em>is</em> the principal (the same
     * rule as Domains 2–4).
     *
     * <p>{@code existsById} rather than a full load, as Domains 2 and 3 do:
     * nothing on this path reads a single user column, and in particular nothing
     * reads {@code is_premium}, because this endpoint has no premium gate
     * (ADR 0022 §7).
     */
    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }
}
