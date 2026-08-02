package com.myexpense.backend.repository;

import java.util.UUID;

/**
 * The columns of a split expense that never change after create and that the
 * edit/delete path needs <em>before</em> taking any lock (ADR 0028 §4.4 step 3):
 * who may see it, whether the caller is the creator, the category (for the
 * {@code FOR SHARE} step) and the personal transaction to lock first (§4.5).
 * A projection, not an entity, so it never shadows the locked re-read.
 */
public record SplitExpenseHeadRow(
        UUID id,
        UUID createdByUserId,
        UUID groupId,
        UUID categoryId,
        UUID personalTransactionId) {
}
