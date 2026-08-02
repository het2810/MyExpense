package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 400 VALIDATION_ERROR} for the cross-field business rules of
 * {@code POST}/{@code PATCH /api/v1/transactions} that Bean Validation cannot
 * express on a single field (api-overview.md §4.2/§4.4,
 * security-architecture.md §3).
 *
 * <h2>Why ONE parameterized class instead of seven named ones</h2>
 *
 * <p>Domain 3's precedent is a named exception class per condition
 * ({@link SubcategoryCapNotSupportedException},
 * {@link SubcategoryDepthExceededException}) — and that precedent is followed
 * here <em>in substance</em>: every condition is still named, documented and
 * referenced by name, just as a static factory on this class rather than as its
 * own file. Seven classes differing only in a message string, all carrying the
 * identical status and error code, is the duplication constitution §25 asks to
 * extract once it appears a third time. The factories keep each rule's name at
 * the throw site ({@code throw categoryIdNotAllowedForIncome()} reads exactly
 * as a dedicated class would) and keep all seven messages in one place where
 * they can be compared for consistency.
 *
 * <p><strong>Every one of these is the contract's generic
 * {@code VALIDATION_ERROR}, not a dedicated code</strong>, and that is
 * api-overview.md §4.2's own choice — its error table lists exactly one
 * {@code 400} row covering field constraints, the cash/online mismatch, a
 * {@code categoryId} sent with {@code type='income'}, and a bad
 * {@code receiptPublicId}. Inventing codes it does not define would be
 * inventing contract (constitution §15/§30). Where a dedicated code <em>is</em>
 * specified, a dedicated class exists instead
 * ({@link TransactionNotFoundException}, {@link VersionConflictException},
 * {@link ReceiptAlreadyAttachedException}, {@link NotGroupMemberException},
 * {@link CategoryNotFoundException}).
 *
 * <p>The response carries no {@code fieldErrors}, matching the other
 * {@code VALIDATION_ERROR}s produced outside Bean Validation (a malformed body
 * via {@code GlobalExceptionHandler#handleUnreadable}, and
 * {@code SubcategoryCapNotSupportedException}). Each message names the fields
 * involved in prose instead, because every one of these rules spans two or more
 * fields and attributing it to a single one would be arbitrary.
 *
 * <h2>Relationship to the database's eight {@code chk_transactions_*}
 * constraints</h2>
 *
 * <p>Each rule below is also enforced declaratively by a CHECK constraint
 * (Database Architect, 2026-10-24) — <em>except</em> the expense/income
 * {@code category_id} pair, which could not be expressed as a CHECK at all
 * because it would make {@code category_id}'s {@code ON DELETE SET NULL}
 * unexecutable. So this class is the only enforcement of two of these rules and
 * the friendly error for the rest. Reaching a CHECK violation means a rule here
 * was skipped, which surfaces as a logged {@code 500} rather than a
 * plausible-looking {@code 400} — the honest outcome, and the same arrangement
 * {@code CategoryService} documents for V6's constraints.
 */
public class TransactionRuleViolationException extends ApiException {

    private TransactionRuleViolationException(String message) {
        super(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    /**
     * {@code type='income'} with a non-null {@code categoryId} (ADR 0018 §3,
     * api-overview.md §4.2/§4.4).
     *
     * <p><strong>Rejected rather than silently ignored</strong>, deliberately:
     * dropping it quietly would hide a client bug behind a row that looks fine.
     * Income is not a category — there is nothing for the server to resolve, and
     * the snapshot comes from its own constants.
     */
    public static TransactionRuleViolationException categoryIdNotAllowedForIncome() {
        return new TransactionRuleViolationException(
                "An income transaction cannot have a category. Omit categoryId when type is 'income'.");
    }

    /**
     * {@code type='expense'} with no {@code categoryId} — on a create, and on
     * the {@code income → expense} transition, where §4.4 makes it required in
     * that same request.
     *
     * <p>Without this the row would be left with {@code type='expense'},
     * {@code category_id = NULL} and {@code category_name = 'Income'} — a state
     * nothing in the system could render correctly or explain.
     */
    public static TransactionRuleViolationException categoryIdRequiredForExpense() {
        return new TransactionRuleViolationException(
                "An expense transaction requires a category. Provide categoryId.");
    }

    /**
     * {@code scope='group'} with no {@code groupId} — the contract's "required
     * iff {@code scope='group'}", matched by the database's
     * {@code chk_transactions_group_id_matches_scope}.
     */
    public static TransactionRuleViolationException groupIdRequiredForGroupScope() {
        return new TransactionRuleViolationException(
                "A group transaction requires a groupId.");
    }

    /**
     * {@code groupId} supplied with {@code scope='personal'} — the other
     * direction of the same "iff", and also refused by
     * {@code chk_transactions_group_id_matches_scope}.
     *
     * <p>Worth stating because the shipped frontend relies on the distinction:
     * an <em>individual</em> split's consumption-share row is
     * {@code scope='personal'} with {@code groupId: null}. "Came from a split"
     * is not the same thing as "group-scoped".
     */
    public static TransactionRuleViolationException groupIdNotAllowedForPersonalScope() {
        return new TransactionRuleViolationException(
                "A personal transaction cannot have a groupId.");
    }

    /**
     * {@code paymentMode='both'} with a missing {@code cashAmount} or
     * {@code onlineAmount}.
     */
    public static TransactionRuleViolationException paymentSplitRequiredForBoth() {
        return new TransactionRuleViolationException(
                "paymentMode 'both' requires both cashAmount and onlineAmount.");
    }

    /**
     * A non-null {@code cashAmount}/{@code onlineAmount} with a
     * {@code paymentMode} other than {@code 'both'} — the "iff" half again.
     * An explicit {@code null} is fine, so a client that always sends the keys
     * is unaffected.
     */
    public static TransactionRuleViolationException paymentSplitNotAllowedForSingleMode() {
        return new TransactionRuleViolationException(
                "cashAmount and onlineAmount apply only when paymentMode is 'both'.");
    }

    /**
     * {@code cashAmount + onlineAmount != amount} — re-validated server-side on
     * every write, because the client's identical check is UX only
     * (security-architecture.md §3). Compared with
     * {@link java.math.BigDecimal#compareTo}, which is exact decimal
     * arithmetic: both operands are already constrained to at most two decimal
     * places, so this is stricter than §3's "round to integer paise before
     * comparing" rather than an approximation of it.
     */
    public static TransactionRuleViolationException paymentSplitDoesNotSumToAmount() {
        return new TransactionRuleViolationException(
                "cashAmount and onlineAmount must add up to amount exactly.");
    }

    /**
     * A {@code receiptPublicId} that does not match the configured root and the
     * caller's own user id (ADR 0020 §3's claim check, api-overview.md §4.2's
     * {@code 400} row).
     *
     * <p>No dedicated code, by the contract's own test: no correct client can
     * ever send one, since the value only ever echoes a string the server just
     * handed it. The message deliberately does not reveal the expected shape or
     * the configured root.
     */
    public static TransactionRuleViolationException receiptPublicIdNotClaimable() {
        return new TransactionRuleViolationException(
                "That receipt reference is not valid for this account.");
    }
}
