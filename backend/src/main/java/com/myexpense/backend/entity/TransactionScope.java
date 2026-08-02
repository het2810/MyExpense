package com.myexpense.backend.entity;

/**
 * Mirrors the {@code transactions.scope} values exactly
 * (docs/architecture/data-model.md §2.2): {@code 'personal'} |
 * {@code 'group'}. Persisted via {@link TransactionScopeConverter}.
 *
 * <p><strong>{@link #GROUP} is writable as of 2026-11-03.</strong> It was not
 * before: {@code group_members} did not exist, so the membership check
 * api-overview.md §4.2 specifies was <em>vacuously false</em> for every input
 * and every {@code scope='group'} create or update — a genuine member's
 * included — was answered {@code 403 NOT_GROUP_MEMBER}. That table is applied
 * now and {@code TransactionService#requireScopeAndGroupAgree} performs the real
 * per-request lookup, so the {@code 403} is reserved for an actual non-member.
 * Note the enum itself never changed, and neither did
 * {@code Transaction#groupId}'s mapping — the column was always mapped. (An
 * earlier revision of this Javadoc and of backend/README.md §15 claimed
 * otherwise; that claim was wrong and is corrected here.)
 *
 * <p>The value has always been valid as a {@code GET /transactions?scope=}
 * filter, and now it can match rows.
 */
public enum TransactionScope {

    PERSONAL("personal"),
    GROUP("group");

    private final String value;

    TransactionScope(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /** The exact lowercase contract/column value → enum. See {@link TransactionType#fromValue}. */
    public static TransactionScope fromValue(String value) {
        for (TransactionScope scope : values()) {
            if (scope.value.equals(value)) {
                return scope;
            }
        }
        throw new IllegalArgumentException("Unknown transaction scope: " + value);
    }
}
