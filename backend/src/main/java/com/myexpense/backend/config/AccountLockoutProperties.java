package com.myexpense.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.Getter;
import lombok.Setter;

/**
 * Account lockout policy (security-architecture.md §5). Defaults match the
 * document's own recommended starting point: 5 consecutive failures, a flat
 * 15-minute lockout, no backoff escalation — explicitly framed there as an
 * operational tuning knob, not an immutable number.
 */
@ConfigurationProperties(prefix = "app.security.lockout")
@Getter
@Setter
public class AccountLockoutProperties {

    private int maxAttempts = 5;
    private int durationMinutes = 15;
}
