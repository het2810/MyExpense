package com.myexpense.backend.service;

import java.time.OffsetDateTime;

/**
 * The result of one invite attempt: its {@link InviteOutcome} plus, for the two
 * blocked outcomes, when the caller may try again (api-overview.md §6.3's
 * {@code nextAllowedAt}).
 *
 * <p>A service-layer type rather than a DTO — {@code ContactService} maps it
 * onto {@code ContactInviteResponse} (§6.3) or folds it into
 * {@code ContactCreatedResponse.inviteStatus} (§6.2), and {@code GroupService}
 * only logs it, because §7.2/§7.4 return no invite field at all.
 *
 * @param outcome       never {@code null}
 * @param nextAllowedAt non-{@code null} exactly when
 *                      {@link InviteOutcome#carriesNextAllowedAt()} is
 *                      {@code true}, enforced by the two factories below rather
 *                      than left to each call site
 */
public record InviteAttempt(InviteOutcome outcome, OffsetDateTime nextAllowedAt) {

    /** An attempt that resolved without a retry time — sent, failed, or already linked. */
    public static InviteAttempt of(InviteOutcome outcome) {
        return new InviteAttempt(outcome, null);
    }

    /** A blocked attempt: {@code cooldown_active} or {@code rate_limited}, with its retry time. */
    public static InviteAttempt blocked(InviteOutcome outcome, OffsetDateTime nextAllowedAt) {
        if (!outcome.carriesNextAllowedAt()) {
            throw new IllegalArgumentException("Outcome does not carry a nextAllowedAt: " + outcome);
        }
        return new InviteAttempt(outcome, nextAllowedAt);
    }
}
