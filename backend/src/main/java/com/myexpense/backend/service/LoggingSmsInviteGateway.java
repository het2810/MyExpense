package com.myexpense.backend.service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.myexpense.backend.config.ContactInviteProperties;

/**
 * Deliberate Phase 1 stub — logs that an invite <em>would</em> have been sent,
 * prefixed {@code [DEV SMS STUB]} so it can be read straight out of the
 * application log for manual testing (backend/README.md §15), and reports
 * success so the rest of the invite path (the ledger row, the cooldown, the
 * {@code sent} status) is genuinely exercised.
 *
 * <p><strong>This is a flagged, deliberate simplification, not a gap.</strong> No
 * SMS provider has been evaluated or approved, and picking one here would be an
 * unapproved-dependency decision outside this task's scope — constitution §21
 * clearance for a real external service belongs to the System Architect, and its
 * credentials would be secrets under security-architecture.md §6. Swap this bean
 * out for a provider-backed {@link SmsInviteGateway} later without touching any
 * caller. The same pattern, for the same reason,
 * as {@link LoggingEmailService}.
 *
 * <h2>Reporting success is the right default for a stub, and it is a choice</h2>
 *
 * <p>Returning {@link SmsDispatchResult#failed()} would leave every invite row
 * at {@code status='failed'} with a {@code null} {@code sent_at}, which means
 * <strong>no cooldown would ever start</strong> — so the per-phone limit, the
 * single most abuse-sensitive rule in the API, would be untestable and would
 * look permissive in exactly the way a real deployment must not. Reporting a
 * dispatch exercises it. The cost is that a {@code 'failed'} outcome cannot be
 * produced from the outside today; backend/README.md §15 records how to force
 * one (throw from this method locally) and lists it as not statically verified.
 *
 * <h2>What is NOT logged</h2>
 *
 * <p><strong>Never the full phone number.</strong> It is masked to its last four
 * digits, and that is a real departure from {@link LoggingEmailService}, which
 * logs the whole address — justified rather than inconsistent for once: that
 * stub <em>must</em> print a verification token because the token's entire
 * purpose is to reach the user, and the address is needed to tell two test
 * accounts apart. Here there is no token, nothing in the message is
 * user-specific, and {@code UserService} already establishes in this codebase
 * that "a phone number is personal data" and logs only field names
 * (constitution §23). Four digits are enough to confirm which contact was
 * invited during a manual test.
 */
@Service
public class LoggingSmsInviteGateway implements SmsInviteGateway {

    private static final Logger log = LoggerFactory.getLogger(LoggingSmsInviteGateway.class);

    /** How many trailing digits of the destination number survive masking. */
    private static final int VISIBLE_DIGITS = 4;

    private final ContactInviteProperties properties;

    public LoggingSmsInviteGateway(ContactInviteProperties properties) {
        this.properties = properties;
    }

    @Override
    public SmsDispatchResult sendAppDownloadInvite(String toPhone) {
        // UTC, matching every other timestamp this backend generates
        // (spring.jpa.properties.hibernate.jdbc.time_zone=UTC). A real gateway
        // would report its own accept time instead, which is why the value
        // travels back in the result rather than being read by the caller.
        OffsetDateTime dispatchedAt = OffsetDateTime.now(ZoneOffset.UTC);
        log.info("[DEV SMS STUB] Invite SMS would be sent to {} with download link {} at {}",
                mask(toPhone), properties.getAppDownloadLink(), dispatchedAt);
        return SmsDispatchResult.dispatched(dispatchedAt);
    }

    /**
     * {@code "+919876543210"} → {@code "****3210"}. Deliberately drops the
     * country code too: keeping it would narrow a masked number to a country,
     * and nothing in a developer's workflow needs that.
     */
    private static String mask(String phone) {
        if (phone == null || phone.length() <= VISIBLE_DIGITS) {
            return "****";
        }
        return "****" + phone.substring(phone.length() - VISIBLE_DIGITS);
    }
}
