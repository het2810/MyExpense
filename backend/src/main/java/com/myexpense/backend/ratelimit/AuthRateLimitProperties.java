package com.myexpense.backend.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Rate-limit tiers for {@code /api/v1/auth/**} (security-architecture.md
 * §1/§11 — the strict tier). {@code ip} applies to every one of the 8
 * endpoints, keyed by client IP + path. The per-account tiers below apply
 * additionally to the endpoints that carry an email in the request body,
 * keyed by that email — the docs call these out by name as "the endpoints
 * an attacker would automate against". Values are operational tuning
 * defaults (the same "starting point, not an immutable number" framing
 * security-architecture.md §5/§11 already uses for lockout parameters),
 * overridable via {@code application.properties}.
 */
@ConfigurationProperties(prefix = "app.ratelimit.auth")
@Getter
@Setter
public class AuthRateLimitProperties {

    private Tier ip = new Tier(20, 60);
    private Tier login = new Tier(5, 900);
    private Tier register = new Tier(5, 3600);
    private Tier forgotPassword = new Tier(3, 900);
    private Tier resendVerification = new Tier(3, 900);

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Tier {
        private int capacity;
        private int windowSeconds;
    }
}
