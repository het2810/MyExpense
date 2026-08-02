package com.myexpense.backend.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.Repository;

import com.myexpense.backend.entity.ChangeLog;

/**
 * Persistence only, for {@code change_log} (ADR 0027 §6, V18 contract item 2).
 *
 * <p>Extends the bare {@link Repository} marker rather than
 * {@code JpaRepository} on purpose: rows are immutable and never deleted
 * (ADR 0024), so no {@code save}, {@code delete*} or update method is inherited.
 * Inserts go through {@link EntityInserter}. Every read is owner-scoped by
 * {@code userId}; derived queries only, all parameters bound.
 */
public interface ChangeLogRepository extends Repository<ChangeLog, UUID> {

    /** The replay lookup (ADR 0027 §4.3), served by {@code uq_change_log_user_idempotency_key}. */
    Optional<ChangeLog> findByUserIdAndIdempotencyKey(UUID userId, UUID idempotencyKey);

    /** {@code GET /change-log/{id}} — owner-scoped. */
    Optional<ChangeLog> findByIdAndUserId(UUID id, UUID userId);

    /** {@code GET /change-log} unfiltered — {@code idx_change_log_user_created_at}. */
    Page<ChangeLog> findByUserIdOrderByCreatedAtDescIdDesc(UUID userId, Pageable pageable);

    /** {@code GET /change-log?entityType=&entityId=} — {@code idx_change_log_user_entity}. */
    Page<ChangeLog> findByUserIdAndEntityTypeAndEntityIdOrderByCreatedAtDescIdDesc(
            UUID userId, String entityType, UUID entityId, Pageable pageable);

    /**
     * The latest applied row for one entity — the {@code superseded_by} link of a
     * superseded row (ADR 0027 §6.2). Empty when the winner was an unlogged
     * legacy write.
     */
    Optional<ChangeLog> findFirstByUserIdAndEntityTypeAndEntityIdAndOutcomeOrderByCreatedAtDescIdDesc(
            UUID userId, String entityType, UUID entityId, String outcome);
}
