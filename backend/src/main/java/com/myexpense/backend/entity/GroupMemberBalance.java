package com.myexpense.backend.entity;

import java.math.BigDecimal;
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
 * Maps to the {@code group_member_balances} table (data-model.md §4.4 as
 * reshaped by ADR 0023 §2, database/migrations/V10__groups.sql).
 *
 * <p>One row per member per group, and that single number is the member's whole
 * position in it: <strong>positive = this member is owed, negative = this member
 * owes.</strong>
 *
 * <h2>A plain surrogate {@code @Id}, NOT an {@code @IdClass}/{@code @EmbeddedId}</h2>
 *
 * <p>V10's contract item 4 states this explicitly, and an earlier draft of that
 * file said the opposite — so it is worth recording why the surrogate is
 * <em>required</em> rather than preferred: a primary key cannot contain a
 * nullable column, and {@link #userId} had to become nullable so that an
 * <strong>unregistered member could hold a balance</strong> (ADR 0023 §2). The
 * composite key's two jobs survive elsewhere — uniqueness in
 * {@code uq_group_member_balances_group_id_user_id} and
 * {@code ..._invited_contact_id}, and the dominant read path in the first of
 * those (its btree is non-partial and leads with {@code group_id}).
 *
 * <p><strong>Both {@link #userId} and {@link #invitedContactId} are nullable
 * reference types, and nothing may assume {@link #userId} is present</strong> —
 * that assumption is the bug this reshape exists to remove.
 * {@code chk_group_member_balances_user_xor_contact} is identical to
 * {@link GroupMember}'s own XOR, deliberately: the two tables now agree about
 * who a member may be, so a reader comparing them sees one rule, not two.
 *
 * <h2>Why every member gets a row, at zero, as soon as they join</h2>
 *
 * <p>The zero-sum reconciliation check — this domain's central correctness test
 * — is only meaningful if <em>every</em> member's share has a row (ADR 0023 §2,
 * reason 2). Before the reshape, an unregistered member's share had nowhere to
 * land, so a legitimate shortfall and a lost update were indistinguishable. A
 * balance of {@code 0.00} is not fabricated money: it is the true position of a
 * member who has participated in nothing yet, and it is what makes
 * {@code GroupResponse.yourBalance} a real read rather than a {@code coalesce}.
 * {@code GroupBalanceService} creates these rows with the resolve-or-create
 * upsert ADR 0023 requires.
 *
 * <h2>{@link #balance} is {@link BigDecimal}, never a {@code double}</h2>
 *
 * <p>V10 contract item 4 calls this the type mistake that is silent rather than
 * loud. It is a ledger column compared for equality with zero ("settled up") and
 * reduced to a residual by partial settlement (V12); binary floating point would
 * make "settled" a value that is sometimes not reached. No CHECK on its sign
 * (both signs are meaningful, zero is the settled state) and none on its
 * magnitude.
 *
 * <p><strong>No {@code currency_code}, here least of all.</strong> This is the
 * table that rule was written about: currency is a display symbol only, there is
 * one unit of account, and keying a balance by currency would fragment one true
 * balance of 800 into "500 INR and 300 USD" that must never be recombined
 * (ADR 0017's Scope Narrowing banner, data-model.md §4.4). Do not add one.
 *
 * <p><strong>Rows are written by relative delta, not by read-modify-write.</strong>
 * Every write to this table goes through {@code GroupBalanceService}'s
 * {@code INSERT ... ON CONFLICT ... DO UPDATE SET balance = balance + ?}, which
 * is atomic per statement. That is the serialisation mechanism chosen for this
 * table (V10's CONCURRENCY block, option (b)); {@code SELECT ... FOR UPDATE} is
 * deliberately <em>not</em> used anywhere on it, and the two must not be mixed.
 * Consequently this entity is a <strong>read</strong> mapping in practice: no
 * code calls a setter on {@link #balance} and saves it.
 */
@Entity
@Table(name = "group_member_balances")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class GroupMemberBalance {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "group_id", nullable = false, updatable = false)
    private UUID groupId;

    /** Nullable — {@code null} on a contact-placeholder member's row. */
    @Column(name = "user_id", updatable = false)
    private UUID userId;

    /** Nullable — {@code null} on a registered member's row. */
    @Column(name = "invited_contact_id", updatable = false)
    private UUID invitedContactId;

    @Column(name = "balance", nullable = false, precision = 12, scale = 2)
    private BigDecimal balance;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
