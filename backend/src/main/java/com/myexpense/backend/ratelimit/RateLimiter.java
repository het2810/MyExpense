package com.myexpense.backend.ratelimit;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * A minimal, in-memory, continuously-refilling token-bucket rate limiter.
 *
 * <p>Chosen over a library (e.g. Bucket4j) per constitution §21's dependency
 * checklist: Phase 1 is a single-instance deployment
 * (security-architecture.md §11 frames exactly this as an acceptable Phase 1
 * starting point), the token-bucket algorithm itself is a handful of lines,
 * and this class has no dependency beyond the JDK. It does not coordinate
 * across multiple backend instances — flagged explicitly in the handoff
 * report as a known limitation to revisit (e.g. with Bucket4j + Redis) if
 * this backend is ever horizontally scaled.
 *
 * <p>Buckets are never evicted — a long-running process will accumulate one
 * entry per distinct key (IP+path, or email+operation) seen. Acceptable for
 * Phase 1's expected traffic volume; flagged as a follow-up (e.g. a
 * scheduled sweep of stale entries) if it ever becomes a real memory
 * concern.
 */
@Component
public class RateLimiter {

    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    /**
     * Attempts to consume one token from the bucket identified by
     * {@code key}, creating it (full) on first use.
     *
     * @param key           uniquely identifies what is being limited (e.g.
     *                      {@code "ip:203.0.113.4:/api/v1/auth/login"})
     * @param capacity      maximum tokens the bucket can hold (the burst
     *                      allowance)
     * @param refillWindow  time to refill the bucket from empty to full,
     *                      spread continuously rather than all at once
     * @return {@code true} if a token was available and consumed,
     *         {@code false} if the caller should be rejected
     */
    public boolean tryConsume(String key, int capacity, Duration refillWindow) {
        Bucket bucket = buckets.computeIfAbsent(key, k -> new Bucket(capacity));
        return bucket.tryConsume(capacity, refillWindow);
    }

    private static final class Bucket {

        private double tokens;
        private Instant lastRefill;

        private Bucket(int capacity) {
            this.tokens = capacity;
            this.lastRefill = Instant.now();
        }

        synchronized boolean tryConsume(int capacity, Duration refillWindow) {
            refill(capacity, refillWindow);
            if (tokens >= 1.0) {
                tokens -= 1.0;
                return true;
            }
            return false;
        }

        private void refill(int capacity, Duration refillWindow) {
            Instant now = Instant.now();
            long elapsedMillis = Duration.between(lastRefill, now).toMillis();
            if (elapsedMillis <= 0) {
                return;
            }
            double refillRatePerMilli = (double) capacity / refillWindow.toMillis();
            tokens = Math.min(capacity, tokens + (elapsedMillis * refillRatePerMilli));
            lastRefill = now;
        }
    }
}
