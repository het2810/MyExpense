package com.myexpense.backend.controller;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.UpdatePremiumRequest;
import com.myexpense.backend.dto.request.UpdateUserRequest;
import com.myexpense.backend.dto.request.UpdateUserSettingsRequest;
import com.myexpense.backend.dto.response.UserProfileResponse;
import com.myexpense.backend.dto.response.UserSettingsResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.UserService;
import com.myexpense.backend.service.UserSettingsService;
import com.myexpense.backend.sync.WriteContext;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the User &amp; Settings domain (api-overview.md §2) —
 * the first authenticated domain in this backend. All five endpoints require
 * {@code Authorization: Bearer <accessToken>}; {@code SecurityConfig} is what
 * enforces that, before any method here runs.
 *
 * <p><strong>Every endpoint is {@code /me}.</strong> There is deliberately no
 * {@code /users/{id}} route: the caller's identity arrives only via
 * {@link CurrentUserId} — i.e. from the verified JWT in the
 * {@code SecurityContext} — and never from a path variable, query parameter
 * or request body (security-architecture.md §2). Later domains that do address
 * a specific resource by id must still resolve "who is asking" this same way,
 * and filter the resource by it.
 *
 * <p>Business rules (phone uniqueness, settings defaults and their upsert)
 * live in the services; this class only maps HTTP.
 */
@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    private final UserService userService;
    private final UserSettingsService userSettingsService;

    public UserController(UserService userService, UserSettingsService userSettingsService) {
        this.userService = userService;
        this.userSettingsService = userSettingsService;
    }

    /** §2.1 — fetch the caller's own profile. */
    @GetMapping("/me")
    public ResponseEntity<UserProfileResponse> getCurrentUser(@CurrentUserId UUID userId) {
        return ResponseEntity.ok(userService.getCurrentUser(userId));
    }

    /** §2.2 — partial profile update (name, phone, currency; no premium gate). */
    @PatchMapping("/me")
    public ResponseEntity<UserProfileResponse> updateCurrentUser(
            @CurrentUserId UUID userId, @Valid @RequestBody UpdateUserRequest request) {
        return ResponseEntity.ok(userService.updateCurrentUser(userId, request));
    }

    /** §2.3 — fetch behavioural settings. */
    @GetMapping("/me/settings")
    public ResponseEntity<UserSettingsResponse> getSettings(@CurrentUserId UUID userId) {
        return ResponseEntity.ok(userSettingsService.getSettings(userId));
    }

    /** §2.4 — partial settings update. */
    @PatchMapping("/me/settings")
    public ResponseEntity<UserSettingsResponse> updateSettings(
            @CurrentUserId UUID userId, WriteContext writeContext,
            @Valid @RequestBody UpdateUserSettingsRequest request) {
        // ADR 0027: logged, LWW; superseded -> 409 after the log rows committed.
        return userSettingsService.updateSettings(userId, request, writeContext).toResponseEntity();
    }

    /** §2.5 — toggle premium (boolean stub, no billing); returns the updated profile. */
    @PatchMapping("/me/premium")
    public ResponseEntity<UserProfileResponse> updatePremium(
            @CurrentUserId UUID userId, @Valid @RequestBody UpdatePremiumRequest request) {
        return ResponseEntity.ok(userService.updatePremium(userId, request));
    }
}
