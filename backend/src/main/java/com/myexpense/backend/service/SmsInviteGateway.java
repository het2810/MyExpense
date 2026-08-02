package com.myexpense.backend.service;

/**
 * Outbound transactional SMS for the phone-invite feature (ADR 0015).
 *
 * <p><strong>No SMS provider has been selected, and selecting one is NOT part of
 * this sub-step.</strong> ADR 0015 §5 approved "a transactional SMS provider" in
 * principle and deferred the vendor choice to the Backend Engineer "at
 * implementation time" — but a real gateway is a <em>new external
 * dependency</em>, and constitution §21 clearance plus the credential handling
 * security-architecture.md §6/§8 requires both go through the System Architect
 * and the Project Owner, not through this interface. Until that happens the
 * attempt is <strong>recorded</strong> and the send is left behind this
 * interface, exactly as {@link EmailService}/{@link LoggingEmailService} already
 * do for email. See {@link LoggingSmsInviteGateway} for the stub actually wired
 * in, and backend/README.md §15 for what is owed before a real one lands.
 *
 * <p><strong>One method, and it takes only the destination number.</strong> The
 * message body — including the app-download link — is a configuration value
 * (ADR 0015 §6), so it belongs to the implementation rather than to every
 * caller. Keeping the inviter's name out of the signature is also deliberate:
 * nothing in the contract requires it, and it would put a real person's name
 * into a third-party payload for no stated benefit. The <em>only</em> personal
 * datum that crosses this boundary is the number being texted, which is
 * unavoidable.
 *
 * <p><strong>Implementations must not throw to signal a failed send</strong> —
 * return {@link SmsDispatchResult#failed()} instead. A delivery failure must
 * never fail the parent {@code POST /contacts}/{@code POST /groups/{id}/members}
 * request (ADR 0015 §4: "a contact must never fail to be created merely because
 * a downstream SMS provider had a bad moment").
 * {@code ContactInviteService} nonetheless catches {@link RuntimeException} from
 * this call and treats it as a failure, because a third-party client library is
 * not something to take on trust.
 *
 * <p><strong>Implementations must never log the full destination number, the
 * provider's API key, or any account credential</strong> (constitution §23,
 * security-architecture.md §8).
 */
public interface SmsInviteGateway {

    /**
     * Attempts to send one app-download invite.
     *
     * @param toPhone the recipient's number in E.164 form, never {@code null}
     *                and never blank — the caller has already resolved and
     *                validated it (a blank value is
     *                {@code 400 NO_PHONE_ON_CONTACT} long before here)
     * @return {@link SmsDispatchResult#dispatched(java.time.OffsetDateTime)} with
     *         the gateway's own accept time, or
     *         {@link SmsDispatchResult#failed()}
     */
    SmsDispatchResult sendAppDownloadInvite(String toPhone);
}
