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
 * Maps to the {@code individual_balances} table (data-model.md §4.5 as corrected
 * by ADR 0023 §1, database/migrations/V11__split_expenses.sql).
 *
 * <p>The pairwise ledger: <strong>one number for one pair, outside any
 * group</strong>.
 *
 * <h2>The sign convention — relative to {@link #userId}, NOT to the caller</h2>
 *
 * <p>{@code balance} is signed relative to {@link #userId}: <strong>positive =
 * {@code userId} is owed, negative = {@code userId} owes</strong> (ADR 0023 §1.4,
 * stated there for the first time because §4.5 never did).
 * {@code GET /splits/individuals} <em>negates</em> it when the caller is the
 * canonical {@link #counterpartUserId}, so a client always receives "from your
 * point of view". That flip happens in exactly one place —
 * {@code IndividualBalanceService} — and nowhere else.
 *
 * <h2>Two modes, and {@link #userId} means two different things</h2>
 *
 * <ul>
 *   <li><strong>REGISTERED PAIR</strong> — {@link #counterpartUserId} non-null,
 *       and {@code chk_individual_balances_canonical_pair_order} forces
 *       {@code user_id < counterpart_user_id} (unsigned 16-byte uuid order).
 *       Exactly one row exists for the unordered pair, <em>both</em> parties read
 *       and settle it, and either may settle it (§10.1).</li>
 *   <li><strong>UNREGISTERED COUNTERPART</strong> — {@link #counterpartContactId}
 *       non-null, {@link #userId} is its owner, and the row is private and
 *       owner-scoped. There is no second side to reconcile, because a contact
 *       placeholder has no account and cannot read anything.</li>
 * </ul>
 *
 * <p><strong>The mitigation ADR 0023 §1.2 states as a rule rather than a
 * constraint: nothing outside {@code IndividualBalanceService} /
 * {@code IndividualBalanceRepository} may assume {@link #userId} is the
 * caller.</strong> Every read is "the caller is a party to this row", never
 * "{@code user_id} = me" — which is exactly the bug §1.4 fixes, and the one a
 * reviewer will not notice, because the wrong version still returns plausible
 * data.
 *
 * <h2>Why a surrogate {@code id} survives here, unlike {@code group_members}</h2>
 *
 * <p>{@code split_expenses.individual_balance_id} and
 * {@code settlements.individual_balance_id} are real foreign keys to this
 * column, and {@code POST /splits/settle} identifies its target by it (§10.1). A
 * composite key would force both into composite foreign keys for no benefit
 * (§4.5).
 *
 * <h2>{@link #balance} is {@link BigDecimal}, and rows move by relative delta</h2>
 *
 * <p>{@code numeric(12,2)} → {@link BigDecimal}, never {@code double}: this
 * number is compared for equality with zero ("settled up") and reduced to a
 * residual by partial settlement, and binary floating point would make "settled"
 * a state that is sometimes not reached ({@code V11} contract item 6).
 *
 * <p>Every write goes through {@code IndividualBalanceService}: an
 * {@code INSERT ... ON CONFLICT ... DO UPDATE} to resolve-or-create, then a
 * <em>relative</em> {@code balance = balance + ?} update. That is the same
 * mechanism chosen for {@code group_member_balances} (V10's CONCURRENCY block,
 * option (b)), picked once for both tables as {@code V11} contract item 4
 * requires. {@code SELECT ... FOR UPDATE} is deliberately absent from this table
 * too, and the two mechanisms must not be mixed. Consequently no code calls a
 * setter on {@link #balance} and saves it — this entity is a <strong>read</strong>
 * mapping in practice.
 *
 * <p><strong>No {@code currency_code}.</strong> One pair holds exactly one row
 * (ADR 0017's Scope Narrowing banner, §4.5's struck-through row: "Do not create
 * this column"). Do not add one.
 */
@Entity
@Table(name = "individual_balances")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class IndividualBalance {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * On a registered-pair row, the <strong>lesser</strong> uuid of the two
     * parties. On a contact row, the <strong>owner</strong>. Never assume it is
     * the caller — see the class Javadoc.
     */
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /** Nullable — {@code null} on a contact row. The greater uuid when set. */
    @Column(name = "counterpart_user_id", updatable = false)
    private UUID counterpartUserId;

    /** Nullable — {@code null} on a registered-pair row. */
    @Column(name = "counterpart_contact_id", updatable = false)
    private UUID counterpartContactId;

    @Column(name = "balance", nullable = false, precision = 12, scale = 2)
    private BigDecimal balance;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
