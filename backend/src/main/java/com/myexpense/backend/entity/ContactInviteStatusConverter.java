package com.myexpense.backend.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * Persists {@link ContactInviteStatus} as its lowercase {@code value}
 * (e.g. {@code "queued"}), matching data-model.md §4.9 and the column's
 * {@code chk_contact_invites_status_valid} CHECK. Same convention as
 * {@link TransactionScopeConverter} and {@link VerificationTokenTypeConverter}.
 */
@Converter(autoApply = true)
public class ContactInviteStatusConverter implements AttributeConverter<ContactInviteStatus, String> {

    @Override
    public String convertToDatabaseColumn(ContactInviteStatus attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public ContactInviteStatus convertToEntityAttribute(String dbData) {
        return dbData == null ? null : ContactInviteStatus.fromValue(dbData);
    }
}
