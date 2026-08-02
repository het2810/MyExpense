package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 400 when a non-null {@code monthlyCap} is sent for a category that has a
 * parent — on {@code POST /api/v1/categories} alongside a
 * {@code parentCategoryId}, or on {@code PATCH /api/v1/categories/{id}} where
 * the target row is a subcategory (api-overview.md §3.2/§3.3, ADR 0019 §4 —
 * new 2026-10-22).
 *
 * <p><strong>Monthly caps are top-level-only this phase, structurally rather
 * than by convention:</strong> the database carries
 * {@code CHECK (parent_category_id IS NULL OR monthly_cap IS NULL)}
 * ({@code chk_categories_subcategory_has_no_cap}), and a parent's cap is
 * evaluated <em>inclusive</em> of its subcategories' spending. Per-level caps
 * are a cluster of undecided product rules (is a child's cap carved out of the
 * parent's or additional to it; what happens when children sum past the
 * parent; which cap fires the overspending notification) and were deliberately
 * deferred rather than half-designed. This rejection and that CHECK are both
 * meant to be droppable in one pass if per-child caps are ever commissioned.
 *
 * <p><strong>The error code is the generic {@code VALIDATION_ERROR}, not a
 * dedicated one, and that is the contract's own choice</strong> (ADR 0019 §7):
 * no client should ever send this — the create-subcategory form has no cap
 * field — so generic copy is adequate for what is a defence-in-depth
 * rejection. A named exception class with a generic code keeps the condition
 * documented next to the rule while leaving the wire contract alone.
 *
 * <p>The response therefore carries no {@code fieldErrors}, which matches the
 * other {@code VALIDATION_ERROR} produced outside Bean Validation (a
 * malformed body, {@code GlobalExceptionHandler#handleUnreadable}).
 */
public class SubcategoryCapNotSupportedException extends ApiException {

    public SubcategoryCapNotSupportedException() {
        super(
                HttpStatus.BAD_REQUEST,
                "VALIDATION_ERROR",
                "A subcategory cannot have a monthly cap. Set the cap on its parent category instead.");
    }
}
