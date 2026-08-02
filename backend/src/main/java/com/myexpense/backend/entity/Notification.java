package com.myexpense.backend.entity;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Maps to the {@code notifications} table (data-model.md §5.2,
 * database/migrations/V13__activities_notifications.sql).
 *
 * <p>Owner-scoped, poll-based (no push or websocket this phase), and fanned out
 * by the same writes as {@link Activity} — with one difference that is a rule,
 * not a detail: <strong>{@code activities} gets a row for the actor too;
 * {@code notifications} go to every OTHER affected member.</strong> You do not
 * notify someone of their own action ({@code V13} contract item 2).
 *
 * <h2>No {@code related_*} column and no FK except {@link #userId}</h2>
 *
 * <p>That is the snapshot pattern taken to its limit, not an omission:
 * {@link #message} is a complete, frozen sentence and §12.1's
 * {@code NotificationResponse} exposes no entity ids at all. So nothing here can
 * dangle, no cascade is needed, and no delete flow can make a notification
 * unreadable. The recorded cost ({@code V13} FLAG 3): <strong>a notification is
 * not navigable</strong> — tapping one cannot open the group or split expense it
 * describes, because the row does not know which they were.
 *
 * <h2>{@link #read} is the one mutable column in this entire domain</h2>
 *
 * <p>§12.2 marks one row read and §12.3 marks every unread row read, so — unlike
 * {@link Activity} and unlike {@link Settlement} — these rows legitimately change
 * after insert. <strong>{@link #updatedAt} must therefore actually be maintained
 * by the service</strong>: the database maintains it nowhere in this schema, and
 * §12.3's bulk UPDATE bypasses {@code @UpdateTimestamp} entirely ({@code V13}
 * contract item 4).
 *
 * <p><strong>Updated with Domain 7:</strong> all three §12 endpoints now exist
 * ({@code NotificationService}), and the rule above is honoured on both write
 * paths — §12.2 goes through the persistence context so {@code @UpdateTimestamp}
 * runs, and §12.3's bulk statement sets {@code updated_at} explicitly
 * ({@code NotificationRepository#markAllReadForUser}). <strong>{@link #read} is
 * the only column either one touches</strong>, and
 * {@code ActivityFanoutService} is still the only thing that creates a row here.
 *
 * <p>{@link #read} is a <strong>primitive {@code boolean}</strong>, not a boxed
 * {@link Boolean} ({@code V13} contract item 5): the column is {@code NOT NULL}
 * with a default, so a box would invite a null write that {@code 23502} rejects.
 *
 * <p>The column name {@code read} is a non-reserved keyword in PostgreSQL, so it
 * is legal unquoted and needs no quoting in queries. It is reserved in some other
 * engines — a known portability wart, kept because §5.2 specifies it.
 */
@Entity
@Table(name = "notifications")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class Notification {

    /**
     * {@code 'group_expense'} — written by {@code POST /split-expenses} for
     * <strong>both</strong> split modes. ADR 0012 §3's own seed data uses this
     * type for an individual split ("Priya Nair added \"Cab fare\" (₹300) with
     * you."), so the name is narrower than the meaning; it is kept because it is
     * that ADR's vocabulary and §12.1 returns it verbatim.
     */
    public static final String TYPE_GROUP_EXPENSE = "group_expense";

    /** {@code 'settlement'} — written by {@code POST /splits/settle}. */
    public static final String TYPE_SETTLEMENT = "settlement";

    /**
     * ADR 0027 §6.4: the one notification a user receives about their OWN
     * action — a queued write of theirs was superseded and did not happen.
     */
    public static final String TYPE_SYNC_CONFLICT = "sync_conflict";

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** The recipient — never the actor. See the class Javadoc. */
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /**
     * {@code 'overspending' | 'group_expense' | 'settlement' | 'reminder'}
     * (ADR 0012 §3). No vocabulary CHECK, for the same two reasons
     * {@link Activity#getType()} gets none.
     */
    @Column(name = "type", nullable = false, length = 30)
    private String type;

    /**
     * The full sentence, already rendered — including the amount and its currency
     * symbol. PostgreSQL {@code text} with no cap, so <strong>no {@code length}
     * attribute</strong>. {@code chk_notifications_message_not_blank} is safe here
     * (unlike on {@code activities}' two text columns) because this column is the
     * whole notification.
     */
    @Column(name = "message", nullable = false)
    private String message;

    @Column(name = "notif_date", nullable = false, updatable = false)
    private LocalDate notifDate;

    @Column(name = "notif_time", nullable = false, updatable = false)
    private LocalTime notifTime;

    @Column(name = "read", nullable = false)
    private boolean read;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
