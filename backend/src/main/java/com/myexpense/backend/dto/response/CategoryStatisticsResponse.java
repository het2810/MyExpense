package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * {@code CategoryStatisticsResponse} (api-overview.md §14.1) — the only shape
 * {@code GET /api/v1/statistics/categories} returns.
 *
 * <p>Never a JPA entity and never a repository projection: this is a derived
 * read model over {@code transactions} and {@code categories}, and neither
 * table's row shape belongs on the wire (constitution §9).
 *
 * <h2>{@code totalSpent} is exactly the sum of {@code categories[].amount}</h2>
 *
 * <p>That is the contract's half of a bargain (ADR 0022 §4): there is
 * <strong>no {@code percentage} field</strong> anywhere in this response,
 * because a percentage is a division of two numbers the payload already carries
 * (constitution §17), its rounding is a presentation decision the renderer owns,
 * and money here is exact decimal while a percentage is not. In exchange, the
 * division is always well defined — {@code StatisticsService} computes
 * {@code totalSpent} by adding up the very entries it emits, so the two cannot
 * drift. The client must still guard {@code totalSpent: 0}.
 *
 * <h2>Three fields that are deliberately absent</h2>
 *
 * <ul>
 *   <li><strong>No {@code transactionCount}.</strong> The drill-down's
 *       "N transactions" is {@code totalElements} on the
 *       {@code GET /transactions?categoryId=} call that screen is already
 *       making (api-overview.md §14.1, §"Common types"). A second source for one
 *       number is how two screens come to disagree.</li>
 *   <li><strong>No currency field on any amount.</strong> Currency is a display
 *       symbol only and lives solely on §2.1's {@code defaultCurrencyCode}
 *       (ADR 0017's Scope Narrowing banner).</li>
 *   <li><strong>No parent "direct spend" field</strong> — see
 *       {@link CategorySpend#amount()}.</li>
 * </ul>
 *
 * @param dateFrom   echoed back exactly as supplied, {@code null} when the
 *                   caller omitted it (i.e. no lower bound). Present-and-null
 *                   rather than omitted, which is the uniform key-set convention
 *                   this API has used since ADR 0003 §2 — a client maps the
 *                   shape once
 * @param dateTo     the same, for the upper bound
 * @param totalSpent never {@code null}; {@code 0.00} when nothing was spent in
 *                   the range
 * @param categories <strong>top-level categories only</strong>, never
 *                   {@code null} — {@code []} when nothing was spent. Zero-spend
 *                   categories are omitted rather than returned with
 *                   {@code amount: 0.00}: a pie has no zero slices, and this is
 *                   the same omission-over-null-entry convention
 *                   {@code budget_period_category_caps} already uses
 *                   (data-model.md §3.2)
 */
public record CategoryStatisticsResponse(
        LocalDate dateFrom,
        LocalDate dateTo,
        BigDecimal totalSpent,
        List<CategorySpend> categories) {

    /**
     * One pie slice: a <strong>top-level</strong> category and its rolled-up
     * expense total (api-overview.md §14.1).
     *
     * <p>Nested rather than flat, which is the same decision and the same
     * reasoning as {@link CategoryResponse}: a pie chart wants exactly the
     * top-level array and a drill-down wants exactly one entry's
     * {@code subcategories}, so no consumer should have to group a flat list to
     * find the level it wants (ADR 0022 §3).
     *
     * @param categoryName  the category row's name <strong>as it is now</strong>,
     *                      not a transaction snapshot — this is a live aggregate
     *                      over current categories, not a historical record
     *                      (ADR 0022 §3)
     * @param iconName      likewise from the category row
     * @param glyph         likewise from the category row
     * @param amount        <strong>inclusive of every subcategory's spend.</strong>
     *                      Not a new definition — it is the one
     *                      {@code GET /transactions?categoryId=} and a parent's
     *                      budget cap already use. Three surfaces, one definition
     *                      of "spending in this category"; if they ever disagree,
     *                      a user sees a pie slice that contradicts their budget
     *                      warning.
     *                      <p><strong>The parent's own direct spend is NOT a
     *                      field.</strong> It is this {@code amount} minus the sum
     *                      of {@code subcategories[].amount} — one subtraction, in
     *                      the one place that wants it. Shipping all three numbers
     *                      would be shipping a fact twice (constitution §17,
     *                      ADR 0022 §3)
     * @param subcategories the children's own amounts, zero-spend children
     *                      omitted. Always present, never {@code null} —
     *                      {@code []} for a parent with no subcategory spend,
     *                      which is not missing data
     */
    public record CategorySpend(
            UUID categoryId,
            String categoryName,
            String iconName,
            String glyph,
            BigDecimal amount,
            List<SubcategorySpend> subcategories) {
    }

    /**
     * One subcategory's own amount inside its parent's slice.
     *
     * <p><strong>A distinct type from {@link CategorySpend}, carrying no
     * {@code subcategories} key at all</strong> — which is both what
     * api-overview.md §14.1's documented JSON shows for a child and what makes
     * the one-level rule structural instead of conventional (ADR 0019 §2: a row
     * with a parent can never itself be a parent). A single recursive type would
     * leave every child with an empty array that exists only to be ignored, and
     * would make a third level expressible in code that the database forbids.
     *
     * <p>The five components are duplicated from {@link CategorySpend} rather
     * than extracted into a shared supertype: records cannot extend records, and
     * an interface over two 5-component shapes would buy nothing a reader needs
     * (constitution §25 — duplicate once is acceptable).
     *
     * @param amount this subcategory's own spend. It is also included in its
     *               parent's {@code amount}; that is the roll-up, not
     *               double-counting, and {@code totalSpent} counts it exactly
     *               once because it sums the <em>parents</em>
     */
    public record SubcategorySpend(
            UUID categoryId,
            String categoryName,
            String iconName,
            String glyph,
            BigDecimal amount) {
    }
}
