package com.myexpense.backend.entity;

/**
 * Mirrors the {@code transactions.payment_mode} values exactly
 * (docs/architecture/data-model.md §2.2): {@code 'cash'} | {@code 'online'} |
 * {@code 'both'}. Persisted via {@link PaymentModeConverter}.
 *
 * <p><strong>{@code payment_mode} is {@code NOT NULL} on every row regardless
 * of {@code user_settings.payment_mode_enabled}</strong> — that flag decides
 * whether Add Expense <em>shows</em> the payment-mode fields, never whether the
 * column is populated (docs/decisions/0019-subcategories-one-optional-level.md
 * §6.1 cites this exact precedent). Nothing in the Transactions write path
 * reads that setting.
 *
 * <p>{@link #BOTH} is the only value that carries {@code cash_amount} /
 * {@code online_amount}, and when it does they must sum <em>exactly</em> to
 * {@code amount} — re-validated server-side on every write
 * (docs/architecture/security-architecture.md §3; the client's own check is UX
 * only).
 */
public enum PaymentMode {

    CASH("cash"),
    ONLINE("online"),
    BOTH("both");

    private final String value;

    PaymentMode(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /** The exact lowercase contract/column value → enum. See {@link TransactionType#fromValue}. */
    public static PaymentMode fromValue(String value) {
        for (PaymentMode mode : values()) {
            if (mode.value.equals(value)) {
                return mode;
            }
        }
        throw new IllegalArgumentException("Unknown payment mode: " + value);
    }
}
