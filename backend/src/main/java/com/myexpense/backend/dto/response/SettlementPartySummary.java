package com.myexpense.backend.dto.response;

import java.util.UUID;

/**
 * {@code SettlementResponse.payer}/{@code payee} and the feed's settlement
 * {@code payer}/{@code payee} (ADR 0028 §7.4/§7.5):
 * {@code { userId, contactId, name }}, exactly one id non-null. {@code name} is
 * resolved live (users: first + last name; contacts: {@code contacts.name}).
 */
public record SettlementPartySummary(UUID userId, UUID contactId, String name) {
}
