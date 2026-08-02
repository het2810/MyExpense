package com.myexpense.backend.service;

/**
 * The four display values the server writes onto an <strong>income</strong>
 * transaction, because income is not a category and there is no row to read
 * them from (docs/decisions/0018-income-is-not-a-category.md §3/§3.1; the
 * values themselves are
 * docs/decisions/0003-payment-mode-and-date-tracking.md's Debit/Credit
 * Amendment, Part B, unchanged since 2026-08-10).
 *
 * <p>An income transaction is persisted as:
 *
 * <pre>
 * category_id        = NULL
 * category_name      = "Income"          // NAME
 * category_icon_name = "cash-outline"    // ICON_NAME
 * category_glyph     = "I"               // GLYPH
 * category_tone      = "success"         // TONE
 * </pre>
 *
 * The four {@code category_*} columns stay {@code NOT NULL} and are
 * <em>not</em> relaxed for income (data-model.md §2.2): every transaction keeps
 * a uniform, always-renderable key set, so no screen needs a null guard, while
 * {@code category_id = NULL} honestly records that no category row was
 * involved.
 *
 * <p><strong>These values are server-authoritative.</strong> No transaction
 * endpoint accepts {@code categoryName}, {@code categoryIconName},
 * {@code categoryGlyph} or {@code categoryTone} as request fields, and a
 * client-supplied copy of them is never trusted (ADR 0018 §3.1,
 * security-architecture.md §3). The frontend holds a mirror of the same four
 * literals purely to render a locally-created income row before any round-trip
 * (ADR 0018 §7); that mirror is a rendering placeholder, never an input, and
 * the server overwrites it with its own copy.
 *
 * <p><strong>Deliberately not a {@code categories} row, not a configuration
 * property, not a {@code CategoryResponse} field.</strong> A row is the exact
 * thing ADR 0018 exists to remove; a config property would invite
 * per-environment drift in a value the client mirrors; and
 * {@code CategoryResponse} gains no field at all (ADR 0018 §4). This class is
 * a sibling of {@link DefaultCategoryCatalog} because it is the same kind of
 * artifact: a small, referenced display catalog that several documents and one
 * write path point at.
 *
 * <h2>Why this exists before its consumer does</h2>
 *
 * <p>Domain 4 (Transactions) is unbuilt, so nothing reads these constants yet.
 * ADR 0018's follow-up item 3 permits either adding them now or adding them
 * with Domain 4, and requires only that they are never re-typed inline in a
 * service. They are added now on purpose, and the reasoning is recorded here
 * because the opposite call was made for a superficially similar case:
 *
 * <ul>
 *   <li><strong>This is specified data, not unused behaviour.</strong> Domain
 *       2 declined to add an unused {@code PATCH /users/me} wrapper on the
 *       grounds that an unused wrapper is dead code — correctly, because a
 *       wrapper is a code path whose right shape (signature, error semantics,
 *       validation) depends on the caller that does not exist yet. Four
 *       approved literals have no such degrees of freedom: ADR 0018 §3.1 fixes
 *       the location, the shape and the name, so there is nothing left for
 *       Domain 4 to decide that could make this artifact wrong.</li>
 *   <li><strong>Dead code is code with no future consumer; this has a named,
 *       scheduled one</strong> (ADR 0018 follow-up items 7–10). Contrast
 *       {@code exception/PremiumRequiredException}, which is dead precisely
 *       because its consumer was removed and will never return.</li>
 *   <li><strong>It removes the failure mode the ADR actually worries about.</strong>
 *       The risk is Domain 4 re-typing {@code "cash-outline"} inline, or
 *       drifting from ADR 0003 Part B's values. A named class sitting next to
 *       {@link DefaultCategoryCatalog} is a far stronger forcing function than
 *       a line in a follow-up list, especially across sessions.</li>
 *   <li><strong>Nothing can regress.</strong> There is no behaviour here to
 *       verify, so adding it cannot affect Domain 3's verified endpoints; and
 *       if Domain 4 prefers a different shape (for example one snapshot value
 *       type covering both the income and the expense branch), four literals
 *       move at no cost.</li>
 * </ul>
 *
 * <p><strong>Scope note, flagged rather than decided here.</strong> ADR 0018
 * §3.3 also fixes the expense counterpart of {@link #TONE} — {@code tone} is
 * derived from {@code transactions.type} alone, {@code 'success'} for income
 * and {@code 'neutral'} for expense. The {@code 'neutral'} literal is
 * <em>not</em> defined in this class: this class is the income snapshot, and
 * the derivation itself (a switch on {@code type}) belongs to Domain 4's
 * transaction write path, which also needs it for expenses, whose other three
 * snapshot values come from the resolved category row. If Domain 4 would
 * rather keep both tone literals together, move {@link #TONE} to wherever that
 * derivation lives and leave this class the three category-display values —
 * what must not happen is a second, inline copy of either literal.
 */
public final class IncomeCategorySnapshot {

    /** {@code transactions.category_name} for an income row. */
    public static final String NAME = "Income";

    /** {@code transactions.category_icon_name} — an Ionicons name (design-system.md §6). */
    public static final String ICON_NAME = "cash-outline";

    /** {@code transactions.category_glyph} — the icon-less fallback badge letter. */
    public static final String GLYPH = "I";

    /** {@code transactions.category_tone} — {@code 'success'} because the type is income (ADR 0018 §3.3). */
    public static final String TONE = "success";

    private IncomeCategorySnapshot() {
    }
}
