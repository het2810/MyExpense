package com.myexpense.backend.service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.entity.VerificationToken;
import com.myexpense.backend.entity.VerificationTokenType;
import com.myexpense.backend.exception.InvalidOrExpiredTokenException;
import com.myexpense.backend.repository.VerificationTokenRepository;
import com.myexpense.backend.security.TokenHasher;

/**
 * Issuance and single-use consumption of {@code verification_tokens} rows,
 * shared by the password-reset and email-verification flows
 * (docs/architecture/data-model.md §1.4).
 */
@Service
public class VerificationTokenService {

    private final VerificationTokenRepository verificationTokenRepository;

    public VerificationTokenService(VerificationTokenRepository verificationTokenRepository) {
        this.verificationTokenRepository = verificationTokenRepository;
    }

    /** Issues a new token and returns the raw (unhashed) value to embed in the outbound email. */
    @Transactional
    public String issue(UUID userId, VerificationTokenType type, Duration ttl) {
        String rawToken = TokenHasher.generateOpaqueToken();

        VerificationToken entity = VerificationToken.builder()
                .id(UUID.randomUUID())
                .userId(userId)
                .tokenType(type)
                .tokenHash(TokenHasher.sha256Hex(rawToken))
                .expiresAt(OffsetDateTime.now(ZoneOffset.UTC).plus(ttl))
                .build();
        verificationTokenRepository.save(entity);

        return rawToken;
    }

    /**
     * Validates and consumes (marks used) a token in one step. Throws the
     * same generic {@link InvalidOrExpiredTokenException} whether the token
     * is missing, of the wrong type, already used, or expired — the caller
     * (and therefore the client) never learns which specific condition
     * applied.
     */
    @Transactional
    public VerificationToken consume(String rawToken, VerificationTokenType expectedType) {
        String hash = TokenHasher.sha256Hex(rawToken);
        VerificationToken token = verificationTokenRepository.findByTokenHash(hash)
                .orElseThrow(InvalidOrExpiredTokenException::new);

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        boolean wrongType = token.getTokenType() != expectedType;
        boolean alreadyUsed = token.getUsedAt() != null;
        boolean expired = token.getExpiresAt().isBefore(now);
        if (wrongType || alreadyUsed || expired) {
            throw new InvalidOrExpiredTokenException();
        }

        token.setUsedAt(now);
        verificationTokenRepository.save(token);
        return token;
    }
}
