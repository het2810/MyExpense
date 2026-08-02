package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One entry of {@code GroupResponse.members[]} (api-overview.md §7.1):
 * {@code { userId, invitedContactId, name, role }}.
 *
 * <p><strong>Exactly one of {@code userId}/{@code invitedContactId} is
 * non-null</strong>, mirroring {@code chk_group_members_user_xor_contact} — a
 * member is either a registered user or an invited contact (data-model.md §4.3).
 * Both keys are always present, one of them {@code null}, per this API's uniform
 * key-set convention (ADR 0003 §2); a client reads whichever is set to know
 * which kind of member it is looking at.
 *
 * <p><strong>{@code name} is a READ-TIME COMPOSITION, not a column</strong>
 * (V10 contract item 3): the linked user's {@code firstName + lastName}, or the
 * contact's {@code name}. {@code group_members} deliberately stores no name
 * snapshot — unlike {@code split_expense_participants} (V11), where the name
 * <em>is</em> frozen because a historical record must not change. A membership
 * list is current state and must reflect a rename.
 *
 * <p><strong>No balance field, deliberately.</strong> §7.1 returns no per-member
 * balance breakdown, mirroring the frontend's own explicit scope boundary
 * (ADR 0009 §5). The backend's shared-ledger model technically has the data —
 * {@code group_member_balances} has a row per member — and exposing it is a
 * real, separate future decision, not built here because it was not asked for.
 * The caller's <em>own</em> number is {@code GroupResponse.yourBalance}.
 *
 * <p><strong>No member-row id either.</strong> §7.1's shape has four keys and
 * nothing in the API addresses a membership by id (§7 has no DELETE and no
 * PATCH), so the {@code group_members.id} surrogate would be a handle to
 * nothing. {@link GroupMemberResponse} — §7.4's own {@code 201} body — does
 * carry it, because that response describes the row that was just created.
 */
public record GroupMemberSummary(
        UUID userId,
        UUID invitedContactId,
        String name,
        String role,
        /*
         * ADR 0028 §8.1 (2026-11-12) — SUPERSEDES the "No balance field" paragraph
         * above, which is kept as history: this member's
         * group_member_balances.balance (positive = owed, negative = owes),
         * 0.00 when the row is absent. Members' balances sum to exactly zero.
         */
        BigDecimal balance) {
}
