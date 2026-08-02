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
 * Maps to the {@code settlements} table (data-model.md §4.8 as extended by
 * ADR 0023 §4, database/migrations/V12__settlements.sql).
 *
 * <p><strong>An AUDIT RECORD.</strong> It is inserted and then read; nothing
 * updates or deletes it (§10 has no PATCH and no DELETE), which is why there is
 * no {@code version} and no {@code deleted_at}. If a settlement is ever recorded
 * in error, the fix is a new compensating row — an audit trail that can be
 * rewritten is not an audit trail.
 *
 * <h2>{@link #initiatedByUserId} records WHO, and authorizes NOTHING</h2>
 *
 * <p>Either party may record a settlement (§10.1: "this is a membership check,
 * not a check against 'did this specific principal originate the debt'"), so this
 * column is history, not permission — the same relationship
 * {@code groups.created_by_user_id} has to group membership.
 *
 * <h2>The two counterpart columns are for a GROUP settlement only</h2>
 *
 * <p>{@code chk_settlements_counterpart_matches_target}: when {@link #groupId} is
 * non-null, exactly one of {@link #counterpartUserId} /
 * {@link #counterpartContactId} is set; when {@link #individualBalanceId} is
 * non-null, <strong>both are null</strong>. {@code V12} calls this "the most
 * likely of the four CHECKs to surface during implementation", so
 * {@code SettlementService} builds the row through one of two factory methods
 * rather than assigning the columns field by field.
 *
 * <p><strong>Why nothing for the individual case</strong> — after ADR 0023 §1 an
 * {@code individual_balances} row <em>is</em> the pair, so both parties are
 * already in the row {@link #individualBalanceId} references and a counterpart
 * column would be a second representation of a fact the FK carries
 * (constitution §17).
 *
 * <h2>{@link #settledAt} carries NO default and is NOT {@code created_at} under
 * another name</h2>
 *
 * <p>§4.8 specifies it as {@code not null} with no default: {@code created_at} is
 * when the <em>row</em> was written and {@code settled_at} is when the
 * <em>money</em> moved. They are the same instant today only because §10.1 has
 * no back-dating field, and giving the column a default would quietly make the
 * distinction unmaintainable the first time a settlement is recorded after the
 * fact. The service supplies it; the API returns it as {@code settledAt}.
 *
 * <h2>No {@code remaining_balance} column</h2>
 *
 * <p>§10.1's {@code remainingBalance} is computed at response time from the
 * target balance row. Storing it would be a second, immediately-stale
 * representation of a number that already has an authoritative home
 * (constitution §17, {@code V12}'s "what this migration deliberately does NOT
 * do"). Do not add one. There is no {@code currency_code} either, for the same
 * reason as everywhere else in this domain.
 */
@Entity
@Table(name = "settlements")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class Settlement {

    /** {@code 'marked_paid'} — one of the two values {@code chk_settlements_method_valid} allows. */
    public static final String METHOD_MARKED_PAID = "marked_paid";

    /** {@code 'upi'} — the other. */
    public static final String METHOD_UPI = "upi";

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Exactly one of {@link #groupId} / {@link #individualBalanceId} is set. */
    @Column(name = "group_id", updatable = false)
    private UUID groupId;

    /** Exactly one of {@link #groupId} / {@link #individualBalanceId} is set. */
    @Column(name = "individual_balance_id", updatable = false)
    private UUID individualBalanceId;

    @Column(name = "initiated_by_user_id", nullable = false, updatable = false)
    private UUID initiatedByUserId;

    /** Group settlements only; see the class Javadoc. */
    @Column(name = "counterpart_user_id", updatable = false)
    private UUID counterpartUserId;

    /** Group settlements only; see the class Javadoc. */
    @Column(name = "counterpart_contact_id", updatable = false)
    private UUID counterpartContactId;

    /**
     * {@code numeric(12,2)} → {@link BigDecimal}, never {@code double}
     * ({@code V12} contract item 4): this is the number compared against a
     * balance for {@code <=} and subtracted from it to produce a residual, so
     * binary floating point would make "settled in full" a state that sometimes
     * is not reached.
     */
    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    /**
     * {@code 'marked_paid'} | {@code 'upi'} —
     * {@code chk_settlements_method_valid}'s full vocabulary, which is also
     * §10.1's. A plain {@link String} with a DTO {@code @Pattern} guard; the
     * column's CHECK exists here (unusually for this schema) only because the row
     * is immutable, so a junk value would be permanent.
     */
    @Column(name = "method", nullable = false, length = 20)
    private String method;

    /**
     * V19 / ADR 0028 §7.4: {@code true} = the initiator paid, {@code false} = the
     * initiator recorded receiving. Boxed, because {@code NULL} is meaningful:
     * a row written before V19, direction unknown. Written on EVERY new
     * settlement (V19 CONTRACT item 5); immutable afterwards.
     */
    @Column(name = "initiator_is_payer", updatable = false)
    private Boolean initiatorIsPayer;

    /** When the money moved. Supplied by the service — no column default. */
    @Column(name = "settled_at", nullable = false, updatable = false)
    private OffsetDateTime settledAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
