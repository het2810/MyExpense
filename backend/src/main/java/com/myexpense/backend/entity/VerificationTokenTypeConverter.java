package com.myexpense.backend.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * Persists {@link VerificationTokenType} as its lowercase snake_case
 * {@code value} (e.g. {@code "password_reset"}) rather than Hibernate's
 * default enum-name mapping, so the stored value matches
 * docs/architecture/data-model.md §1.4 exactly.
 */
@Converter(autoApply = true)
public class VerificationTokenTypeConverter implements AttributeConverter<VerificationTokenType, String> {

    @Override
    public String convertToDatabaseColumn(VerificationTokenType attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public VerificationTokenType convertToEntityAttribute(String dbData) {
        return dbData == null ? null : VerificationTokenType.fromValue(dbData);
    }
}
