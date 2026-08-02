package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 404 on {@code PATCH /api/v1/categories/{id}} (api-overview.md §3.3).
 *
 * <p><strong>Returned both when the category does not exist and when it
 * exists but belongs to a different user</strong> — identically, never a 403.
 * A 403 would confirm to a non-owner that the id is real
 * (security-architecture.md §2's owner-scoped convention). The message is
 * deliberately the same in both cases for the same reason.
 */
public class CategoryNotFoundException extends ApiException {

    public CategoryNotFoundException() {
        super(HttpStatus.NOT_FOUND, "CATEGORY_NOT_FOUND", "Category not found.");
    }
}
