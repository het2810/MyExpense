package com.myexpense.backend.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.Getter;
import lombok.Setter;

/**
 * Time-to-live for {@code verification_tokens} rows, per token type
 * (docs/architecture/data-model.md §1.4). Not pinned by any of the approved
 * docs to an exact number — a password-reset token is deliberately
 * shorter-lived than an email-verification token, following common
 * practice; flagged in the handoff report as an assumption the System
 * Architect may want to confirm/tune.
 */
@ConfigurationProperties(prefix = "app.security.verification")
@Getter
@Setter
public class VerificationTokenProperties {

    private int passwordResetTtlMinutes = 60;
    private int emailVerificationTtlHours = 24;

    public Duration getPasswordResetTtl() {
        return Duration.ofMinutes(passwordResetTtlMinutes);
    }

    public Duration getEmailVerificationTtl() {
        return Duration.ofHours(emailVerificationTtlHours);
    }
}
