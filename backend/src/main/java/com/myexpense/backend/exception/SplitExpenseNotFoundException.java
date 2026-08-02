package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 404 SPLIT_EXPENSE_NOT_FOUND} — api-overview.md §9.2.
 *
 * <p><strong>Membership-gated, so this one code covers three different
 * situations</strong> and must not be split into clearer ones: the id does not
 * exist; it exists and targets a group the caller is not a member of; it exists
 * and targets a pair the caller is not a party to. A {@code 403} — or a different
 * message for any of the three — would confirm to a stranger that the id is real
 * (security-architecture.md §2, ADR 0014 §2 Consequence 1).
 *
 * <p>Note what the check is <strong>not</strong>:
 * {@code split_expenses.created_by_user_id} is a record, not a permission. Every
 * member of the group may read a split another member created — that is the whole
 * point of a shared ledger — so an owner-id test here would be the wrong check
 * wearing the right clothes (V10's RULE 1).
 */
public class SplitExpenseNotFoundException extends ApiException {

    public SplitExpenseNotFoundException() {
        super(HttpStatus.NOT_FOUND, "SPLIT_EXPENSE_NOT_FOUND", "Split expense not found.");
    }
}
