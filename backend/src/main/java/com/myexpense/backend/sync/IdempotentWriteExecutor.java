package com.myexpense.backend.sync;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;

import org.hibernate.exception.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.exception.IdempotencyKeyReusedException;
import com.myexpense.backend.repository.ChangeLogRepository;

/**
 * ADR 0027 §4.3, the transaction boundary of every logged write:
 *
 * <pre>
 * begin
 *   key recorded for caller?  -> mismatch: 409 IDEMPOTENCY_KEY_REUSED
 *                             -> match: REPLAY (write nothing)
 *   perform the write (+ change_log row, activity, notification — same tx)
 * commit
 * on 23505 of uq_change_log_user_idempotency_key or a target *_pkey:
 *   rollback, re-run once in a NEW transaction (now a replay)
 * </pre>
 *
 * <p><strong>Callers must not be {@code @Transactional} themselves.</strong> The
 * retry needs the first transaction to have ended; inside an outer transaction
 * the template would join it and the retry would run in a rolled-back session.
 *
 * <p>The superseded outcome is a {@link WriteResult} value, not an exception, so
 * this transaction commits its log rows; the controller maps it to {@code 409}.
 */
@Component
public class IdempotentWriteExecutor {

    private static final Logger log = LoggerFactory.getLogger(IdempotentWriteExecutor.class);

    /** V18 contract item 3: this name maps to the replay branch, never a bare 409/500. */
    static final String IDEMPOTENCY_CONSTRAINT = "uq_change_log_user_idempotency_key";

    /** PostgreSQL's default primary-key constraint suffix, e.g. {@code transactions_pkey}. */
    private static final String PRIMARY_KEY_SUFFIX = "_pkey";

    /** Explicitly named primary keys in this schema, e.g. {@code pk_user_settings} (V2). */
    private static final String PRIMARY_KEY_PREFIX = "pk_";

    private final TransactionTemplate transactionTemplate;
    private final ChangeLogRepository changeLogRepository;

    public IdempotentWriteExecutor(PlatformTransactionManager transactionManager,
            ChangeLogRepository changeLogRepository) {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.changeLogRepository = changeLogRepository;
    }

    /**
     * What a recorded key must agree with to count as the same action.
     *
     * @param entityId {@code null} when the request names no entity id (a create
     *                 without a client id); then only type and operation compare
     */
    public record ReplayMatch(String entityType, Set<String> operations, UUID entityId) {

        public static ReplayMatch of(String entityType, String operation, UUID entityId) {
            return new ReplayMatch(entityType, Set.of(operation), entityId);
        }

        public boolean matches(ChangeLog row) {
            return entityType.equals(row.getEntityType())
                    && operations.contains(row.getOperation())
                    && (entityId == null || entityId.equals(row.getEntityId()));
        }
    }

    public <T> WriteResult<T> execute(UUID userId, WriteContext context, ReplayMatch match,
            Function<ChangeLog, WriteResult<T>> replay, Supplier<WriteResult<T>> write) {
        try {
            return transactionTemplate.execute(status -> attempt(userId, context, match, replay, write));
        } catch (RuntimeException ex) {
            if (!isReplayableRace(ex)) {
                throw ex;
            }
            // Ids only — never the key or device id values.
            log.info("Concurrent duplicate write for user {} ({}); re-running as a replay",
                    userId, match.entityType());
            return transactionTemplate.execute(status -> attempt(userId, context, match, replay, write));
        }
    }

    private <T> WriteResult<T> attempt(UUID userId, WriteContext context, ReplayMatch match,
            Function<ChangeLog, WriteResult<T>> replay, Supplier<WriteResult<T>> write) {
        if (context.idempotencyKey() != null) {
            ChangeLog recorded = changeLogRepository
                    .findByUserIdAndIdempotencyKey(userId, context.idempotencyKey())
                    .orElse(null);
            if (recorded != null) {
                if (!match.matches(recorded)) {
                    throw new IdempotencyKeyReusedException();
                }
                return replay.apply(recorded);
            }
        }
        return write.get();
    }

    /** Null-safe walk of the cause chain, matching full constraint names only. */
    static boolean isReplayableRace(Throwable ex) {
        for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException violation && violation.getConstraintName() != null) {
                String name = violation.getConstraintName().toLowerCase(Locale.ROOT);
                return name.equals(IDEMPOTENCY_CONSTRAINT)
                        || name.endsWith(PRIMARY_KEY_SUFFIX)
                        || name.startsWith(PRIMARY_KEY_PREFIX);
            }
        }
        return false;
    }
}
