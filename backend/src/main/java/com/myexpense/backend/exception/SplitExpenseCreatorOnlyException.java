package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 403 SPLIT_EXPENSE_CREATOR_ONLY} — ADR 0028 §2.1, api-overview.md §9.4/§9.5.
 *
 * <p>An <strong>individual</strong> split may be edited or deleted only by its
 * creator. A registered counterpart can already read the split (§9.2), so a
 * {@code 403} reveals nothing; a {@code 404} would claim a split they can see
 * does not exist. Anyone who cannot see the split still gets
 * {@link SplitExpenseNotFoundException}, never this.
 */
public class SplitExpenseCreatorOnlyException extends ApiException {

    public SplitExpenseCreatorOnlyException() {
        super(HttpStatus.FORBIDDEN, "SPLIT_EXPENSE_CREATOR_ONLY",
                "Only the person who added this expense can edit or delete it.");
    }
}
