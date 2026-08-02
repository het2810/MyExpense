package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * {@code CategoryResponse} (api-overview.md §3.1) — returned by the list, the
 * create (201) and the update (200). {@code DELETE /categories/{id}} and
 * {@code GET /categories/{id}/usage} have their own shapes
 * ({@link CategoryDeletionResponse}, {@link CategoryUsageResponse}) and
 * deliberately echo no category (§3.4/§3.5 — the client already holds the
 * whole tree from §3.1).
 *
 * <p>Never the {@code Category} entity: {@code userId} must not cross the API
 * boundary (every row in a response already belongs to the caller by
 * construction, so echoing an owner id would only invite a client to start
 * sending one back), and serializing a managed entity would couple the wire
 * shape to the schema (constitution §9).
 *
 * <p><strong>A two-level tree since 2026-10-22</strong> (ADR 0019 §7). Two
 * fields were added, both purely additive — no existing field changed type or
 * meaning:
 * <ul>
 *   <li>{@link #parentCategoryId} — {@code null} on a top-level category, the
 *       parent's id on a subcategory;</li>
 *   <li>{@link #subcategories} — the row's children. On a subcategory it is
 *       <strong>always empty</strong>, guaranteed by the one-level rule rather
 *       than by convention (ADR 0019 §2).</li>
 * </ul>
 *
 * <p><strong>{@code GET /categories} returns top-level entries only at the
 * root</strong>; a child appears solely inside its parent's
 * {@code subcategories}. That is the point of nesting rather than returning a
 * flat list: no consumer has to filter a list to find the level it wants, and
 * this codebase has already demonstrated twice what happens when it does
 * (nothing filtered {@code Income} out of either the picker or Budget
 * Settings' caps list — ADR 0018's whole Context). {@code parentCategoryId} is
 * nonetheless carried on every child so a child is self-describing if it is
 * ever logged, cached or shipped outside its parent — and so {@code /sync/pull}
 * (api-overview.md §13.2) can carry a <em>flat</em> array of this same type
 * without inventing a second DTO.
 *
 * <p>Both keys are always present, never omitted — the "uniform key set,
 * present-but-null" convention ADR 0003 §2 established and every ADR since has
 * reused. {@code subcategories} is therefore {@code []}, never {@code null}.
 *
 * <p><strong>{@code isProtected} since 2026-10-25</strong> (ADR 0021 §2.1,
 * api-overview.md §3.1). {@code true} on exactly one row per user — the seeded
 * {@code Misc} category, which {@code DELETE /categories/{id}} reassigns to —
 * and {@code false} on everything else. <strong>A client must read this field
 * to decide whether to render a rename or delete affordance, and must never
 * match the name {@code Misc}</strong>: nothing in this API resolves a
 * category by name, names are unique only case-insensitively, and a user may
 * own their own category called {@code misc}. A protected row's
 * {@code iconName}, {@code glyph} and {@code monthlyCap} remain editable, so
 * the affordance to suppress is per-field, not the whole edit screen.
 *
 * <p><strong>Still no semantic field, and none is to be added</strong>
 * (ADR 0018 §4, re-confirmed by ADR 0019 §1): no {@code isIncome}, no
 * {@code kind}, no {@code slug}, no {@code tone}. Neither
 * {@code parentCategoryId} nor {@code isProtected} is a field of that class —
 * a semantic marker says "this row means something special" about a fact that
 * already has an authoritative home, while the first records a relationship
 * between two rows that nothing else records and the second records a
 * <em>mutability policy</em> that is derivable from nowhere else. Every row
 * here still means exactly one thing: a user-owned expense category; one row
 * per user is merely less mutable than its siblings.
 *
 * <p>{@code monthlyCap} is {@code null} when the category has no cap —
 * present-and-null, not omitted, matching the contract's
 * "number, optional, nullable" and the frontend store's existing
 * {@code monthlyCap: null} convention. On a subcategory it is
 * <strong>always</strong> {@code null}: caps are top-level-only and a parent's
 * cap includes its children's spending (ADR 0019 §4).
 *
 * <p>No {@code currencyCode}: {@code monthlyCap} is a plain amount in the one
 * unit of account, rendered with the symbol from {@code defaultCurrencyCode}
 * on {@code GET /users/me} — the only currency field in this entire API
 * (api-overview.md's 2026-10-02 update summary).
 */
public record CategoryResponse(
        UUID id,
        String name,
        String iconName,
        String glyph,
        BigDecimal monthlyCap,

        // Explicit wire name, same reasoning as UserProfileResponse.isPremium:
        // Jackson's is-getter naming rules make the wire name of an isXxx
        // property ambiguous, and the contract's field is "isDefault".
        @JsonProperty("isDefault")
        boolean isDefault,

        /*
         * true on exactly one row per user — the seeded `Misc` category — and
         * false on every other row, seeded or user-created. The client reads
         * THIS FIELD to decide whether to offer a rename or delete affordance,
         * and must never match on the name `Misc`; see the class Javadoc.
         *
         * Explicit wire name for the same reason isDefault has one.
         */
        @JsonProperty("isProtected")
        boolean isProtected,

        /*
         * null = top-level. Deliberately redundant with this entry's nesting
         * position; see the class Javadoc for the two reasons it earns its
         * place anyway (ADR 0019 §7).
         */
        UUID parentCategoryId,

        /*
         * The row's children, in the same deterministic order the list
         * endpoint uses. Always present: [] for a leaf and for a parent with
         * no children — never null, which is what lets a client map over it
         * unconditionally.
         *
         * Field order follows api-overview.md §3.1's documented JSON shape
         * (parentCategoryId then subcategories, before the timestamps) so the
         * wire output reads the same way the contract does.
         */
        List<CategoryResponse> subcategories,

        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {
}
