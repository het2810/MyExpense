package com.myexpense.backend.entity;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * Maps to {@code change_log} ({@code V18__offline_sync_change_log.sql},
 * ADR 0027 §6.2): the structured record of every client-authored write.
 *
 * <p><strong>Immutable.</strong> Every column is {@code updatable = false}, there
 * are no setters, and {@code ChangeLogRepository} exposes no update or delete
 * method (ADR 0024). {@code updated_at} equals {@code created_at} forever; both
 * are set by the writer because the database maintains neither.
 *
 * <p>The id is application-assigned (the project convention) and never
 * client-supplied. Rows are inserted with {@code EntityManager.persist} only.
 *
 * <p>{@link #changes} is a JSON array of {@code {"field","before","after"}},
 * computed server-side, already serialized. It is financial data and is
 * <strong>never written to an application log</strong>
 * (security-architecture.md §8).
 */
@Entity
@Table(name = "change_log")
@Getter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class ChangeLog {

    public static final String OPERATION_CREATE = "create";
    public static final String OPERATION_UPDATE = "update";
    public static final String OPERATION_DELETE = "delete";

    public static final String OUTCOME_APPLIED = "applied";
    public static final String OUTCOME_SUPERSEDED = "superseded";

    public static final String REASON_NEWER_WRITE = "newer_write";
    public static final String REASON_DELETED = "deleted";

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** The actor. */
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "entity_type", nullable = false, updatable = false, length = 30)
    private String entityType;

    /** Polymorphic, no FK. For {@code user_settings} it is the user's id. */
    @Column(name = "entity_id", nullable = false, updatable = false)
    private UUID entityId;

    @Column(name = "operation", nullable = false, updatable = false, length = 10)
    private String operation;

    @Column(name = "outcome", nullable = false, updatable = false, length = 12)
    private String outcome;

    @Column(name = "superseded_reason", updatable = false, length = 20)
    private String supersededReason;

    @Column(name = "superseded_by_change_log_id", updatable = false)
    private UUID supersededByChangeLogId;

    /**
     * JSONB. Hibernate's built-in JSON mapping, as the V18 contract asks; a plain
     * String bind without it fails with {@code 42804}.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "changes", nullable = false, updatable = false)
    private String changes;

    /** Set on the primary row of a request only (ADR 0027 §6.3). */
    @Column(name = "idempotency_key", updatable = false)
    private UUID idempotencyKey;

    @Column(name = "origin", nullable = false, updatable = false, length = 10)
    private String origin;

    @Column(name = "device_id", updatable = false)
    private UUID deviceId;

    /** {@code X-Client-Updated-At} as reported, unclamped. */
    @Column(name = "client_updated_at", updatable = false)
    private OffsetDateTime clientUpdatedAt;

    /** The LWW timestamp actually used (ADR 0027 §5.2). */
    @Column(name = "effective_write_at", nullable = false, updatable = false)
    private OffsetDateTime effectiveWriteAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false, updatable = false)
    private OffsetDateTime updatedAt;
}
