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

/**
 * Maps to the {@code split_expense_payers} table
 * (database/migrations/V16__split_expense_payers.sql,
 * docs/decisions/0025-multiple-payers-per-split-expense.md §2).
 *
 * <p><strong>Who paid how much</strong> toward one split expense, one row per
 * payer. Every split expense has one or more rows, and their {@link #amountPaid}
 * values sum exactly to {@code split_expenses.amount}. That sum is cross-row, so
 * no constraint can hold it: {@code SplitExpenseService} validates it before any
 * write (ADR 0025 §2.4, §5.1 R4).
 *
 * <p>The payer is a registered user or a contact, exactly one
 * ({@code chk_split_expense_payers_user_xor_contact}) — the same nullable-pair
 * shape as {@link SplitExpenseParticipant}.
 *
 * <h2>Reading rule (ADR 0025 §3, binding)</h2>
 *
 * <p>"Who paid" and "how much did X pay" are answered from this table only, never
 * from {@code split_expenses.paid_by_*}. Those legacy columns hold the primary
 * payer for constraint validity and for the deprecated response fields.
 *
 * <h2>Insert-only (ADR 0024 §1, ADR 0025 §2.5)</h2>
 *
 * <p>No setter, every column except {@code updated_at} is
 * {@code updatable = false}, and the repository exposes no update or delete
 * method. There is no {@code deleted_at}: a future soft delete of a split expense
 * marks the parent row, and these rows follow the parent's liveness.
 *
 * <p><strong>No {@code name} column.</strong> The payer's display name is resolved
 * live in the response, as {@code paidByName} always was (ADR 0025 §2.2).
 */
@Entity
@Table(name = "split_expense_payers")
@Getter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class SplitExpensePayer {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "split_expense_id", nullable = false, updatable = false)
    private UUID splitExpenseId;

    /** Nullable — {@code null} on a contact payer's row. */
    @Column(name = "payer_user_id", updatable = false)
    private UUID payerUserId;

    /** Nullable — {@code null} on a registered payer's row. */
    @Column(name = "payer_contact_id", updatable = false)
    private UUID payerContactId;

    /**
     * {@code numeric(12,2)}, always {@code > 0}
     * ({@code chk_split_expense_payers_amount_paid_positive}). A payer who paid
     * nothing is not a payer.
     */
    @Column(name = "amount_paid", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal amountPaid;

    /**
     * V19 / ADR 0028 §3: the split revision this row belongs to. Current iff it
     * equals {@code split_expenses.revision}. Always set explicitly on insert and
     * never updated.
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
