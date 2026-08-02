package com.myexpense.backend.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.ListNotificationsQuery;
import com.myexpense.backend.dto.response.MessageResponse;
import com.myexpense.backend.dto.response.NotificationResponse;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.NotificationService;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the Notifications domain (api-overview.md §12) — three
 * endpoints, all requiring {@code Authorization: Bearer <accessToken>}, which
 * {@code SecurityConfig} enforces before any method here runs.
 *
 * <p>Poll-based: no push and no websocket this phase (ADR 0014, Out of scope), so
 * a client learns about a new notification by calling {@link #listNotifications}
 * again. That is also why the unread badge is a request rather than a subscription
 * — see {@code NotificationService#listNotifications}.
 *
 * <p>The caller's identity arrives only via {@link CurrentUserId}, i.e. from the
 * verified JWT (security-architecture.md §2). {@code {id}} identifies the
 * <em>notification</em>, never the user: the service resolves it with a lookup
 * that is itself filtered by the authenticated user id, so an id belonging to
 * another account is a {@code 404 NOTIFICATION_NOT_FOUND} and never a
 * {@code 403}. A malformed {@code {id}} is a {@code 400 VALIDATION_ERROR} through
 * {@code GlobalExceptionHandler}'s API-wide type-mismatch handler.
 *
 * <p><strong>There is no POST and no DELETE</strong>: §12 defines neither. A
 * notification is created only by the Domain 6 fan-out and is never deleted — the
 * table has no {@code deleted_at} column, and {@code read} is the one mutable
 * column in this entire domain.
 *
 * <h2>{@code PATCH /read-all} and {@code PATCH /{id}/read} cannot collide</h2>
 *
 * <p>§12.3 is {@code PATCH /api/v1/notifications/read-all} — <strong>a
 * {@code PATCH}, not a {@code POST}</strong>, taken from the contract's own
 * endpoint table rather than assumed, and consistent with §12.2 being a
 * {@code PATCH} of the same column. The two patterns differ in segment count
 * ({@code /read-all} is one segment, {@code /{id}/read} is two), so no request can
 * match both and {@code read-all} is never parsed as a notification id.
 *
 * <p>Rate limiting needs nothing here: {@code ApiRateLimitFilter} covers every
 * {@code /api/v1/**} path except {@code /api/v1/auth/**}. Neither mark-read write
 * has an external side effect — there is no send, no SMS and no provider behind
 * either — so neither warrants a stricter tier (security-architecture.md §11). Do
 * not add a second mechanism.
 */
@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    /**
     * §12.1 — the caller's notifications: paginated, newest first, optionally
     * filtered by {@code read}.
     *
     * <p>This is also where the unread badge's count comes from
     * ({@code ?read=false} plus {@code PageResponse.totalElements}), because §12
     * defines no count endpoint and none is invented here — {@code V13} FLAG 3,
     * answered in backend/README.md §17.8.
     */
    @GetMapping
    public ResponseEntity<PageResponse<NotificationResponse>> listNotifications(
            @CurrentUserId UUID userId,
            @Valid @ModelAttribute ListNotificationsQuery query) {
        return ResponseEntity.ok(notificationService.listNotifications(userId, query));
    }

    /**
     * §12.2 — mark one notification read (owner-scoped); {@code 200 OK} with the
     * updated {@code NotificationResponse} and {@code read: true}.
     *
     * <p>No request body: the endpoint's path states the whole intent, and the
     * contract defines no payload. Repeating the call is a {@code 200} and writes
     * nothing.
     */
    @PatchMapping("/{id}/read")
    public ResponseEntity<NotificationResponse> markNotificationRead(
            @CurrentUserId UUID userId,
            @PathVariable("id") UUID id) {
        return ResponseEntity.ok(notificationService.markRead(userId, id));
    }

    /**
     * §12.3 — mark every unread notification read; {@code 200 OK} with the
     * contract's fixed {@code MessageResponse}.
     *
     * <p>No request body and no affected-row count in the response — §12.3
     * specifies exactly one message string, so a count would be an invented field.
     * An account with nothing unread gets the identical {@code 200}.
     */
    @PatchMapping("/read-all")
    public ResponseEntity<MessageResponse> markAllNotificationsRead(@CurrentUserId UUID userId) {
        return ResponseEntity.ok(notificationService.markAllRead(userId));
    }
}
