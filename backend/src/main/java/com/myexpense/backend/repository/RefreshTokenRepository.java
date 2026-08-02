package com.myexpense.backend.repository;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.RefreshToken;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    Optional<RefreshToken> findByTokenHash(String tokenHash);

    /**
     * Revokes every still-active (not yet revoked) token in a family in one
     * statement — the reuse-detection response
     * (docs/architecture/authentication.md §2).
     */
    @Modifying
    @Query("update RefreshToken r set r.revokedAt = :revokedAt "
            + "where r.familyId = :familyId and r.revokedAt is null")
    int revokeAllActiveInFamily(@Param("familyId") UUID familyId, @Param("revokedAt") OffsetDateTime revokedAt);

    /**
     * Revokes every still-active token belonging to a user, regardless of
     * family — the required side effect of a successful password reset
     * (docs/api/authentication-api.md §6).
     */
    @Modifying
    @Query("update RefreshToken r set r.revokedAt = :revokedAt "
            + "where r.userId = :userId and r.revokedAt is null")
    int revokeAllActiveForUser(@Param("userId") UUID userId, @Param("revokedAt") OffsetDateTime revokedAt);
}
