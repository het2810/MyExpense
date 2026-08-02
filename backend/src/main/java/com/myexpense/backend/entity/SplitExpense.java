package com.myexpense.backend.entity;

import java.math.BigDecimal;
import java.time.LocalDate;
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
 * Maps to the {@code split_expenses} table (data-model.md §4.6,
 * database/migrations/V11__split_expenses.sql).
 *
 * <p>One shared expense, split between participants. This row records
 * <strong>what</strong> was spent and <strong>where</strong> its balance impact
 * landed; {@link SplitExpenseParticipant} records <strong>who</strong> owes what,
 * and the two balance tables hold the running totals.
 *
 * <h2>Exactly one target, chosen by {@link #splitMode}</h2>
 *
 * <p>{@code chk_split_expenses_target_matches_mode} is a true iff over two
 * branches: {@code split_mode = 'group'} ⇒ {@link #groupId} set and
 * {@link #individualBalanceId} null, and the mirror image for
 * {@code 'individual'}. {@code V11} names it "the most likely of the six to
 * surface during implementation: it fires if the service fills both target
 * columns, or neither" — so {@code SplitExpenseService} builds the row through
 * one of two factory methods that each null the other column explicitly.
 *
 * <h2>Five category snapshot columns, four of them NOT NULL</h2>
 *
 * <p>The same deliberate denormalization as {@code transactions} (§2.2): a
 * rename must not rewrite history by a join, and {@link #categoryName} is always
 * <strong>the leaf's own name</strong>, never a composed path. The client
 * composes {@code Food › Snacks} from {@link #categoryName} +
 * {@link #parentCategoryName} at render time.
 *
 * <p><strong>When {@code categoryId} is omitted from the request, the server
 * snapshots the creator's protected {@code Misc} row</strong> (ADR 0023 §3,
 * resolved by {@code is_protected} and <em>never</em> by name) and sets
 * {@link #categoryId} to it. So in practice this column is always populated on
 * insert and no snapshot value is ever null.
 *
 * <p>{@link #categoryId} <strong>stays nullable anyway</strong>, because
 * {@code fk_split_expenses_category_id} is {@code ON DELETE SET NULL}. That
 * action is <strong>dormant</strong> since {@code V15}: categories are never
 * hard-deleted (ADR 0024 §4.5), and a category delete now
 * <strong>reassigns</strong> the creator's split expenses to the creator's
 * {@code Misc} row (ADR 0024 §4.8,
 * {@code SplitExpenseRepository#reassignToFallbackCategory}), keeping the
 * original id in {@link #reassignedFromCategoryId}. A null here is therefore
 * only reachable by direct SQL or by the future account purge, and never means
 * "none was chosen". Every member of a shared split sees the {@code Misc}
 * snapshot after its creator deletes the category.
 *
 * <h2>{@link #personalTransactionId} and the circular reference</h2>
 *
 * <p>{@code split_expenses} ↔ {@code transactions} reference each other, so
 * neither column can ever become {@code NOT NULL} and the write order inside one
 * transaction is fixed ({@code V11}'s CIRCULAR REFERENCE block): insert this row
 * with a null back-reference, insert the consumption-share
 * {@code transactions} row pointing at it, then update this row.
 * {@code chk_split_expenses_personal_transaction_requires_flag} enforces only
 * the half that is enforceable (a false flag forbids a back-reference) because
 * the strict iff would reject the first insert of every opted-in split expense.
 *
 * <p><strong>The unenforceable half is this service's job, and it is kept true
 * by storing the flag as what actually happened</strong>: see
 * {@code SplitExpenseService} for the one case where the request says
 * {@code true} and the stored value is {@code false}.
 *
 * <p><strong>No {@code currency_code}, no receipt column, no {@code version}, no
 * {@code client_id}</strong> — each is excluded by name in {@code V11}. Do not add
 * one.
 *
 * <h2>Edit and delete (V19, ADR 0028)</h2>
 *
 * <p>{@link #revision} is the current revision: a child participant or payer row
 * is current iff its own {@code revision} equals this. It is an explicit counter
 * the edit sets to {@code r + 1}, <strong>not a JPA {@code @Version}</strong> —
 * there is no {@code 409 VERSION_CONFLICT} for split expenses (ADR 0028 §6.3).
 * {@link #deletedAt}/{@link #deletedByUserId} are set together, with
 * {@code updated_at}, from one instant ({@code chk_split_expenses_deleted_by_iff_deleted}).
 * {@link #lastClientWriteAt} is the LWW clock (ADR 0027 §5.1), set by create and
 * by every applied edit, never by a propagation or a delete.
 */
@Entity
@Table(name = "split_expenses")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class SplitExpense {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** The creator. From the JWT principal, never a request field. */
    @Column(name = "created_by_user_id", nullable = false, updatable = false)
    private UUID createdByUserId;

    @Column(name = "title", nullable = false, length = 255)
    private String title;

    /** The leaf category — see the class Javadoc on why it stays nullable. */
    @Column(name = "category_id")
    private UUID categoryId;

    /**
     * <strong>Internal restore marker — never exposed in any API response or
     * sync payload</strong> ({@code V15__categories_soft_delete.sql},
     * ADR 0024 §6.2). The {@link #categoryId} this row carried immediately
     * before its creator's category delete reassigned it to {@code Misc};
     * {@code null} otherwise.
     *
     * <p>Written only by {@code SplitExpenseRepository#reassignToFallbackCategory}.
     * It must be cleared by any future write that changes {@link #categoryId}
     * for another reason; no such write exists yet (§9 has no {@code PATCH}).
     * Not touched by rename propagation. A bare {@link UUID}, as
     * {@link #categoryId} is; covered by
     * {@code fk_split_expenses_reassigned_from_category_id} (no
     * {@code ON DELETE}), whose violation is a logged {@code 500}.
     */
    @Column(name = "reassigned_from_category_id")
    private UUID reassignedFromCategoryId;

    /** Snapshot — the leaf's own name, never a composed path. */
    @Column(name = "category_name", nullable = false, length = 100)
    private String categoryName;

    /** Snapshot — the leaf's parent's name, or {@code null} when top-level. */
    @Column(name = "parent_category_name", length = 100)
    private String parentCategoryName;

    /** Snapshot. */
    @Column(name = "category_icon_name", nullable = false, length = 100)
    private String categoryIconName;

    /** Snapshot. {@code varchar(4)}, matching {@code categories.glyph}. */
    @Column(name = "category_glyph", nullable = false, length = 4)
    private String categoryGlyph;

    /**
     * Snapshot — the {@code IconBadge} tone. A split expense is always an
     * expense, so this is always {@code CategorySnapshot#EXPENSE_TONE}; the value
     * is still derived through {@code CategorySnapshot} rather than written
     * inline, so the literal lives in exactly one place (ADR 0018 §3.3).
     */
    @Column(name = "category_tone", nullable = false, length = 20)
    private String categoryTone;

    @Column(name = "split_date", nullable = false)
    private LocalDate splitDate;

    /** {@code numeric(12,2)} → {@link BigDecimal}, never {@code double}. */
    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "split_mode", nullable = false, length = 10)
    private SplitMode splitMode;

    /** Non-null iff {@link #splitMode} is {@link SplitMode#GROUP}. */
    @Column(name = "group_id", updatable = false)
    private UUID groupId;

    /** Non-null iff {@link #splitMode} is {@link SplitMode#INDIVIDUAL}. */
    @Column(name = "individual_balance_id", updatable = false)
    private UUID individualBalanceId;

    /**
     * {@code 'equally' | 'unequally' | 'percentage' | 'shares' | 'adjustment'}
     * (ADR 0005 §5). A plain {@link String} and <strong>no vocabulary CHECK in the
     * schema</strong>, deliberately: nothing keys off the literal and it
     * partitions no money — the participant amounts are already explicit, and the
     * method records only how they were derived in the UI ({@code V11}). The
     * request DTO's {@code @Pattern} is the vocabulary guard.
     */
    @Column(name = "split_method", nullable = false, length = 20)
    private String splitMethod;

    /**
     * Exactly one of {@link #paidByUserId} / {@link #paidByContactId} is set: the
     * PRIMARY payer of the current revision (ADR 0025 §3). Updatable since
     * ADR 0028, because an edit can change who the primary payer is.
     */
    @Column(name = "paid_by_user_id")
    private UUID paidByUserId;

    /** See {@link #paidByUserId}. */
    @Column(name = "paid_by_contact_id")
    private UUID paidByContactId;

    @Column(name = "added_to_personal_expenses", nullable = false)
    private boolean addedToPersonalExpenses;

    /**
     * The creator's own <strong>consumption-share</strong> transaction — never the
     * full {@link #amount} (§4.6, ADR 0005 §6.1, re-verified server-side). Set in
     * a second statement, after that row exists; see the class Javadoc.
     */
    @Column(name = "personal_transaction_id")
    private UUID personalTransactionId;

    /** V19: the current revision. Not a {@code @Version} — see the class Javadoc. */
    @Builder.Default
    @Column(name = "revision", nullable = false)
    private int revision = 1;

    /** V19 / ADR 0024: soft delete. Set with {@link #deletedByUserId} from one instant. */
    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    /** V19: who deleted it — the feed's tombstone names them. */
    @Column(name = "deleted_by_user_id")
    private UUID deletedByUserId;

    /** V19 / ADR 0027 §5.1: the LWW clock. */
    @Column(name = "last_client_write_at")
    private OffsetDateTime lastClientWriteAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
