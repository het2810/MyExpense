package com.myexpense.backend.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * Persists {@link TransactionScope} as its lowercase {@code value}
 * (e.g. {@code "personal"}), matching docs/architecture/data-model.md §2.2 and
 * the column's CHECK constraint. Same convention as
 * {@link VerificationTokenTypeConverter}.
 */
@Converter(autoApply = true)
public class TransactionScopeConverter implements AttributeConverter<TransactionScope, String> {

    @Override
    public String convertToDatabaseColumn(TransactionScope attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public TransactionScope convertToEntityAttribute(String dbData) {
        return dbData == null ? null : TransactionScope.fromValue(dbData);
    }
}
