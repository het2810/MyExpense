package com.myexpense.backend.service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.entity.RefreshToken;
import com.myexpense.backend.exception.InvalidRefreshTokenException;
import com.myexpense.backend.exception.RefreshTokenReuseDetectedException;
import com.myexpense.backend.repository.RefreshTokenRepository;
import com.myexpense.backend.security.JwtProperties;
import com.myexpense.backend.security.TokenHasher;

/**
 * Issuance, rotation, and revocation of opaque refresh tokens
 * (docs/architecture/authentication.md §1/§2, docs/architecture/data-model.md
 * §1.3). Only this class touches {@code refresh_tokens} — callers deal in
 * raw token strings and {@link UUID} user ids, never the entity directly.
 */
@Service
public class RefreshTokenService {

    private final RefreshTokenRepository refreshTokenRepository;
    private final int refreshTokenTtlDays;

    public RefreshTokenService(RefreshTokenRepository refreshTokenRepository, JwtProperties jwtProperties) {
        this.refreshTokenRepository = refreshTokenRepository;
        this.refreshTokenTtlDays = jwtProperties.getRefreshTokenTtlDays();
    }

    /** Starts a brand new token family — used on a fresh login. */
    @Transactional
    public IssuedToken issueNewFamily(UUID userId) {
        return issue(userId, UUID.randomUUID());
    }

    /**
     * Validates and rotates a refresh token.
     *
     * <ul>
     *   <li>Not found → {@link InvalidRefreshTokenException}.</li>
     *   <li>Found but already revoked/rotated (reuse) → the entire family is
     *       revoked and {@link RefreshTokenReuseDetectedException} is
     *       thrown (docs/architecture/authentication.md §2).</li>
     *   <li>Found, not revoked, but expired → marked revoked and
     *       {@link InvalidRefreshTokenException} is thrown.</li>
     *   <li>Otherwise → the presented token is revoked and a new one is
     *       issued in the same family.</li>
     * </ul>
     */
    // noRollbackFor: both exceptions below are thrown *after* a deliberate,
    // must-persist revocation. ApiException extends RuntimeException, so
    // Spring's default rollback rule would otherwise undo the very revocation
    // that the exception is reporting — leaving a replayed token's family
    // still usable (docs/architecture/authentication.md §2).
    @Transactional(noRollbackFor = { RefreshTokenReuseDetectedException.class, InvalidRefreshTokenException.class })
    public RotationResult rotate(String rawToken) {
        String hash = TokenHasher.sha256Hex(rawToken);
        RefreshToken existing = refreshTokenRepository.findByTokenHash(hash)
                .orElseThrow(InvalidRefreshTokenException::new);

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

        if (existing.getRevokedAt() != null) {
            refreshTokenRepository.revokeAllActiveInFamily(existing.getFamilyId(), now);
            throw new RefreshTokenReuseDetectedException();
        }

        if (existing.getExpiresAt().isBefore(now)) {
            existing.setRevokedAt(now);
            refreshTokenRepository.save(existing);
            throw new InvalidRefreshTokenException();
        }

        existing.setRevokedAt(now);
        refreshTokenRepository.save(existing);

        IssuedToken next = issue(existing.getUserId(), existing.getFamilyId());
        return new RotationResult(existing.getUserId(), next);
    }

    /**
     * Revokes a token on logout, but only if it both exists and belongs to
     * the authenticated caller — a defensive check beyond the contract,
     * since a client-supplied {@code refreshToken} should never be able to
     * act outside the caller's own scope (security-architecture.md §2).
     * Silently a no-op otherwise; logout is idempotent from the client's
     * perspective either way (authentication-api.md §4).
     */
    @Transactional
    public void revokeForUserIfOwned(UUID authenticatedUserId, String rawToken) {
        String hash = TokenHasher.sha256Hex(rawToken);
        refreshTokenRepository.findByTokenHash(hash).ifPresent(token -> {
            if (token.getUserId().equals(authenticatedUserId) && token.getRevokedAt() == null) {
                token.setRevokedAt(OffsetDateTime.now(ZoneOffset.UTC));
                refreshTokenRepository.save(token);
            }
        });
    }

    /** Revokes every active token for a user — the reset-password side effect (authentication-api.md §6). */
    @Transactional
    public void revokeAllForUser(UUID userId) {
        refreshTokenRepository.revokeAllActiveForUser(userId, OffsetDateTime.now(ZoneOffset.UTC));
    }

    private IssuedToken issue(UUID userId, UUID familyId) {
        String rawToken = TokenHasher.generateOpaqueToken();
        OffsetDateTime expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plusDays(refreshTokenTtlDays);

        RefreshToken entity = RefreshToken.builder()
                .id(UUID.randomUUID())
                .userId(userId)
                .tokenHash(TokenHasher.sha256Hex(rawToken))
                .familyId(familyId)
                .expiresAt(expiresAt)
                .build();
        refreshTokenRepository.save(entity);

        return new IssuedToken(rawToken, familyId, expiresAt);
    }

    public record IssuedToken(String rawToken, UUID familyId, OffsetDateTime expiresAt) {
    }

    public record RotationResult(UUID userId, IssuedToken issuedToken) {
    }
}
