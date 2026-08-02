package com.myexpense.backend.security;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import javax.crypto.SecretKey;

import org.springframework.stereotype.Component;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

/**
 * Issues and validates the short-lived JWT access token
 * (docs/architecture/authentication.md §1/§4). Claims are limited to what
 * authorization checks need — principal id and roles — no PII, no financial
 * data (security-architecture.md §1).
 */
@Component
public class JwtTokenProvider {

    private static final String ROLES_CLAIM = "roles";

    private final SecretKey signingKey;
    private final long accessTokenTtlSeconds;

    public JwtTokenProvider(JwtProperties jwtProperties) {
        this.signingKey = Keys.hmacShaKeyFor(jwtProperties.getSecret().getBytes(StandardCharsets.UTF_8));
        this.accessTokenTtlSeconds = jwtProperties.getAccessTokenTtlSeconds();
    }

    public long getAccessTokenTtlSeconds() {
        return accessTokenTtlSeconds;
    }

    public String generateAccessToken(UUID userId, List<String> roles) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId.toString())
                .claim(ROLES_CLAIM, roles)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(accessTokenTtlSeconds)))
                .signWith(signingKey)
                .compact();
    }

    /**
     * Parses and validates an access token's signature and expiry.
     *
     * @throws io.jsonwebtoken.JwtException if the token is malformed,
     *         expired, or fails signature verification
     */
    public AccessTokenClaims parseAndValidate(String token) {
        Jws<Claims> jws = Jwts.parser()
                .verifyWith(signingKey)
                .build()
                .parseSignedClaims(token);
        Claims claims = jws.getPayload();
        UUID userId = UUID.fromString(claims.getSubject());
        @SuppressWarnings("unchecked")
        List<String> roles = claims.get(ROLES_CLAIM, List.class);
        return new AccessTokenClaims(userId, roles);
    }

    public record AccessTokenClaims(UUID userId, List<String> roles) {
    }
}
