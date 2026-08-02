package com.myexpense.backend.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.ListChangeLogQuery;
import com.myexpense.backend.dto.response.ChangeLogEntryResponse;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.ChangeLogService;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the change log (api-overview.md §15.6/§15.7, ADR 0027
 * §6.5). Read-only: rows are written by the write paths themselves and are
 * immutable. Authenticated and on the default per-user rate-limit tier
 * ({@code ApiRateLimitFilter} covers every non-auth {@code /api/v1/**} path).
 */
@RestController
@RequestMapping("/api/v1/change-log")
public class ChangeLogController {

    private final ChangeLogService changeLogService;

    public ChangeLogController(ChangeLogService changeLogService) {
        this.changeLogService = changeLogService;
    }

    @GetMapping
    public ResponseEntity<PageResponse<ChangeLogEntryResponse>> listEntries(
            @CurrentUserId UUID userId,
            @Valid @ModelAttribute ListChangeLogQuery query) {
        return ResponseEntity.ok(changeLogService.listEntries(userId, query));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ChangeLogEntryResponse> getEntry(
            @CurrentUserId UUID userId,
            @PathVariable("id") UUID id) {
        return ResponseEntity.ok(changeLogService.getEntry(userId, id));
    }
}
