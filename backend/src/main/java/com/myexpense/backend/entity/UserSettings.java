package com.myexpense.backend.entity;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Maps to the {@code user_settings} table (docs/architecture/data-model.md
 * §1.5, database/migrations/V2__user_settings.sql, as amended by
 * {@code V5__user_settings_subcategories_enabled.sql}).
 *
 * <p>This is an owner-keyed 1:1 extension of {@code users}: {@code user_id}
 * <em>is</em> the primary key — there is deliberately no surrogate {@code id}
 * column. The key is mapped as a plain assigned {@code @Id} rather than a
 * {@code @MapsId} association because nothing in this domain needs to
 * navigate from settings back to the {@code User} entity; keeping it a bare
 * {@code UUID} avoids a lazy-loading proxy that would earn its keep nowhere.
 *
 * <p><strong>"No row" is a valid state.</strong> A user who has never called
 * {@code PATCH /users/me/settings} has no row here, and
 * {@code GET /users/me/settings} answers with the documented defaults without
 * writing one (confirmed with the Database Architect — existing users are
 * deliberately not backfilled). <strong>That is unchanged by ADR 0019's third
 * column:</strong> {@code subcategories_enabled} arrives with a
 * {@code DEFAULT FALSE} on an additive migration, so an existing row needs no
 * backfill and an absent row still means "all three defaults".
 * The three {@code DEFAULT_*} constants below
 * mirror this table's own column defaults exactly, and are the single Java-side
 * source for both that read path and the insert path: Hibernate always lists
 * every column in its INSERT, so the database defaults never actually apply to
 * a row this application creates.
 *
 * <p>{@code updated_at} is maintained by {@link UpdateTimestamp} — the schema
 * has no trigger for it (consistent with V1), and a stale {@code updated_at}
 * would undermine the last-write-wins sync story (constitution §14).
 */
@Entity
@Table(name = "user_settings")
@Getter
@Setter
@NoArgsConstructor
public class UserSettings {

    /** Mirrors {@code user_settings.overspending_alerts_enabled}'s column default. */
    public static final boolean DEFAULT_OVERSPENDING_ALERTS_ENABLED = true;

    /** Mirrors {@code user_settings.payment_mode_enabled}'s column default. */
    public static final boolean DEFAULT_PAYMENT_MODE_ENABLED = false;

    /**
     * Mirrors {@code user_settings.subcategories_enabled}'s column default
     * (data-model.md §1.5, ADR 0019 §6 — added 2026-10-22).
     *
     * <p>{@code false}, like {@link #DEFAULT_PAYMENT_MODE_ENABLED} and unlike
     * {@link #DEFAULT_OVERSPENDING_ALERTS_ENABLED}: subcategories are a
     * net-new, opt-in capability a user should consciously enable, not
     * behaviour the app already had.
     *
     * <p><strong>This flag gates nothing on the server</strong> (ADR 0019
     * §6.1). It decides whether a <em>client</em> offers the second level;
     * {@code POST /categories} accepts a {@code parentCategoryId} either way
     * and {@code GET /categories} always returns the complete tree. Turning it
     * off writes one boolean and touches no other row — subcategories are
     * hidden by the client, never destroyed. Do not add a read of this value
     * to {@code CategoryService}.
     */
    public static final boolean DEFAULT_SUBCATEGORIES_ENABLED = false;

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "overspending_alerts_enabled", nullable = false)
    private boolean overspendingAlertsEnabled;

    @Column(name = "payment_mode_enabled", nullable = false)
    private boolean paymentModeEnabled;

    @Column(name = "subcategories_enabled", nullable = false)
    private boolean subcategoriesEnabled;

    /** The LWW clock (ADR 0027 §5.1, V18); set only by an applied client PATCH. */
    @Column(name = "last_client_write_at")
    private OffsetDateTime lastClientWriteAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    /** A not-yet-persisted row carrying the documented defaults. */
    public static UserSettings withDefaults(UUID userId) {
        UserSettings settings = new UserSettings();
        settings.userId = userId;
        settings.overspendingAlertsEnabled = DEFAULT_OVERSPENDING_ALERTS_ENABLED;
        settings.paymentModeEnabled = DEFAULT_PAYMENT_MODE_ENABLED;
        settings.subcategoriesEnabled = DEFAULT_SUBCATEGORIES_ENABLED;
        return settings;
    }
}
