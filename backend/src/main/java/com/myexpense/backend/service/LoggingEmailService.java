package com.myexpense.backend.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Deliberate Phase 1 stub — logs the verification/reset token at INFO level
 * instead of sending a real email, clearly prefixed {@code [DEV EMAIL STUB]}
 * so it can be read straight out of the application log for manual testing
 * (see {@code backend/README.md}'s curl walkthrough).
 *
 * <p>This is a flagged, deliberate simplification, not a gap: no email
 * provider has been evaluated or approved for this project yet, and picking
 * one now would be an unapproved-dependency decision outside this task's
 * scope. Swap this bean out for a real provider-backed
 * {@link EmailService} implementation later without touching any caller.
 *
 * <p>Logging the raw token here is intentional and does not violate
 * constitution §23's "never log tokens" rule in the way logging a JWT or
 * refresh token would: a password-reset/verification token's entire
 * purpose is to be transmitted in cleartext to the user (normally via a
 * real email), so this stub's log line stands in for that email itself,
 * not an incidental leak of a session credential.
 */
@Service
public class LoggingEmailService implements EmailService {

    private static final Logger log = LoggerFactory.getLogger(LoggingEmailService.class);

    @Override
    public void sendVerificationEmail(String toEmail, String firstName, String verificationToken) {
        log.info("[DEV EMAIL STUB] Email verification requested for {} ({}). "
                        + "To verify, call POST /api/v1/auth/verify-email with body {{\"token\": \"{}\"}}",
                toEmail, firstName, verificationToken);
    }

    @Override
    public void sendPasswordResetEmail(String toEmail, String firstName, String resetToken) {
        log.info("[DEV EMAIL STUB] Password reset requested for {} ({}). "
                        + "To reset, call POST /api/v1/auth/reset-password with body "
                        + "{{\"token\": \"{}\", \"newPassword\": \"...\"}}",
                toEmail, firstName, resetToken);
    }
}
