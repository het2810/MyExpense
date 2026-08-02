package com.myexpense.backend.repository;

import org.springframework.stereotype.Repository;

import jakarta.persistence.EntityManager;

/**
 * <strong>INSERT-only persistence for entities with an application-assigned id</strong>
 * (ADR 0027 §3.3, security-architecture.md §9).
 *
 * <p>Spring Data's {@code save()} on an entity with an assigned {@code @Id}
 * performs a <em>merge</em>: it SELECTs by id and UPDATEs a row that already
 * exists. With a client-supplied id that collides with another user's row,
 * {@code save()} would silently overwrite that user's data. Every create path
 * that accepts a client id therefore inserts through this class, which calls
 * {@link EntityManager#persist} and never merges: a colliding id fails with a
 * primary-key violation instead of overwriting.
 *
 * <p>A {@code @Repository} so Spring's exception translation turns a constraint
 * violation into {@code DataIntegrityViolationException}, which the callers'
 * existing translators already handle.
 */
@Repository
public class EntityInserter {

    private final EntityManager entityManager;

    public EntityInserter(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    /**
     * Persists {@code entity} as a new row and flushes, so a violation surfaces
     * here rather than at commit.
     */
    public <T> T insert(T entity) {
        entityManager.persist(entity);
        entityManager.flush();
        return entity;
    }
}
