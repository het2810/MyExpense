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
 * Maps to the {@code group_members} table (data-model.md §4.3,
 * database/migrations/V10__groups.sql).
 *
 * <p><strong>THE AUTHORIZATION TABLE.</strong> Every membership-gated endpoint
 * in §7 (and later §9/§10) resolves through it, which makes it the most
 * security-load-bearing table in the schema: this is the first domain where an
 * authorization bug would let one user see or modify another user's data
 * (ADR 0014 §2). The membership check is
 * {@code WHERE group_id = ? AND user_id = ?} — a unique point lookup on
 * {@code uq_group_members_group_id_user_id} — re-derived <em>per request</em>,
 * never cached, and answered with {@code 404} rather than {@code 403} so a
 * non-member learns nothing about whether the group exists
 * (security-architecture.md §2).
 *
 * <h2>A member is EITHER a registered user OR an invited contact, exactly one</h2>
 *
 * <p>{@code chk_group_members_user_xor_contact} enforces it, and the nullable
 * pair is what makes a group usable before everyone in it has an account — the
 * whole reason ADR 0015's SMS invite exists. {@link #userId} is set when the
 * member has an account (including when a contact's
 * {@code linked_user_id} is populated at add time); {@link #invitedContactId} is
 * set otherwise. Code here must never assume {@link #userId} is present.
 *
 * <h2>{@link #invitedContactId} may belong to ANY member, not to the caller</h2>
 *
 * <p>This table records no {@code invited_by_user_id} column, so
 * {@code fk_group_members_invited_contact_id} is single-column and V6/V9's
 * composite same-owner trick is inapplicable here (V10's note at the
 * constraint). <strong>That FK guarantees the contact EXISTS, not who owns
 * it.</strong> "The contact belongs to the caller" is unavoidably a
 * service-layer invariant, checked at ADD time only — api-overview.md §7.4's
 * {@code 400 CONTACT_NOT_FOUND}. A later read may legitimately encounter a
 * contact owned by a different member.
 *
 * <p>{@link #role} carries only {@code 'member'} today and has no vocabulary
 * CHECK (V1's {@code user_roles.role} precedent: a single current value, nothing
 * keying off the literal, nothing financial partitioned by it). There is no
 * {@code 'owner'} role this phase, matching the frontend. It is always written
 * explicitly from {@link #ROLE_MEMBER} rather than left to the column default,
 * the same convention the application-assigned primary keys follow.
 */
@Entity
@Table(name = "group_members")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class GroupMember {

    /** The only role this phase (data-model.md §4.3, api-overview.md §7.2). */
    public static final String ROLE_MEMBER = "member";

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "group_id", nullable = false, updatable = false)
    private UUID groupId;

    /** Nullable — {@code null} on a contact-placeholder member. See the class Javadoc. */
    @Column(name = "user_id", updatable = false)
    private UUID userId;

    /** Nullable — {@code null} on a registered member. See the class Javadoc. */
    @Column(name = "invited_contact_id", updatable = false)
    private UUID invitedContactId;

    @Column(name = "role", nullable = false, length = 20)
    private String role;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
