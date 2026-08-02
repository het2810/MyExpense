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
 * Maps to the {@code split_expense_participants} table (data-model.md §4.7,
 * database/migrations/V11__split_expenses.sql).
 *
 * <p><strong>Who owes what</strong>, one row per participant. The participant is
 * either a registered user or a contact, exactly one
 * ({@code chk_split_expense_participants_user_xor_contact}) — this domain's
 * pervasive nullable-pair pattern for the third time.
 *
 * <h2>{@link #name} is a SNAPSHOT, frozen at creation</h2>
 *
 * <p>Specified, mirroring ADR 0009 §2's "names are frozen at creation time". This
 * is the deliberate opposite of {@link GroupMember}, which stores no name because
 * a membership list is <em>current</em> state and must reflect a rename. Both are
 * correct: a historical record must not change, a current list must.
 *
 * <p>It is <strong>server-resolved and never a request field</strong>
 * ({@code V11} contract item 5): the request carries ids, and
 * {@code SplitExpenseService} reads the name off the {@code users} or
 * {@code contacts} row it has already resolved. Reaching
 * {@code chk_split_expense_participants_name_not_blank} is therefore a service
 * bug, not bad input.
 *
 * <h2>{@link #amount} is the participant's share, and the sum rule is NOT a
 * constraint</h2>
 *
 * <p>"Must sum exactly across all participants to {@code split_expenses.amount}"
 * is cross-row and no CHECK can see it (§4.7, §9.1 step 1). The service
 * re-validates it on every write, with {@link BigDecimal#compareTo} against
 * values a DTO {@code @Digits(fraction = 2)} has already constrained to two
 * decimal places — which is stricter than {@code V11} contract item 2's
 * "round to paise before comparing" rather than an approximation of it.
 *
 * <p>{@code chk_split_expense_participants_amount_non_negative} is the one
 * single-row half the schema can hold, and it catches what the sum rule cannot: a
 * negative share balancing against an inflated one ({@code -100} and {@code 350}
 * sum correctly to {@code 250}) would move one participant's balance the wrong
 * way while the total reconciles.
 *
 * <p><strong>{@code V11}'s FLAG 5(d) is answered and the constraint is
 * CORRECT.</strong> ADR 0005 §5.8 constrains every {@code 'adjustment'} entry to
 * {@code ≥ 0} ("no negative adjustments — the reference's single {@code +}
 * prefix, not {@code ±}, is taken as the intentional constraint") and blocks
 * confirmation whenever {@code remainderForUnadjusted < 0}, so an unadjusted
 * participant's share can reach {@code 0} but never go below it. A zero share
 * <em>is</em> legal (§5.7's zero-share person), which is why the constraint is
 * {@code >= 0} and not {@code > 0}. No migration is owed.
 */
@Entity
@Table(name = "split_expense_participants")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class SplitExpenseParticipant {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "split_expense_id", nullable = false, updatable = false)
    private UUID splitExpenseId;

    /** Nullable — {@code null} on a contact participant's row. */
    @Column(name = "participant_user_id", updatable = false)
    private UUID participantUserId;

    /** Nullable — {@code null} on a registered participant's row. */
    @Column(name = "participant_contact_id", updatable = false)
    private UUID participantContactId;

    /** Frozen display name. Server-resolved; never a request field. */
    @Column(name = "name", nullable = false, length = 100)
    private String name;

    /** {@code numeric(12,2)} → {@link BigDecimal}, never {@code double}. */
    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    /**
     * V19 / ADR 0028 §3: the split revision this row belongs to. Current iff it
     * equals {@code split_expenses.revision}. Always set explicitly on insert
     * (never rely on the column default) and never updated.
     */
    @Column(name = "revision", nullable = false, updatable = false)
    private int revision;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
