package com.myexpense.backend.entity;

/**
 * Mirrors the {@code verification_tokens.token_type} values exactly
 * (docs/architecture/data-model.md §1.4): {@code 'password_reset'} |
 * {@code 'email_verification'}. Persisted via
 * {@link VerificationTokenTypeConverter}, which maps to/from these exact
 * lowercase snake_case column values rather than Hibernate's default
 * enum-name mapping.
 */
public enum VerificationTokenType {

    PASSWORD_RESET("password_reset"),
    EMAIL_VERIFICATION("email_verification");

    private final String value;

    VerificationTokenType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static VerificationTokenType fromValue(String value) {
        for (VerificationTokenType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown verification token type: " + value);
    }
}
