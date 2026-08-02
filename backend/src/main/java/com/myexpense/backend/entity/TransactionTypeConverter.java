package com.myexpense.backend.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * Persists {@link TransactionType} as its lowercase {@code value}
 * (e.g. {@code "expense"}) rather than Hibernate's default enum-name mapping,
 * so the stored value matches docs/architecture/data-model.md §2.2 — and the
 * column's own CHECK constraint — exactly.
 *
 * <p>Same shape and reasoning as {@link VerificationTokenTypeConverter}; this
 * is the established convention in this schema for a {@code varchar} column
 * holding a fixed lowercase vocabulary.
 */
@Converter(autoApply = true)
public class TransactionTypeConverter implements AttributeConverter<TransactionType, String> {

    @Override
    public String convertToDatabaseColumn(TransactionType attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public TransactionType convertToEntityAttribute(String dbData) {
        return dbData == null ? null : TransactionType.fromValue(dbData);
    }
}
