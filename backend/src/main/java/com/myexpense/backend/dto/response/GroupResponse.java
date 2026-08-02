package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * {@code GroupResponse} (api-overview.md §7.1) — returned by
 * {@code GET /api/v1/groups} (as an array element), {@code POST /api/v1/groups}
 * ({@code 201}) and {@code GET /api/v1/groups/{id}} ({@code 200}), the same
 * shape in all three.
 *
 * <p>Never the {@code ExpenseGroup} entity (constitution §9) — and here that
 * matters more than usual, because two of the four interesting fields are not
 * columns at all: {@code members[]} is a join and {@code yourBalance} comes from
 * a different table, per viewer.
 *
 * <h2>{@code yourBalance} is VIEWER-RELATIVE, and is a SINGLE NUMBER</h2>
 *
 * <p>It is built from the <strong>requesting principal's own</strong>
 * {@code group_member_balances} row (§7.1), which is what it must be:
 * {@code groups} has no stored balance column, because one group-level number
 * could not be correct for two members at once (data-model.md §4.2). Positive
 * means the caller is owed, negative means the caller owes, and {@code 0.00}
 * means settled up — which is every group this sub-step creates, since nothing
 * in §6/§7 moves money.
 *
 * <p>It briefly became {@code yourBalances[]} (one entry per currency) on
 * 2026-10-02 and was <strong>reverted the same day</strong>
 * (ADR 0017's Scope Narrowing banner). Currency is a display symbol only, so a
 * member has exactly one balance in a group and per-currency entries would have
 * split one true balance into rows that the array's own "never sum these" rule
 * then forbade recombining. <strong>There is no {@code currencyCode} field
 * anywhere in this type</strong> — the number is rendered with the symbol from
 * §2.1's {@code defaultCurrencyCode}. Do not add one.
 *
 * <h2>{@code createdByUserId} is a record, not a permission</h2>
 *
 * <p>It is returned because §7.1's shape carries it, and a client may render
 * "created by". <strong>A client must never infer a capability from it</strong>
 * and nor does the server: there is no {@code 'owner'} role this phase, every
 * member may add members (§7.4), and authorization is membership
 * (V10's RULE 1).
 *
 * <p>{@code lastActivity} is free-text shared display state and is {@code null}
 * on every group until a split or settlement writes it (V11/V12). It is present
 * as a key regardless, per the uniform key-set convention.
 */
public record GroupResponse(
        UUID id,
        String name,
        UUID createdByUserId,
        String lastActivity,
        List<GroupMemberSummary> members,
        BigDecimal yourBalance,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {
}
