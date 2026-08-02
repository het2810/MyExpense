package com.myexpense.backend.service;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.UpdateUserSettingsRequest;
import com.myexpense.backend.entity.UserSettings;
import com.myexpense.backend.repository.UserSettingsRepository;

/**
 * The single transactional attempt at "insert the caller's settings row, or
 * update it if it already exists", isolated in its own bean so that
 * {@link UserSettingsService} can retry it after losing an insert race.
 *
 * <p><strong>Why a separate bean rather than a private method.</strong> Two
 * reasons, both structural:
 * <ul>
 *   <li>Spring's transaction advice is a proxy — a {@code this.upsert(...)}
 *       self-call inside {@code UserSettingsService} would not start a
 *       transaction at all, so the retry would silently run unmanaged.</li>
 *   <li>The retry must run in a <em>fresh</em> transaction. Catching the
 *       constraint violation inside the transaction that caused it is
 *       useless: that transaction is already marked rollback-only and any
 *       further work on it fails at commit. {@code REQUIRES_NEW} gives the
 *       failed attempt its own boundary to roll back, leaving the caller
 *       free to try again cleanly.</li>
 * </ul>
 *
 * <p>The flush is deliberate: without it the INSERT is deferred to commit,
 * i.e. after the caller's try/catch has already returned, and the race would
 * surface as an unmappable 500 instead of a retryable conflict.
 */
@Component
public class UserSettingsWriter {

    private final UserSettingsRepository userSettingsRepository;

    public UserSettingsWriter(UserSettingsRepository userSettingsRepository) {
        this.userSettingsRepository = userSettingsRepository;
    }

    /**
     * @throws org.springframework.dao.DataIntegrityViolationException if a
     *         concurrent request inserted the same {@code user_id} first
     *         (primary key {@code pk_user_settings})
     */
    /*
     * ADR 0027 (2026-11-11): MANDATORY, no longer REQUIRES_NEW. The settings
     * write must commit in the SAME transaction as its change_log row, so the
     * boundary now belongs to IdempotentWriteExecutor, which also owns the
     * insert-race retry: a pk_user_settings violation rolls the whole attempt
     * back and re-runs it once in a fresh transaction, where it finds the row
     * and applies the patch as an update — the same outcome the old
     * REQUIRES_NEW retry produced.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public UserSettings upsert(UUID userId, UpdateUserSettingsRequest request, OffsetDateTime effectiveWriteAt) {
        UserSettings settings = userSettingsRepository.findById(userId)
                .orElseGet(() -> UserSettings.withDefaults(userId));
        // ADR 0027 §5.2: an applied client write moves the LWW clock.
        settings.setLastClientWriteAt(effectiveWriteAt);

        // Partial update: a null field was not sent, so it keeps either the
        // stored value (existing row) or the documented default (new row).
        if (request.overspendingAlertsEnabled() != null) {
            settings.setOverspendingAlertsEnabled(request.overspendingAlertsEnabled());
        }
        if (request.paymentModeEnabled() != null) {
            settings.setPaymentModeEnabled(request.paymentModeEnabled());
        }
        // Added 2026-10-22 (ADR 0019 §6). Exactly the same pattern as the two
        // above, deliberately: this writes ONE boolean on ONE row and must
        // never cascade into categories, transactions or anything else
        // (ADR 0019 §6.2 — turning subcategories off hides them, it never
        // destroys them).
        if (request.subcategoriesEnabled() != null) {
            settings.setSubcategoriesEnabled(request.subcategoriesEnabled());
        }

        // Use the returned instance: the id is assigned rather than
        // generated, so Spring Data merges and hands back a different managed
        // instance — the same wrinkle backend/README.md §3 records for
        // register()'s createdAt.
        return userSettingsRepository.saveAndFlush(settings);
    }
}
