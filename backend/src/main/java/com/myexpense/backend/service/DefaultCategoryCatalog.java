package com.myexpense.backend.service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.myexpense.backend.entity.Category;

/**
 * The 8 default categories seeded for <strong>every</strong> new user at
 * registration (docs/architecture/data-model.md §2.1; Project-Owner-confirmed
 * 2026-10-02, with no exemption for test accounts —
 * docs/decisions/0017-per-currency-balances-and-partial-settlement.md's
 * Backend-Engineer follow-up list).
 *
 * <p><strong>The count has moved 8 → 7 → 8, with different membership each
 * time, and neither move was a reversal of the other.</strong> That history is
 * worth two paragraphs, because the next reader will otherwise assume the
 * latest change undid the previous one.
 *
 * <p><strong>8 → 7 on 2026-10-21</strong>
 * ({@code docs/decisions/0018-income-is-not-a-category.md} §2) dropped the
 * {@code Income} entry: income is not a category at all. The discriminator
 * between money in and money out is {@code transactions.type} and only that
 * (ADR 0018 §1), income transactions are written with
 * {@code category_id = NULL}, and their display values come from
 * {@link IncomeCategorySnapshot} rather than from a row in this table. Do not
 * re-add {@code Income} here, and do not add a semantic
 * {@code is_income}/{@code kind}/{@code slug} marker to compensate (ADR 0018
 * §4 rejects exactly that): a row for income made it selectable as an
 * <em>expense</em> category and cappable as a <em>spending</em> limit, both
 * nonsense and both live behaviour before that change.
 *
 * <p><strong>7 → 8 on 2026-10-25</strong>
 * ({@code docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md}
 * §2.1) added {@code Misc}, <strong>last</strong>, and
 * <strong>this is not {@code Income} coming back.</strong> {@code Income} was
 * removed because it was nonsense <em>as a category</em>; {@code Misc} is an
 * ordinary expense bucket a user can legitimately spend into, and it exists
 * because {@code DELETE /api/v1/categories/{id}} needs a reassignment target
 * that is <strong>guaranteed to exist</strong>. It is the only row in the
 * system that carries {@code is_protected = true} (see {@link #newRowsFor}),
 * and it is found by that column and never by its name.
 *
 * <p><strong>The order is specified, not incidental:</strong> {@code Misc} is
 * last, after {@code Fitness / Leisure}. This catalog's order is the frontend's
 * display order.
 *
 * <p><strong>These values mirror the frontend's {@code useCategoriesStore}
 * initial list</strong> — same names, same Ionicons names, same fallback
 * glyphs, same order, all with no cap. That is the whole point: when
 * {@code useCategoriesStore} is swapped to read from
 * {@code GET /api/v1/categories}, a freshly registered user must see the
 * identical list they see today, or the swap looks like a regression. Note
 * {@code Fitness / Leisure}'s glyph is {@code W}, not {@code F} — that is the
 * frontend's own value, kept rather than "corrected".
 * <strong>One known, temporary divergence, unchanged in shape by this
 * round:</strong> that store still carries a {@code cat-income} entry and no
 * {@code Misc} entry, so the two lists happen to be the same <em>length</em>
 * again while still disagreeing on membership. Both halves of the fix are the
 * Frontend Engineer's (ADR 0018 follow-up item 2, ADR 0021's frontend
 * follow-up); the server is authoritative.
 *
 * <p>{@code ellipsis-horizontal-outline} is the first icon this series has
 * added (ADR 0021's Documentation section, {@code design-system.md} §6). The
 * user-created-category convention {@code settings-outline} would have read as
 * "settings" in a category list and been actively misleading.
 *
 * <p>A standalone catalog rather than a constant block inside
 * {@link CategoryService} because the seed set is a referenced artifact in its
 * own right (data-model.md §2.1, {@code V8}'s CONTRACT item 1, the frontend
 * store, and the README's "a new user has exactly 8 rows" check all point at
 * it) and it is easier to review in one place.
 *
 * <p>{@code is_default} is set explicitly to {@code true} here rather than
 * left to the column default, which is {@code FALSE}
 * (V3__categories.sql) — these are the only rows in the system that carry it.
 * It is <strong>informational only</strong> and is deliberately
 * <em>not</em> how the protected row is found: all eight rows carry it.
 *
 * <p>Ids are application-assigned, per {@link Category}'s convention. They are
 * random UUIDs: <strong>no default category has a stable, well-known id</strong>,
 * and pinning one was considered and rejected (ADR 0018, "Why the alternative
 * was rejected") — including for {@code Misc}, which is why
 * {@code is_protected} exists at all. No server code resolves a category by
 * name or by well-known id anywhere, which is what makes a user-created
 * category called "Income" (or "misc") harmless rather than a collision
 * (ADR 0018 §5).
 */
public final class DefaultCategoryCatalog {

    /** One catalog entry — intentionally not the entity, so the catalog carries no per-user state. */
    private record DefaultCategory(String name, String iconName, String glyph) {
    }

    private static final List<DefaultCategory> DEFAULTS = List.of(
            new DefaultCategory("Food", "cafe-outline", "F"),
            new DefaultCategory("Transport", "car-outline", "T"),
            new DefaultCategory("Groceries", "cart-outline", "G"),
            new DefaultCategory("Entertainment", "film-outline", "E"),
            // No `Income` entry — ADR 0018 §2. Its four display values live in
            // IncomeCategorySnapshot and are written onto the transaction, not
            // stored as a category row.
            new DefaultCategory("Home / Rent", "home-outline", "H"),
            new DefaultCategory("Shopping", "bag-outline", "S"),
            new DefaultCategory("Fitness / Leisure", "barbell-outline", "W"));

    /**
     * The 8th and last seeded row, and the <strong>only</strong> one created
     * with {@code is_protected = true} (ADR 0021 §2.1, V8's CONTRACT item 1).
     *
     * <p>Held apart from {@link #DEFAULTS} rather than carried as a fourth
     * record component, for two reasons. The shape of a catalog entry is
     * {@code (name, iconName, glyph)} and a boolean that is {@code false} on
     * seven of eight rows belongs on the builder, not in the data (V8's
     * CONTRACT item 1 says exactly this). More importantly, keeping it separate
     * is what lets {@link #newRowsFor} set the flag <strong>positionally</strong>
     * — nothing here compares a name to the string {@code "Misc"}, which would
     * be the by-name resolution this entire mechanism exists to avoid.
     *
     * <p>The values are byte-identical to {@code V8}'s STEP 5 backfill, and
     * must stay that way: a user backfilled by the migration and a user
     * registered afterwards would otherwise hold visibly different reassignment
     * targets. <strong>There is no {@code tone} value to set</strong> —
     * {@code categories} has no tone column and must not gain one (ADR 0018
     * §4), and a transaction's {@code category_tone} is derived from its
     * {@code type}, so every expense reassigned here already renders
     * {@code neutral} with nothing stored.
     */
    private static final DefaultCategory PROTECTED_FALLBACK =
            new DefaultCategory("Misc", "ellipsis-horizontal-outline", "M");

    private DefaultCategoryCatalog() {
    }

    /**
     * Fresh, not-yet-persisted rows for one user — in the frontend's own
     * display order, all with {@code monthlyCap = null} (no cap) and
     * {@code isDefault = true}, and exactly one of them (the last) with
     * {@code isProtected = true}.
     *
     * <p>Every row is top-level: {@code parentCategoryId} is left unset, which
     * is simply what the builder already produces, and no subcategory is ever
     * seeded (ADR 0019 §8). The protected row <em>must</em> be top-level —
     * {@code chk_categories_protected_is_top_level} enforces it, and the
     * reassignment write depends on it so it can always set
     * {@code transactions.parent_category_name = NULL} without a branch.
     */
    public static List<Category> newRowsFor(UUID userId) {
        List<Category> rows = new ArrayList<>(DEFAULTS.size() + 1);
        for (DefaultCategory definition : DEFAULTS) {
            rows.add(newRow(userId, definition, false));
        }
        rows.add(newRow(userId, PROTECTED_FALLBACK, true));
        return List.copyOf(rows);
    }

    private static Category newRow(UUID userId, DefaultCategory definition, boolean protectedCategory) {
        return Category.builder()
                .id(UUID.randomUUID())
                .userId(userId)
                .name(definition.name())
                .iconName(definition.iconName())
                .glyph(definition.glyph())
                .monthlyCap(null)
                .defaultCategory(true)
                .protectedCategory(protectedCategory)
                .build();
    }
}
