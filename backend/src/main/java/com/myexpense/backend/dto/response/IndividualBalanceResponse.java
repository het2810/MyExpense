package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * {@code IndividualBalanceResponse} (api-overview.md §8.1) — returned as an array
 * element by {@code GET /api/v1/splits/individuals}.
 *
 * <p>Never the {@code IndividualBalance} entity (constitution §9), and here that
 * is not a formality: <strong>three of the five interesting fields are
 * transformations of the row rather than copies of it.</strong>
 *
 * <h2>{@link #counterpartUserId}/{@link #counterpartContactId} resolve to the
 * OTHER party, whichever column that is</h2>
 *
 * <p>A stored row's {@code user_id} is "the lesser uuid of a shared pair" on a
 * registered-pair row and "the owner" on a contact row (ADR 0023 §1.2). So the
 * mapping is not positional: when the caller is the canonical
 * {@code counterpart_user_id}, the counterpart this response names is the row's
 * {@code user_id}. ADR 0023 §1.4 states the rule as "whichever column that is".
 *
 * <h2>{@link #balance} arrives ALREADY ORIENTED to the caller</h2>
 *
 * <p>Positive means the caller is owed, negative means the caller owes, and
 * {@code 0.00} means settled up — which is what the field already meant to the
 * client and what §8.1's existing {@code -250.00} example implies. The stored
 * value is signed relative to {@code user_id}, so the service <strong>negates it
 * exactly once, in one place</strong>, when the caller is the canonical
 * counterpart (ADR 0023 §1.4: "one flip, in one place in the service, so that
 * {@code balance} always means 'from your point of view'. The client is
 * unchanged.").
 *
 * <p><strong>A client must not negate it again</strong> — ADR 0023's Frontend
 * follow-up says so explicitly, along with the other half of the consequence: a
 * pairwise balance is now <em>shared</em>, so it can change because the other
 * party acted.
 *
 * <h2>One counterpart, one entry, one number — and no {@code currencyCode}</h2>
 *
 * <p>A {@code currencyCode} field and "a counterpart may appear more than once,
 * once per currency" were added and reverted on 2026-10-02 (ADR 0017's Scope
 * Narrowing banner). Currency is a display symbol only, so one pair holds exactly
 * one row; per-currency entries would have turned one debt of 800 into "₹500 and
 * $300" that the array's own rule then forbade recombining. The number is
 * rendered with the symbol from §2.1's {@code defaultCurrencyCode}. Do not add
 * one.
 *
 * <p>{@link #counterpartName} is resolved server-side, the same convention as
 * {@code GroupResponse.members[].name} (§7.1): the linked user's
 * {@code firstName + " " + lastName}, or the contact's {@code name}. Nothing is
 * snapshotted, so a rename shows up immediately — deliberately unlike
 * {@code split_expense_participants.name}, which is frozen because a historical
 * record must not change.
 *
 * <p><strong>{@link #id} is the handle both write paths need</strong>:
 * {@code POST /split-expenses} (as {@code individualBalanceId}'s eventual value)
 * and {@code POST /splits/settle} (as its {@code individualBalanceId}) identify a
 * pair by it. There is no {@code createdAt} here, matching §8.1's shape exactly —
 * {@code updatedAt} is the only timestamp the contract carries, and it is what
 * tells a client how fresh a <em>shared</em> number is.
 */
public record IndividualBalanceResponse(
        UUID id,
        UUID counterpartUserId,
        UUID counterpartContactId,
        String counterpartName,
        BigDecimal balance,
        OffsetDateTime updatedAt) {
}
