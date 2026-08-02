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

/**
 * Maps to the {@code split_expense_individual_balances} table
 * (database/migrations/V17__split_expense_individual_balances.sql,
 * docs/decisions/0026-multi-contact-individual-splits.md §2).
 *
 * <p>One row records exactly one fact: <strong>"this split moved this pair
 * row"</strong>. An individual split has one or more rows (one per counterpart),
 * a group split has none. {@code uq_split_expense_individual_balances_expense_balance}
 * makes "one split moves one pair row twice" unrepresentable; the service rejects
 * the same person twice first with {@code 400 duplicateCounterpart()}, so reaching
 * the constraint is a logged {@code 500}, never a {@code 409}.
 *
 * <h2>Reading rule (ADR 0026 §3, binding)</h2>
 *
 * <p>"Which pairs did this split move", "is the viewer a party" and "which splits
 * belong to this pair" are answered from this table only, never from
 * {@code split_expenses.individual_balance_id}. That legacy column holds the
 * primary counterpart's pair for constraint validity and for the deprecated
 * response field.
 *
 * <h2>No counterpart identity and no stored delta (ADR 0026 §2.2)</h2>
 *
 * <p>Both are derivable: the counterpart from the pair row and the split's
 * creator, the per-pair net from the split's own payer and participant rows.
 *
 * <h2>Insert-only (ADR 0024 §1, ADR 0026 §2.4)</h2>
 *
 * <p>No setter, every column except {@code updated_at} is
 * {@code updatable = false}, and the repository exposes no update or delete
 * method. No {@code deleted_at}. Both timestamps are set by the entity on
 * insert, because no trigger maintains them (V17 CONTRACT item 2), so
 * {@code updated_at} always equals {@code created_at}.
 */
@Entity
@Table(name = "split_expense_individual_balances")
@Getter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class SplitExpenseIndividualBalance {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "split_expense_id", nullable = false, updatable = false)
    private UUID splitExpenseId;

    @Column(name = "individual_balance_id", nullable = false, updatable = false)
    private UUID individualBalanceId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
