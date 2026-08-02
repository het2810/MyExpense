package com.myexpense.backend.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The <strong>default tier</strong> of security-architecture.md §11: a
 * per-authenticated-user limit covering every ordinary authenticated endpoint
 * under {@code /api/v1/**} that is not {@code /api/v1/auth/**} (which keeps
 * its own, much stricter tier — see {@link AuthRateLimitProperties}).
 *
 * <p>Keyed by principal rather than IP on purpose: one user legitimately
 * moves between mobile data and Wi-Fi, and a NAT'd network shouldn't throttle
 * unrelated users together. The budget is shared across all of a user's
 * endpoints rather than being per-path, so a client cannot multiply its
 * allowance by spreading calls around.
 *
 * <p>120 requests / 60 seconds is the middle of §11's suggested 60–120
 * starting range — generous for a mobile client that batches its reads, tight
 * enough to stop a runaway loop. An operational tuning knob, not a
 * correctness-critical number; override via {@code application.properties}.
 *
 * <p>The {@code Tier} shape is duplicated rather than shared with
 * {@code AuthRateLimitProperties} — two occurrences is "acceptable" under
 * constitution §25, and extracting a common type would mean editing Domain
 * 1's already-verified property binding for no behavioural gain. Worth
 * revisiting if a third tier appears.
 */
@ConfigurationProperties(prefix = "app.ratelimit.api")
@Getter
@Setter
public class ApiRateLimitProperties {

    private Tier user = new Tier(120, 60);

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Tier {
        private int capacity;
        private int windowSeconds;
    }
}
