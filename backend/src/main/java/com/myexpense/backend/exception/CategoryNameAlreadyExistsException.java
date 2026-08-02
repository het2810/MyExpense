package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 409 on {@code POST}/{@code PATCH /api/v1/categories} when either of the two
 * partial unique indexes named in {@code CategoryService.UNIQUE_NAME_CONSTRAINTS}
 * would be violated — i.e. the caller already has a category with this name,
 * <strong>compared case-insensitively</strong> (ADR 0018 §6 — {@code food}
 * conflicts with an existing {@code Food}) <strong>among its siblings</strong>
 * (ADR 0019 §3; api-overview.md §3.2/§3.3).
 *
 * <p>So a top-level name conflicts with other top-level names, and a
 * subcategory's name conflicts only with the other children of its own parent:
 * {@code Food › Snacks} and {@code Transport › Snacks} may both exist, and a
 * top-level {@code Snacks} may coexist with either, while {@code Food} and
 * {@code food} still may not coexist at either level.
 *
 * <p><strong>The error code is unchanged by both decisions, deliberately:</strong>
 * no client needs to change for the rule to become stricter (2026-10-10) or
 * for its scope to narrow (2026-10-22) — {@code errorMessages.js} maps by
 * code. Two index names now map here where one did before.
 *
 * <p>Scoped to the caller's own list, never globally: two different users may
 * each have a category called {@code Food}.
 */
public class CategoryNameAlreadyExistsException extends ApiException {

    public CategoryNameAlreadyExistsException() {
        super(HttpStatus.CONFLICT, "CATEGORY_NAME_ALREADY_EXISTS", "A category with this name already exists.");
    }
}
