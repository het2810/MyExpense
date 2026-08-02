package com.myexpense.backend.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * Persists {@link PaymentMode} as its lowercase {@code value}
 * (e.g. {@code "both"}), matching docs/architecture/data-model.md §2.2 and the
 * column's CHECK constraint. Same convention as
 * {@link VerificationTokenTypeConverter}.
 */
@Converter(autoApply = true)
public class PaymentModeConverter implements AttributeConverter<PaymentMode, String> {

    @Override
    public String convertToDatabaseColumn(PaymentMode attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public PaymentMode convertToEntityAttribute(String dbData) {
        return dbData == null ? null : PaymentMode.fromValue(dbData);
    }
}
