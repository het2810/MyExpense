package com.myexpense.backend.entity;

import java.time.LocalDate;
import java.time.LocalTime;
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
 * Maps to the {@code activities} table (data-model.md §5.1,
 * database/migrations/V13__activities_notifications.sql).
 *
 * <p>The global Activities feed: <strong>one row per user per event, including
 * events other people caused</strong>. Owner-scoped to read ({@link #userId}
 * <em>is</em> the right authorization test here, unlike every V10/V11 table) and
 * <strong>fanned out</strong> to write — those two facts together are the whole
 * design. A shared event produces N rows, one per affected member, each privately
 * readable by its own owner, so no membership check is ever needed on a read and
 * no row is ever shared between two readers.
 *
 * <h2>Written by Domain 6 before Domain 7's own endpoints exist</h2>
 *
 * <p>{@code V13} landed ahead of its own domain precisely so §9.1 step 4 and
 * §10.1 step 5 could satisfy their approved contracts: the fan-out must commit
 * <strong>in the same transaction</strong> as the ledger write and the balance
 * recalculation. {@code ActivityFanoutService} is the only writer.
 *
 * <p><strong>Updated with Domain 7:</strong> {@code GET /activities} (§11.1) now
 * exists ({@code ActivityService}, {@code ActivityRepository#findFiltered}) and it
 * only reads. {@code ActivityFanoutService} is <em>still</em> the only writer of
 * this table, and these rows are still immutable — §11 defines one {@code GET} and
 * nothing else.
 *
 * <h2>The three-part sentence</h2>
 *
 * <p>{@link #descriptionPrefix} + {@link #entityName} + {@link #descriptionSuffix}
 * is ADR 0008 §1.2's chosen shape, not a decomposition invented here:
 * {@link #entityName} renders in the accent colour and the other two are plain,
 * which one flat string could not express without the client re-parsing it.
 * Plain concatenation always reconstructs the sentence, which is why no redundant
 * flat {@code description} column exists.
 *
 * <p><strong>{@link #descriptionSuffix} is legitimately {@code ""}</strong> and
 * {@link #descriptionPrefix} may be too — {@code V13} declines a not-blank CHECK
 * on both for exactly that reason, and adding one would reject rows the approved
 * contract produces.
 *
 * <p><strong>{@link #entityName} is the snapshot that keeps the row readable;
 * the four {@code related_*} ids are navigation only.</strong> All four are
 * {@code ON DELETE SET NULL}, and this column is what makes that safe: when a
 * linked group is deleted the row loses its link and loses nothing a user can
 * see. {@code chk_activities_entity_name_not_blank} forbids the third state
 * (non-null but blank), which would render as an empty accent-coloured gap in the
 * middle of a sentence.
 *
 * <h2>Order by {@link #activityDate} + {@link #activityTime}, never {@code created_at}</h2>
 *
 * <p>{@code V13} contract item 3 makes the pair authoritative for ordering, and
 * {@code idx_activities_user_id_activity_date_time} is built for it. Mixing in
 * {@code created_at} on one read path and not another is how two rows written in
 * one transaction come back in two different orders on two screens. Both are
 * server-generated at fan-out time — unlike {@code transactions.txn_date/txn_time},
 * which must travel from a device because the event may happen offline.
 *
 * <p>Rows are <strong>immutable</strong>: no endpoint updates an activity, so
 * {@link #updatedAt} equals {@link #createdAt} for the life of every row. The
 * column exists because constitution §10 requires it.
 */
@Entity
@Table(name = "activities")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class Activity {

    /** Written by {@code POST /split-expenses} (§9.1 step 4). */
    public static final String TYPE_SPLIT_SAVED = "split_saved";

    /** Written by {@code POST /splits/settle} (§10.1 step 5). */
    public static final String TYPE_SETTLEMENT = "settlement";

    /** Written by {@code PUT /split-expenses/{id}} (ADR 0028 §9.4). */
    public static final String TYPE_SPLIT_EDITED = "split_edited";

    /** Written by {@code DELETE /split-expenses/{id}} (ADR 0028 §9.4). */
    public static final String TYPE_SPLIT_DELETED = "split_deleted";

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * The <strong>owner of this feed row</strong> — on a fan-out this is another
     * member's id, read from {@code group_members} (or from the pair) in the same
     * transaction. A {@code fk_activities_user_id} violation would mean the
     * membership read and the insert disagree: a {@code 500} and a bug worth
     * logging loudly ({@code V13} contract item 1).
     */
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /**
     * {@code 'transaction_edited' | 'split_saved' | 'group_created' |
     * 'settlement'} — an <strong>extensible</strong> union (ADR 0008 §1), which
     * is why {@code V13} gives it no vocabulary CHECK: a closed set would need a
     * migration per new activity kind.
     */
    @Column(name = "type", nullable = false, length = 30)
    private String type;

    @Column(name = "activity_date", nullable = false, updatable = false)
    private LocalDate activityDate;

    @Column(name = "activity_time", nullable = false, updatable = false)
    private LocalTime activityTime;

    /**
     * Sentence text before {@link #entityName} — or the complete sentence when
     * {@link #entityName} is {@code null}. PostgreSQL {@code text} with no cap:
     * <strong>no {@code length} attribute</strong>, exactly as {@code V13}
     * contract item 5 instructs ({@code Transaction#getNotes()}'s precedent).
     */
    @Column(name = "description_prefix", nullable = false)
    private String descriptionPrefix;

    /** The one highlighted group/contact/person name. Nullable, never blank. */
    @Column(name = "entity_name", length = 255)
    private String entityName;

    /** Text after {@link #entityName}; {@code ""} when there is none. No length cap. */
    @Column(name = "description_suffix", nullable = false)
    private String descriptionSuffix;

    /** Navigation only. {@code ON DELETE SET NULL}. */
    @Column(name = "related_transaction_id")
    private UUID relatedTransactionId;

    /** Navigation only. {@code ON DELETE SET NULL}. */
    @Column(name = "related_group_id")
    private UUID relatedGroupId;

    /** Navigation only. {@code ON DELETE SET NULL}. */
    @Column(name = "related_contact_id")
    private UUID relatedContactId;

    /** Navigation only. {@code ON DELETE SET NULL}. */
    @Column(name = "related_split_expense_id")
    private UUID relatedSplitExpenseId;

    /**
     * The {@code change_log} row this entry explains (ADR 0027 §6.4, V18).
     * Navigation only, {@code ON DELETE SET NULL}, set on the actor's own row
     * only. {@code null} on fanned-out rows of other members and on pre-V18 rows.
     */
    @Column(name = "related_change_log_id")
    private UUID relatedChangeLogId;

    /**
     * There is deliberately <strong>no {@code related_settlement_id}</strong>
     * ({@code V13} FLAG 1): §5.1 lists four {@code related_*} columns and §11.1
     * exposes and filters on exactly those four, so a fifth is not invented here.
     * The known consequence: a settlement activity can point at its group or its
     * contact but not at the settlement row itself.
     */
    @Column(name = "icon_name", nullable = false, length = 100)
    private String iconName;

    /** {@code varchar(4)} — PostgreSQL counts characters, so {@code '⇄'} fits. */
    @Column(name = "glyph", nullable = false, length = 4)
    private String glyph;

    /** The {@code IconBadge} tone vocabulary. No CHECK — a presentation value. */
    @Column(name = "tone", nullable = false, length = 20)
    private String tone;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
