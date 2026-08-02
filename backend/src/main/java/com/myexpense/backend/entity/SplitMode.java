package com.myexpense.backend.entity;

/**
 * Mirrors the {@code split_expenses.split_mode} values exactly
 * (docs/architecture/data-model.md §4.6, api-overview.md §9.1):
 * {@code 'individual'} | {@code 'group'}. Persisted via
 * {@link SplitModeConverter}.
 *
 * <p><strong>This is the one vocabulary column in the splits domain that gets an
 * enum, and {@code V11} explains why in its own terms.</strong>
 * {@code chk_split_expenses_split_mode_valid} exists because
 * {@code chk_split_expenses_target_matches_mode} keys off these two literals: an
 * out-of-vocabulary value such as {@code 'Group'} would silently disable that
 * constraint's first branch and let a split expense be stored with no target at
 * all. The service branches on this value on every read and every write, so an
 * enum is worth its two files here.
 *
 * <p><strong>{@code split_method} and {@code settlements.method} deliberately
 * stay plain {@link String}s</strong>, which is the same test applied and
 * answered the other way: nothing in the schema or the service keys off either
 * literal, neither partitions money ({@code V11} — "the method records HOW the
 * shares were derived in the UI, not what they are"), and both are constrained
 * by a DTO {@code @Pattern} against the contract's exact lowercase vocabulary.
 * That is where {@code V1} left {@code user_roles.role} and {@code V10} left
 * {@code group_members.role}.
 */
public enum SplitMode {

    INDIVIDUAL("individual"),
    GROUP("group");

    private final String value;

    SplitMode(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /** The exact lowercase contract/column value → enum. See {@link TransactionType#fromValue}. */
    public static SplitMode fromValue(String value) {
        for (SplitMode mode : values()) {
            if (mode.value.equals(value)) {
                return mode;
            }
        }
        throw new IllegalArgumentException("Unknown split mode: " + value);
    }
}
