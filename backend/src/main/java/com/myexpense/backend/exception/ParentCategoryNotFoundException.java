package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 404 on {@code POST /api/v1/categories} when the request's
 * {@code parentCategoryId} does not resolve to a category owned by the caller
 * (api-overview.md §3.2, ADR 0019 §7 — new 2026-10-22).
 *
 * <p><strong>Returned both when the parent does not exist and when it exists
 * but belongs to a different user</strong> — identically, never a 403, exactly
 * as {@link CategoryNotFoundException} already does for the PATCH path. A 403
 * would confirm to a non-owner that the id is real
 * (security-architecture.md §2's owner-scoped convention).
 *
 * <p>Distinct from {@link SubcategoryDepthExceededException}, and the
 * distinction is the point (ADR 0019 §7): this means <em>absence</em>, while
 * that one means the row exists and is the caller's own but is ineligible. A
 * 404 there would be a lie.
 *
 * <p>A separate code from {@code CATEGORY_NOT_FOUND} because a different
 * resource is missing: the category being created does not exist yet, so
 * reusing that code would read as "the thing you are creating is not found".
 */
public class ParentCategoryNotFoundException extends ApiException {

    public ParentCategoryNotFoundException() {
        super(HttpStatus.NOT_FOUND, "PARENT_CATEGORY_NOT_FOUND", "Parent category not found.");
    }
}
