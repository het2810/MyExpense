package com.myexpense.backend.service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.entity.Notification;
import com.myexpense.backend.repository.ActivityRepository;
import com.myexpense.backend.repository.ChangeLogRepository;
import com.myexpense.backend.repository.EntityInserter;
import com.myexpense.backend.repository.NotificationRepository;
import com.myexpense.backend.sync.FieldChange;
import com.myexpense.backend.sync.WriteContext;

import tools.jackson.databind.ObjectMapper;

/**
 * BE-2: writes {@code change_log} rows and the actor's activity / notification
 * that explain them (ADR 0027 §6.3/§6.4), always <strong>inside the write's own
 * transaction</strong> ({@code MANDATORY}) so the log commits with the write.
 *
 * <p>Never logs {@code changes}, the request body, the idempotency key or the
 * device id (security-architecture.md §8).
 */
@Service
public class ChangeLogWriter {

    private final EntityInserter entityInserter;
    private final ChangeLogRepository changeLogRepository;
    private final ActivityRepository activityRepository;
    private final NotificationRepository notificationRepository;
    private final ObjectMapper objectMapper;

    public ChangeLogWriter(
            EntityInserter entityInserter,
            ChangeLogRepository changeLogRepository,
            ActivityRepository activityRepository,
            NotificationRepository notificationRepository,
            ObjectMapper objectMapper) {
        this.entityInserter = entityInserter;
        this.changeLogRepository = changeLogRepository;
        this.activityRepository = activityRepository;
        this.notificationRepository = notificationRepository;
        this.objectMapper = objectMapper;
    }

    /** The four navigation links an activity row may carry. */
    public record Related(UUID transactionId, UUID groupId, UUID contactId, UUID splitExpenseId) {
        public static final Related NONE = new Related(null, null, null, null);

        public static Related transaction(UUID id) {
            return new Related(id, null, null, null);
        }

        public static Related group(UUID id) {
            return new Related(null, id, null, null);
        }

        public static Related contact(UUID id) {
            return new Related(null, null, id, null);
        }
    }

    /**
     * An applied write. {@code primary} rows carry the request's
     * {@code Idempotency-Key}; secondary rows of the same request carry
     * {@code NULL} (ADR 0027 §6.3).
     *
     * @return the new row's id, for {@code activities.related_change_log_id}
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public UUID logApplied(UUID userId, String entityType, UUID entityId, String operation,
            List<FieldChange> changes, WriteContext context, OffsetDateTime effectiveWriteAt, boolean primary) {
        return insertRow(userId, entityType, entityId, operation, ChangeLog.OUTCOME_APPLIED, null, null,
                changes, context, effectiveWriteAt, primary);
    }

    /**
     * A superseded update (ADR 0027 §5.2): the row with the attempted values, a
     * {@code write_superseded} activity linked to it, and a {@code sync_conflict}
     * notification for the actor. All three commit — the caller returns
     * {@code WriteResult.superseded()} rather than throwing.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public UUID logSuperseded(UUID userId, String entityType, UUID entityId, List<FieldChange> attempted,
            String reason, WriteContext context, OffsetDateTime effectiveWriteAt, String label, Related related) {
        UUID supersededBy = changeLogRepository
                .findFirstByUserIdAndEntityTypeAndEntityIdAndOutcomeOrderByCreatedAtDescIdDesc(
                        userId, entityType, entityId, ChangeLog.OUTCOME_APPLIED)
                .map(ChangeLog::getId)
                .orElse(null);
        UUID changeLogId = insertRow(userId, entityType, entityId, ChangeLog.OPERATION_UPDATE,
                ChangeLog.OUTCOME_SUPERSEDED, reason, supersededBy, attempted, context, effectiveWriteAt, true);

        OffsetDateTime madeAt = context.clientUpdatedAt() != null ? context.clientUpdatedAt() : effectiveWriteAt;
        String message = ChangeLogSentences.writeSuperseded(label, madeAt, reason);
        activity(userId, ChangeLogSentences.TYPE_WRITE_SUPERSEDED, ChangeLogSentences.WRITE_SUPERSEDED,
                new ActivitySentences.Sentence(message, null, ""), related, changeLogId);

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        notificationRepository.insertFanout(Set.of(userId), Notification.TYPE_SYNC_CONFLICT, message,
                now.toLocalDate(), now.toLocalTime(), now);
        return changeLogId;
    }

    /** One activity row for the actor, linked to its change-log row. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void activity(UUID actorUserId, String type, ChangeLogSentences.Icon icon,
            ActivitySentences.Sentence sentence, Related related, UUID changeLogId) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        activityRepository.insertFanout(Set.of(actorUserId), type, now.toLocalDate(), now.toLocalTime(),
                sentence.prefix(), sentence.entityName(), sentence.suffix(),
                related.transactionId(), related.groupId(), related.contactId(), related.splitExpenseId(),
                changeLogId, icon.iconName(), icon.glyph(), icon.tone(), now);
    }

    private UUID insertRow(UUID userId, String entityType, UUID entityId, String operation, String outcome,
            String supersededReason, UUID supersededBy, List<FieldChange> changes, WriteContext context,
            OffsetDateTime effectiveWriteAt, boolean primary) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        ChangeLog row = ChangeLog.builder()
                .id(UUID.randomUUID())
                .userId(userId)
                .entityType(entityType)
                .entityId(entityId)
                .operation(operation)
                .outcome(outcome)
                .supersededReason(supersededReason)
                .supersededByChangeLogId(supersededBy)
                .changes(objectMapper.writeValueAsString(changes))
                .idempotencyKey(primary ? context.idempotencyKey() : null)
                .origin(context.origin())
                .deviceId(context.deviceId())
                .clientUpdatedAt(context.clientUpdatedAt())
                .effectiveWriteAt(effectiveWriteAt)
                .createdAt(now)
                .updatedAt(now)
                .build();
        entityInserter.insert(row);
        return row.getId();
    }
}
