package com.myexpense.backend.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import com.myexpense.backend.entity.UserSettings;

import jakarta.persistence.LockModeType;

/**
 * Persistence only. The key is the owning user's id ({@code user_settings}
 * is keyed by {@code user_id}), so {@code findById(userId)} is already the
 * owner-scoped lookup — no separate {@code findByUserId} is needed, and no
 * query here can be reached with an id the caller didn't authenticate as
 * (the id always comes from the JWT principal, never from the request).
 */
public interface UserSettingsRepository extends JpaRepository<UserSettings, UUID> {

    /**
     * {@code PATCH /users/me/settings}' write-locked read (ADR 0027 §5.2), so the
     * LWW compare-then-write cannot interleave with a concurrent PATCH.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<UserSettings> findForUpdateByUserId(UUID userId);
}
