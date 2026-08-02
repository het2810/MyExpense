package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One entry of {@code SplitExpenseResponse.participants[]} (api-overview.md
 * §9.3).
 *
 * <p>Both id keys are <strong>always present</strong> and exactly one is non-null,
 * per the "uniform key set, present-but-null" convention ADR 0003 §2 established
 * and {@link GroupMemberSummary} already follows.
 *
 * <p>{@link #name} is the <strong>frozen snapshot</strong> stored on the row, not
 * a live lookup — the deliberate opposite of {@code GroupResponse.members[].name}.
 * ADR 0009 §2's rule is "historical accuracy — names are frozen at creation
 * time", and {@code V11} contract item 7 adds the practical half: rendering a
 * list of split expenses must not trigger a name lookup per participant, "the
 * participant name is already snapshotted on the row — use it".
 */
public record SplitParticipantSummary(
        UUID participantUserId,
        UUID participantContactId,
        String name,
        BigDecimal amount) {
}
