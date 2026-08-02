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
 * Maps to the {@code contacts} table (data-model.md §4.1,
 * database/migrations/V9__contacts.sql).
 *
 * <p><strong>This is the one table in the shared-ledger domain that is still
 * OWNER-SCOPED</strong> (V9's header, data-model.md §4's note). A contact is one
 * user's private address-book entry even once it links to a real account, so
 * "does {@link #ownerUserId} match the JWT principal" <em>is</em> the right
 * authorization test here — unlike everything in V10/V11/V12, where
 * authorization is membership. {@code ContactRepository} therefore takes
 * {@code ownerUserId} on every lookup and there is no bare {@code findById} use
 * in {@code ContactService}.
 *
 * <p><strong>{@link #phone} and {@link #email} are separate, both nullable, and
 * neither is unique</strong> (ADR 0015 §2, resolved 2026-08-17 from the original
 * combined {@code phone_or_email}). Each property is deliberate and must not be
 * "improved":
 * <ul>
 *   <li>two independent lookups against {@code users.phone}/{@code users.email},
 *       with no shape-inference heuristic anywhere;</li>
 *   <li>not unique — a contact's phone is an address-book entry, not an account
 *       identity, so two users (or two contacts of one user) may legitimately
 *       hold the same number;</li>
 *   <li>a contact may have <em>either, both, or neither</em>
 *       (api-overview.md §6.1), so there is no "at least one of" rule.</li>
 * </ul>
 *
 * <p><strong>{@link #initials} is SERVER-DERIVED and must never become a request
 * field</strong> (V9 contract item 3). {@code POST /contacts} accepts
 * name/phone/email only; the column is {@code NOT NULL}, so
 * {@code ContactService} always computes it. The same server-authoritative
 * pattern as {@code transactions}' five category snapshot columns.
 *
 * <p><strong>{@link #linkedUserId} is the hinge the whole shared-ledger model
 * turns on</strong> — an unlinked contact is a placeholder, a linked one is a
 * real counterpart — and it stays nullable forever, because most contacts never
 * link. It is never a request field: it is resolved server-side from a
 * {@code users} row that was just read (api-overview.md §6.2).
 *
 * <p>Mapped as bare {@link UUID}s rather than {@code @ManyToOne} associations,
 * for the same reason {@code Category}'s {@code userId} is: nothing in this
 * domain navigates the object graph, and an association would add a lazy proxy
 * that earns its keep nowhere. {@code owner_user_id} and {@code linked_user_id} point
 * at two <em>different</em> {@code users} rows, which is correct rather than a
 * modelling slip.
 *
 * <p>No {@code deleted_at} and no {@code version} column: {@code deleted_at} is
 * specified for {@code transactions} alone and §6 has no DELETE and no PATCH, so
 * there is no soft delete to propagate and no edit to conflict.
 */
@Entity
@Table(name = "contacts")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class Contact {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Owner. Never settable from a request body — it comes from the JWT principal. */
    @Column(name = "owner_user_id", nullable = false, updatable = false)
    private UUID ownerUserId;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    /**
     * Derived from {@link #name} by {@code ContactService}, never submitted.
     * {@code varchar(4)} matches {@code categories.glyph} — the same short-badge
     * convention, sized the same way.
     */
    @Column(name = "initials", nullable = false, length = 4)
    private String initials;

    /**
     * E.164 when present, enforced at the DTO layer rather than by a column
     * CHECK (V9's table note). <strong>The stored string is the invite
     * cooldown's bucket key</strong>, which is why the DTO's pattern is strict:
     * {@code "+919876543210"} and {@code "+91 98765 43210"} would otherwise be
     * two different real-world-identical buckets, and the per-phone cooldown
     * would be bypassable by reformatting.
     */
    @Column(name = "phone", length = 20)
    private String phone;

    @Column(name = "email", length = 255)
    private String email;

    /**
     * Set when {@link #phone} or {@link #email} matched a registered account at
     * creation time (api-overview.md §6.2). {@code null} for a placeholder
     * contact.
     *
     * <p>Nothing forbids {@code linkedUserId == ownerUserId} — a user whose own
     * number is in their own address book (V9 FLAG 1, unresolved). The
     * group-membership paths handle that case explicitly rather than assuming it
     * away; see {@code GroupService}.
     */
    @Column(name = "linked_user_id")
    private UUID linkedUserId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
