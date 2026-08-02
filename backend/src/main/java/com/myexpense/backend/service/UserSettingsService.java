package com.myexpense.backend.service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.UpdateUserSettingsRequest;
import com.myexpense.backend.dto.response.UserSettingsResponse;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.entity.UserSettings;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.repository.UserSettingsRepository;
import com.myexpense.backend.sync.ChangeLogEntityTypes;
import com.myexpense.backend.sync.ChangeSets;
import com.myexpense.backend.sync.IdempotentWriteExecutor;
import com.myexpense.backend.sync.LastWriteWins;
import com.myexpense.backend.sync.WriteContext;
import com.myexpense.backend.sync.WriteResult;

/**
 * Business rules for the caller's behavioural settings (api-overview.md
 * §2.3/§2.4).
 *
 * <p><strong>Row semantics.</strong> "No {@code user_settings} row" is a
 * valid, expected state, not a missing-data bug: registration does not create
 * one and existing users are deliberately not backfilled (confirmed with the
 * Database Architect). So {@code GET} answers with the documented defaults
 * and stays side-effect-free — a read never writes — while {@code PATCH}
 * upserts. Anything that changes about registration later therefore cannot
 * break these two endpoints.
 *
 * <p>Both methods are scoped to the authenticated {@code userId}, which is
 * also the primary key of the row, so there is no lookup here that could
 * reach another user's settings.
 *
 * <p><strong>Three booleans since 2026-10-22</strong> (ADR 0019 §6):
 * {@code subcategoriesEnabled} joined the two existing toggles and is handled
 * identically end to end. Note what this service deliberately does
 * <em>not</em> do with it: nothing reads it anywhere else in the backend. It
 * is a UI affordance, not an authorization rule — {@code CategoryService} must
 * never consult it (§6.1), and a {@code false} write must never cascade into
 * {@code categories} (§6.2). Both properties hold here by construction,
 * because this service only ever touches {@code user_settings}.
 */
@Service
public class UserSettingsService {

    private static final Logger log = LoggerFactory.getLogger(UserSettingsService.class);

    private final UserSettingsRepository userSettingsRepository;
    private final UserRepository userRepository;
    private final UserSettingsWriter userSettingsWriter;
    private final IdempotentWriteExecutor writeExecutor;
    private final ChangeLogWriter changeLogWriter;

    public UserSettingsService(
            UserSettingsRepository userSettingsRepository,
            UserRepository userRepository,
            UserSettingsWriter userSettingsWriter,
            IdempotentWriteExecutor writeExecutor,
            ChangeLogWriter changeLogWriter) {
        this.userSettingsRepository = userSettingsRepository;
        this.userRepository = userRepository;
        this.userSettingsWriter = userSettingsWriter;
        this.writeExecutor = writeExecutor;
        this.changeLogWriter = changeLogWriter;
    }

    /** {@code GET /api/v1/users/me/settings} — returns defaults if no row exists, without creating one. */
    @Transactional(readOnly = true)
    public UserSettingsResponse getSettings(UUID userId) {
        requireUser(userId);
        return userSettingsRepository.findById(userId)
                .map(UserSettingsService::toResponse)
                .orElseGet(() -> new UserSettingsResponse(
                        UserSettings.DEFAULT_OVERSPENDING_ALERTS_ENABLED,
                        UserSettings.DEFAULT_PAYMENT_MODE_ENABLED,
                        UserSettings.DEFAULT_SUBCATEGORIES_ENABLED));
    }

    /**
     * {@code PATCH /api/v1/users/me/settings} — partial update, upserting the
     * row on first use.
     *
     * <p>Deliberately <em>not</em> {@code @Transactional} itself: each
     * attempt below must get its own transaction so the retry runs on a clean
     * one. Two concurrent first-time PATCHes for the same user both see "no
     * row" and both try to insert; one wins, the other violates
     * {@code pk_user_settings}. That loser is not an error the client should
     * ever see — the row it wanted now exists, so a single retry applies the
     * same patch as an update. Only a second, non-racing failure propagates.
     */
    public WriteResult<UserSettingsResponse> updateSettings(
            UUID userId, UpdateUserSettingsRequest request, WriteContext context) {
        // The executor's transaction now holds the upsert AND its change_log row;
        // its single re-run replaces the old lost-insert-race retry (a
        // pk_user_settings violation re-runs as an update).
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.USER_SETTINGS, ChangeLog.OPERATION_UPDATE, userId),
                recorded -> ChangeLog.OUTCOME_SUPERSEDED.equals(recorded.getOutcome())
                        ? WriteResult.<UserSettingsResponse>superseded()
                        : WriteResult.ok(getSettings(userId)),
                () -> doUpdateSettings(userId, request, context));
    }

    private WriteResult<UserSettingsResponse> doUpdateSettings(
            UUID userId, UpdateUserSettingsRequest request, WriteContext context) {
        requireUser(userId);
        OffsetDateTime effectiveWriteAt = context.effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC));

        // Locked so the LWW compare-then-write is atomic. No row yet = defaults,
        // and nothing to lose against.
        UserSettings current = userSettingsRepository.findForUpdateByUserId(userId).orElse(null);
        Map<String, Object> before = loggedFields(current != null ? current : UserSettings.withDefaults(userId));
        if (context.lwwMode() && current != null) {
            String reason = LastWriteWins.supersededReason(false, current.getLastClientWriteAt(), effectiveWriteAt);
            if (reason != null) {
                changeLogWriter.logSuperseded(userId, ChangeLogEntityTypes.USER_SETTINGS, userId,
                        ChangeSets.attempted(before, attemptedFields(request)), reason, context,
                        effectiveWriteAt, "your settings", ChangeLogWriter.Related.NONE);
                log.info("Settings update superseded for user {} (reason={})", userId, reason);
                return WriteResult.superseded();
            }
        }

        UserSettings settings = userSettingsWriter.upsert(userId, request, effectiveWriteAt);
        log.info("Settings updated for user {}", userId);

        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.USER_SETTINGS, userId,
                ChangeLog.OPERATION_UPDATE, ChangeSets.update(before, loggedFields(settings)), context,
                effectiveWriteAt, true);
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_SETTINGS_CHANGED,
                ChangeLogSentences.SETTINGS_CHANGED, ChangeLogSentences.settingsChanged(),
                ChangeLogWriter.Related.NONE, changeLogId);
        return WriteResult.ok(toResponse(settings));
    }

    /** ADR 0027 §6.3's logged fields for {@code user_settings}. */
    private static Map<String, Object> loggedFields(UserSettings settings) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("overspendingAlertsEnabled", settings.isOverspendingAlertsEnabled());
        fields.put("paymentModeEnabled", settings.isPaymentModeEnabled());
        fields.put("subcategoriesEnabled", settings.isSubcategoriesEnabled());
        return fields;
    }

    private static Map<String, Object> attemptedFields(UpdateUserSettingsRequest request) {
        Map<String, Object> fields = new LinkedHashMap<>();
        if (request.overspendingAlertsEnabled() != null) {
            fields.put("overspendingAlertsEnabled", request.overspendingAlertsEnabled());
        }
        if (request.paymentModeEnabled() != null) {
            fields.put("paymentModeEnabled", request.paymentModeEnabled());
        }
        if (request.subcategoriesEnabled() != null) {
            fields.put("subcategoriesEnabled", request.subcategoriesEnabled());
        }
        return fields;
    }

    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }

    private static UserSettingsResponse toResponse(UserSettings settings) {
        return new UserSettingsResponse(
                settings.isOverspendingAlertsEnabled(),
                settings.isPaymentModeEnabled(),
                settings.isSubcategoriesEnabled());
    }
}
