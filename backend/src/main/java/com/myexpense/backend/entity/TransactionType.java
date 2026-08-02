package com.myexpense.backend.entity;

/**
 * Mirrors the {@code transactions.type} values exactly
 * (docs/architecture/data-model.md §2.2): {@code 'expense'} |
 * {@code 'income'}. Persisted via {@link TransactionTypeConverter}, following
 * the same convention {@link VerificationTokenType} already established —
 * Hibernate's default enum-name mapping would store {@code 'EXPENSE'}, which
 * the column's own CHECK constraint rejects.
 *
 * <p><strong>This is the sole discriminator between money in and money
 * out</strong> (docs/decisions/0018-income-is-not-a-category.md §1). Income is
 * not a category: there is no {@code categories} row for it and nothing
 * resolves a category by name, so this enum — and nothing else — decides which
 * branch the write path takes:
 *
 * <ul>
 *   <li>{@link #INCOME} → {@code category_id = NULL} plus the five snapshot
 *       values from {@code IncomeCategorySnapshot} (+ a {@code null} parent
 *       name);</li>
 *   <li>{@link #EXPENSE} → a required, owner-scoped {@code category_id} whose
 *       row is snapshotted at write time.</li>
 * </ul>
 *
 * <p>{@code category_tone} is derived from this value and from nothing else —
 * {@code 'success'} for income, {@code 'neutral'} for expense (ADR 0018 §3.3,
 * api-overview.md §4.1). See {@code service/CategorySnapshot}.
 */
public enum TransactionType {

    EXPENSE("expense"),
    INCOME("income");

    private final String value;

    TransactionType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * The exact lowercase contract/column value → enum.
     *
     * <p>Callers reach this only after Bean Validation has already constrained
     * the string to one of these two literals, so the {@code throw} is a
     * programming-error guard rather than a client-facing path. It is also the
     * reverse mapping the JPA converter uses when reading a row.
     */
    public static TransactionType fromValue(String value) {
        for (TransactionType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown transaction type: " + value);
    }
}
