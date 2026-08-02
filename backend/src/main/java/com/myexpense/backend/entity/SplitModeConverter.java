package com.myexpense.backend.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * Persists {@link SplitMode} as its lowercase {@code value}
 * (e.g. {@code "individual"}), matching docs/architecture/data-model.md §4.6 and
 * {@code chk_split_expenses_split_mode_valid}. Same convention as
 * {@link TransactionScopeConverter}.
 */
@Converter(autoApply = true)
public class SplitModeConverter implements AttributeConverter<SplitMode, String> {

    @Override
    public String convertToDatabaseColumn(SplitMode attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public SplitMode convertToEntityAttribute(String dbData) {
        return dbData == null ? null : SplitMode.fromValue(dbData);
    }
}
