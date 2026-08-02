package com.myexpense.backend.entity;

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
 * Maps to the {@code contact_invites} table (data-model.md §4.9, ADR 0015
 * §3/§4, ADR 0023 §5.3, database/migrations/V9__contacts.sql).
 *
 * <p><strong>Its primary purpose is not display — it is the abuse-prevention
 * substrate</strong> for the most strictly rate-limited endpoint in the whole
 * API (security-architecture.md §11). Both of V9's indexes exist for a limit
 * check, not for a screen, and both limits are plain {@code COUNT(*)} window
 * queries over these rows.
 *
 * <h2>ONE ROW PER ATTEMPT — an append-only log</h2>
 *
 * <p>Every triggered invite INSERTS a new row and <strong>never updates an
 * existing one</strong> (ADR 0023 §5.3, Backend follow-up item 7). A row is
 * immutable once written except that {@link #status} advances
 * {@code queued} → {@code sent}/{@code failed} as the gateway responds — which
 * is what makes this a log rather than a state table.
 *
 * <p><strong>There is no {@code attempt_count} column and one must never be
 * reintroduced.</strong> It was dropped because it would be a denormalized
 * aggregate of the rows beside it (constitution §17): "how many times has this
 * contact been invited" is {@code COUNT(*)} over {@code contact_id}. The
 * deciding argument is worth keeping in view, because it is the one that is easy
 * to miss — under the row-reuse reading the per-user <em>daily cap</em> is not a
 * row count at all, so a resend that only bumped a counter would have escaped
 * the window entirely.
 *
 * <h2>{@link #sentAt} is a reference type, and that is not a style choice</h2>
 *
 * <p>The column is nullable and {@code chk_contact_invites_sent_at_matches_status}
 * enforces {@code (status = 'sent') = (sent_at IS NOT NULL)}. A
 * primitive-with-default would write a zero/epoch value in place of
 * {@code NULL}, which would both violate that CHECK and poison the cooldown
 * window (V9 contract item 4). {@code null} here is a real state — "queued, or
 * failed" — not a missing value.
 *
 * <h2>{@link #phone} is denormalized on purpose</h2>
 *
 * <p>Against this schema's grain, and for a specific reason (data-model.md §4.9,
 * ADR 0015 §4): the cooldown is defined per <em>real-world phone number</em>,
 * not per contact row. The same number may be entered by many users and the
 * cooldown must apply across all of them — nobody may route around it by
 * deleting and re-creating the contact. That needs a phone-indexed lookup
 * independent of {@link #contactId}, which a join through {@code contacts}
 * cannot provide once the contact is gone. {@code contact_id} is nullable and
 * {@code ON DELETE SET NULL} for exactly that reason, so this entity must never
 * treat it as present.
 */
@Entity
@Table(name = "contact_invites")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class ContactInvite {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * Nullable, and {@code ON DELETE SET NULL} at the database level — an
     * invite record must survive its contact being removed. Never assume it is
     * present: the row keeps its own {@link #phone}, which is all the cooldown
     * needs.
     */
    @Column(name = "contact_id")
    private UUID contactId;

    @Column(name = "invited_by_user_id", nullable = false, updatable = false)
    private UUID invitedByUserId;

    @Column(name = "phone", nullable = false, length = 20)
    private String phone;

    @Column(name = "status", nullable = false, length = 20)
    private ContactInviteStatus status;

    /**
     * The gateway's dispatch timestamp for <em>this</em> attempt. {@code null}
     * while {@code queued} and {@code null} for a {@code failed} attempt — see
     * the class Javadoc for why this must stay a reference type.
     */
    @Column(name = "sent_at")
    private OffsetDateTime sentAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
