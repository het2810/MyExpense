package com.myexpense.backend.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/**
 * Hashing/generation helper shared by refresh tokens and verification
 * tokens (docs/architecture/data-model.md §1.3/§1.4 — {@code token_hash},
 * "never store the raw token").
 *
 * <p>Deliberately SHA-256, not BCrypt. BCrypt is the right choice for
 * passwords specifically because passwords are low-entropy and reused
 * across sites, so a slow, salted hash is needed to resist offline
 * brute-forcing. These tokens are the opposite: 256 bits of
 * {@link SecureRandom} output, high enough entropy that a fast hash is
 * already effectively unguessable, and a fast, deterministic hash is
 * required anyway so the token can be looked up with a direct
 * {@code WHERE token_hash = ?} query (a per-call-salted hash like BCrypt
 * cannot support that lookup pattern at all).
 */
public final class TokenHasher {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private TokenHasher() {
    }

    /** Generates a new 256-bit opaque token, URL-safe base64 encoded. */
    public static String generateOpaqueToken() {
        byte[] randomBytes = new byte[32];
        SECURE_RANDOM.nextBytes(randomBytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
    }

    /** Hex-encoded SHA-256 digest of the given raw token value. */
    public static String sha256Hex(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(rawToken.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is a mandatory JDK algorithm; this branch is unreachable
            // on any conformant JVM.
            throw new IllegalStateException("SHA-256 algorithm unavailable", e);
        }
    }
}
