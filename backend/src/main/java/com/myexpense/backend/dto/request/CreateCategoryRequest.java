package com.myexpense.backend.dto.request;

import java.math.BigDecimal;
import java.util.UUID;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code POST /api/v1/categories} (api-overview.md §3.2).
 *
 * <p>A record, unlike {@link UpdateCategoryRequest}: on a create there is no
 * "field omitted vs. explicitly null" distinction to preserve — an absent
 * {@code monthlyCap} and {@code "monthlyCap": null} both mean the same thing
 * ("no cap"), which is exactly what a {@code null} component expresses. The
 * same is true of {@link #parentCategoryId}: absent and {@code null} both mean
 * "create a top-level category".
 *
 * <p><strong>{@code parentCategoryId} added 2026-10-22</strong> (ADR 0019 §7)
 * — this one optional field is the entire create-a-subcategory surface. There
 * is deliberately no {@code /categories/{id}/subcategories} sub-resource,
 * because a subcategory <em>is</em> a category row and a sub-resource would
 * duplicate this endpoint's validation, trimming, uniqueness handling and DTO
 * mapping.
 *
 * <p>{@code isDefault} is <strong>not</strong> a field here, deliberately:
 * only the registration seed sets it, so a client-created category is always
 * {@code isDefault: false} (contract, §3.2) — including a subcategory, since
 * none is ever seeded (ADR 0019 §8). A client cannot assert it, and
 * an {@code isDefault} key in the body is ignored rather than applied.
 */
public record CreateCategoryRequest(

        @NotBlank
        @Size(max = 100)
        String name,

        /*
         * The contract states "required" without a length; 100 mirrors the
         * icon_name column (varchar(100), data-model.md §2.1) so an
         * over-long value is a clean 400 rather than a truncation or a
         * database error. Flagged in backend/README.md §12 as derived from
         * the column rather than from the contract.
         */
        @NotBlank
        @Size(max = 100)
        String iconName,

        /* Contract: "required, 1-2 chars" — stricter than the varchar(4) column. */
        @NotBlank
        @Size(min = 1, max = 2)
        String glyph,

        /*
         * Contract: "optional, nullable, > 0 if present".
         *
         * - DecimalMin(inclusive = false) is the "> 0" half; null is valid
         *   for this constraint, which is what keeps the field optional.
         * - Digits matches numeric(12,2) exactly, so an amount with more than
         *   two decimal places (or more than 10 integer digits) is a 400
         *   VALIDATION_ERROR naming the field, not a silent rounding or a
         *   500 from the database. This is the sub-paise granularity guard
         *   security-architecture.md §3 asks for on money fields.
         *
         * One rule Bean Validation deliberately does NOT express here: a
         * non-null monthlyCap alongside a non-null parentCategoryId is a 400
         * (caps are top-level-only, ADR 0019 §4). That is a cross-field rule,
         * and CategoryService rejects it next to the other two subcategory
         * rules rather than splitting the four of them across two mechanisms
         * — see SubcategoryCapNotSupportedException.
         */
        @DecimalMin(value = "0", inclusive = false)
        @Digits(integer = 10, fraction = 2)
        BigDecimal monthlyCap,

        /*
         * Contract (§3.2): "uuid, optional — omit or null to create a
         * top-level category; a top-level category of the caller's own to
         * create a subcategory under it".
         *
         * No Bean Validation annotation is possible or wanted beyond the type
         * itself: a malformed uuid fails deserialization and is already a 400
         * via the central handler, and everything else about this value is a
         * server-side question that only the database can answer —
         *   * does it resolve to a category OWNED BY THE CALLER
         *     (404 PARENT_CATEGORY_NOT_FOUND, never a 403, which would
         *     confirm existence to a non-owner), and
         *   * is that row itself top-level
         *     (400 SUBCATEGORY_DEPTH_EXCEEDED).
         * Both are re-validated in CategoryService regardless of what the
         * client offers (security-architecture.md §3).
         *
         * user_settings.subcategoriesEnabled is NOT consulted: it is a client
         * affordance, and a subcategory created while it is off is still a
         * legitimate, user-owned row (ADR 0019 §6.1).
         */
        UUID parentCategoryId,

        /*
         * ADR 0027 §3 (api-overview.md §15.2): optional client-supplied
         * primary key, not the nil UUID. Exists nowhere -> created with it;
         * created by the caller -> 201 with the current row; created by
         * someone else -> 409 ID_CONFLICT.
         */
        UUID id) {
}
