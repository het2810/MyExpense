package com.myexpense.backend.service;

import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.ListChangeLogQuery;
import com.myexpense.backend.dto.response.ChangeLogEntryResponse;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.exception.ChangeLogEntryNotFoundException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.exception.WriteRequestValidationException;
import com.myexpense.backend.repository.ChangeLogRepository;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.sync.ChangeLogEntityTypes;

import tools.jackson.databind.ObjectMapper;

/**
 * BE-8: the two change-log reads (api-overview.md §15.6/§15.7). Owner-scoped —
 * {@code user_id} = caller — so another user's entity simply yields an empty
 * page and another user's entry a {@code 404}. Newest first by
 * {@code created_at DESC, id DESC}; one query per page.
 */
@Service
public class ChangeLogService {

    private final ChangeLogRepository changeLogRepository;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;

    public ChangeLogService(ChangeLogRepository changeLogRepository, UserRepository userRepository,
            ObjectMapper objectMapper) {
        this.changeLogRepository = changeLogRepository;
        this.userRepository = userRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public PageResponse<ChangeLogEntryResponse> listEntries(UUID userId, ListChangeLogQuery query) {
        requireUser(userId);
        boolean hasType = query.getEntityType() != null;
        boolean hasId = query.getEntityId() != null;
        if (hasType != hasId) {
            throw WriteRequestValidationException.changeLogFilterPair();
        }
        if (hasType && !ChangeLogEntityTypes.ALL.contains(query.getEntityType())) {
            throw WriteRequestValidationException.unknownEntityType();
        }

        PageRequest pageable = PageRequest.of(query.getPage(), query.getSize());
        Page<ChangeLog> page = hasType
                ? changeLogRepository.findByUserIdAndEntityTypeAndEntityIdOrderByCreatedAtDescIdDesc(
                        userId, query.getEntityType(), query.getEntityId(), pageable)
                : changeLogRepository.findByUserIdOrderByCreatedAtDescIdDesc(userId, pageable);
        List<ChangeLogEntryResponse> content = page.getContent().stream().map(this::toResponse).toList();
        return PageResponse.of(page, content);
    }

    @Transactional(readOnly = true)
    public ChangeLogEntryResponse getEntry(UUID userId, UUID entryId) {
        requireUser(userId);
        return changeLogRepository.findByIdAndUserId(entryId, userId)
                .map(this::toResponse)
                .orElseThrow(ChangeLogEntryNotFoundException::new);
    }

    private ChangeLogEntryResponse toResponse(ChangeLog row) {
        return new ChangeLogEntryResponse(
                row.getId(),
                row.getEntityType(),
                row.getEntityId(),
                row.getOperation(),
                row.getOutcome(),
                row.getSupersededReason(),
                row.getSupersededByChangeLogId(),
                objectMapper.readTree(row.getChanges()),
                row.getOrigin(),
                row.getDeviceId(),
                row.getClientUpdatedAt(),
                row.getEffectiveWriteAt(),
                row.getCreatedAt());
    }

    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }
}
