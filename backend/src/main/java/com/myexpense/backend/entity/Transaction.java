package com.myexpense.backend.entity;

import java.math.BigDecimal;
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
 * Maps to the {@code transactions} table (docs/architecture/data-model.md
 * §2.2, {@code database/migrations/V7__transactions.sql}).
 *
 * <p>Transactions are <strong>owner-scoped</strong>: every query in
 * {@code TransactionRepository} is filtered by the authenticated principal's
 * id, and a row belonging to another account is indistinguishable from one that
 * does not exist ({@code 404 TRANSACTION_NOT_FOUND}, never a {@code 403} —
 * security-architecture.md §2).
 *
 * <p>The primary key is application-assigned ({@link UUID#randomUUID()} in the
 * service layer) rather than relying on the column's {@code gen_random_uuid()}
 * default — the same convention {@link User} and {@link Category} already use.
 *
 * <h2>The five category snapshot columns</h2>
 *
 * <p>{@code category_name}, {@code category_icon_name}, {@code category_glyph}
 * and {@code category_tone} are {@code NOT NULL} on <em>every</em> row, income
 * included, and {@code parent_category_name} is nullable. They are a deliberate
 * denormalization: renaming a category later must not rewrite transaction
 * history (data-model.md §2.2), and they exist so that a transaction list
 * renders with <strong>no join to {@code categories}</strong> — do not add one
 * (Database Architect, 2026-10-24). {@link #categoryId} still exists as a real
 * reference for filtering/grouping, and holds <strong>the leaf</strong> — the
 * most specific category the user chose, which may be a subcategory (ADR 0019
 * §5). There is deliberately no second category reference here.
 *
 * <p>All five are <strong>server-authoritative</strong>: no request DTO in this
 * domain carries any of them (ADR 0018 §3.1, security-architecture.md §3). They
 * are resolved by {@code service/CategorySnapshotResolver} and nowhere else.
 *
 * <h2>The database does NOT enforce the expense/income category rule</h2>
 *
 * <p>{@code CHECK ((type = 'expense') = (category_id IS NOT NULL))} looks like
 * ADR 0018 encoded declaratively, but it could not be added: it would make
 * {@code category_id}'s own {@code ON DELETE SET NULL} unexecutable, since the
 * cascade's {@code UPDATE} would violate it (Database Architect, 2026-10-24).
 * So the rule lives <strong>only</strong> in {@code CategorySnapshotResolver},
 * {@link #type} remains the sole discriminator regardless of what
 * {@link #categoryId} holds, and <em>nothing here may assume the database is
 * checking it.</em>
 *
 * <p>One consequence worth not re-filing as a bug: an expense row with
 * {@code category_id = NULL} (reachable only by direct SQL since category
 * deletes reassign to {@code Misc} — ADR 0021 §2.4, ADR 0024 §4.3) keeps its
 * four snapshot values intact and still renders correctly, because rendering
 * never needed the reference. A {@code PATCH} that does not touch
 * {@code categoryId} must therefore <em>not</em> demand one for such a row.
 *
 * <h2>{@code version} is managed by the service, not by {@code @Version}</h2>
 *
 * <p>See {@link #version}. The schema has <strong>no trigger</strong> for
 * {@code version} or {@code updated_at} (consistent with V1–V6), so the
 * application owns both increments — which matters beyond optimistic
 * concurrency, because {@code updated_at} is the confirmed last-write-wins
 * column for sync (security-architecture.md §9). Anything that writes this
 * table bypassing the persistence layer would silently skip both.
 *
 * <p><strong>No {@code currency_code} column, deliberately</strong> — it was
 * removed on 2026-10-02
 * (docs/decisions/0017-per-currency-balances-and-partial-settlement.md's Scope
 * Narrowing banner). Currency is a display symbol only and
 * {@code users.default_currency_code} is the single currency column in the whole
 * schema. Do not add one here.
 */
@Entity
@Table(name = "transactions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class Transaction {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Owner. Never settable from a request body — it comes from the JWT principal. */
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /**
     * The user-entered label for this transaction ("Groceries at Big Bazaar").
     *
     * <p><strong>This column was missing from data-model.md §2.2 and was
     * created by the Database Architect on 2026-10-24</strong>, taking
     * {@code varchar(255) NOT NULL} from the sibling
     * {@code split_expenses.title} rather than guessing — api-overview.md
     * §4.1/§4.2/§4.4 all carry the field and the shipped frontend writes it, but
     * the column-level spec never listed it. The doc amendment is routed to the
     * System Architect; this mapping follows the migration exactly.
     */
    @Column(name = "title", nullable = false, length = 255)
    private String title;

    /**
     * The <strong>leaf</strong> category this transaction is tagged to — a
     * top-level category or a subcategory (ADR 0019 §5) — or {@code null} for
     * an income row, which references no category at all (ADR 0018 §3).
     *
     * <p><strong>A category delete never nulls it</strong> (ADR 0024): the
     * category is soft-deleted and every transaction tagged to it is first
     * reassigned to the caller's protected {@code Misc} row, with the original
     * id kept in {@link #reassignedFromCategoryId}.
     * {@code fk_transactions_category_id}'s {@code ON DELETE SET NULL} is
     * dormant — {@code categories} refuses every hard {@code DELETE} since
     * {@code V15} (ADR 0024 §4.5) — so a {@code null} on an expense row is only
     * reachable by direct SQL.
     *
     * <p>Mapped as a bare {@link UUID} rather than a {@code @ManyToOne}, for
     * the same reason {@link Category#getParentCategoryId()} is: nothing here
     * navigates the object graph (the snapshot columns are what render), and an
     * association would add a lazy proxy that earns its keep nowhere while
     * inviting exactly the live join this denormalization exists to avoid.
     */
    @Column(name = "category_id")
    private UUID categoryId;

    /**
     * <strong>Internal restore marker — never exposed in any API response or
     * sync payload</strong> ({@code V15__categories_soft_delete.sql},
     * ADR 0024 §6.2). The {@link #categoryId} this row carried immediately
     * before a category delete reassigned it to {@code Misc}; {@code null}
     * otherwise.
     *
     * <ul>
     *   <li><strong>Written</strong> only by
     *       {@code TransactionRepository#reassignToFallbackCategory}, in the
     *       same statement that moves the row to {@code Misc}.</li>
     *   <li><strong>Cleared</strong> by {@code TransactionService#updateTransaction}
     *       whenever a client write changes {@link #categoryId} — a user who
     *       re-tags a reassigned row has made a newer decision that a future
     *       restore must not undo.</li>
     *   <li><strong>Not touched</strong> by rename propagation, which never
     *       changes {@link #categoryId}.</li>
     * </ul>
     *
     * <p>A bare {@link UUID}, mapped exactly as {@link #categoryId} is. Covered
     * by {@code fk_transactions_reassigned_from_category_id} (no
     * {@code ON DELETE}); a violation is unreachable through the API and
     * surfaces as a logged {@code 500}. PostgreSQL orders {@code uuid} as
     * unsigned bytes and {@link UUID#compareTo} does not, so nothing may order
     * or compare by this value.
     */
    @Column(name = "reassigned_from_category_id")
    private UUID reassignedFromCategoryId;

    /** Snapshot — the <strong>leaf's own</strong> name, never a composed path. */
    @Column(name = "category_name", nullable = false, length = 100)
    private String categoryName;

    /**
     * Snapshot — the name of {@link #categoryId}'s parent at write time, or
     * {@code null} when the tagged category is top-level <strong>and</strong>
     * for every income row (ADR 0019 §5).
     *
     * <p>{@code null} for income is <em>not</em> an income special case: there
     * is no parent, for exactly the same reason a top-level expense has none.
     * A client composes {@code Food › Snacks} at render time from the two
     * names; the separator is a presentation choice and is deliberately never
     * frozen into financial history.
     */
    @Column(name = "parent_category_name", length = 100)
    private String parentCategoryName;

    /** Snapshot. */
    @Column(name = "category_icon_name", nullable = false, length = 100)
    private String categoryIconName;

    /** Snapshot. Column is {@code varchar(4)}, matching {@code categories.glyph}. */
    @Column(name = "category_glyph", nullable = false, length = 4)
    private String categoryGlyph;

    /**
     * Snapshot — the {@code IconBadge} tone vocabulary
     * ({@code 'neutral'|'accent'|'success'|'warning'|'negative'|'positive'}).
     *
     * <p><strong>Derived from {@link #type} and from nothing else</strong>
     * (ADR 0018 §3.3): {@code 'success'} for income, {@code 'neutral'} for
     * expense. It cannot come from the category, because
     * {@code CategoryResponse} carries no tone field — deliberately. Kept a
     * {@link String} rather than a fourth enum because this domain only ever
     * writes two of the six values and never branches on the stored one.
     */
    @Column(name = "category_tone", nullable = false, length = 20)
    private String categoryTone;

    @Column(name = "txn_date", nullable = false)
    private LocalDate txnDate;

    /**
     * The device wall-clock time at creation, supplied by the client because
     * the true creation moment may occur offline, long before the write reaches
     * the server (data-model.md §2.2).
     *
     * <p><strong>Frozen at creation</strong> — {@code PATCH /transactions/{id}}
     * does not accept it (api-overview.md §4.4, mirroring the frontend's own
     * "auto-captured... left untouched on every subsequent edit" rule).
     * {@code updatable = false} records that invariant in the mapping itself,
     * so even a stray setter call could not reach the database.
     */
    @Column(name = "txn_time", nullable = false, updatable = false)
    private LocalTime txnTime;

    /**
     * {@link BigDecimal} against a {@code numeric(12,2)} column — never
     * {@code double}/{@code Double}, which would defeat the exact-decimal
     * choice at the entity boundary while
     * {@code chk_transactions_cash_online_sum} compares exactly (data-model.md
     * Conventions; Database Architect, 2026-10-24). Always {@code > 0}; the
     * sign is carried by {@link #type}, never by the amount.
     */
    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "type", nullable = false, length = 10)
    private TransactionType type;

    /**
     * {@code 'personal'} | {@code 'group'}.
     *
     * <p><strong>{@code chk_transactions_group_id_matches_scope} ties this to
     * {@link #groupId}: {@code scope = 'group'} if and only if
     * {@code group_id IS NOT NULL}</strong> (Database Architect, 2026-10-24).
     * A {@code personal} row carrying a group id is refused by the database, and
     * so is a {@code group} row without one. The service rejects both before any
     * write, so the CHECK is a backstop rather than the error path.
     *
     * <p><strong>Both values are writable</strong> as of 2026-11-03 —
     * {@code group} requires a {@link #groupId} the caller is actually a member
     * of (see that field).
     */
    @Column(name = "scope", nullable = false, length = 10)
    private TransactionScope scope;

    /**
     * The group this transaction belongs to, or {@code null} for a personal one.
     * A plain nullable {@code uuid} rather than a {@code @ManyToOne}, for the
     * same reason {@link #categoryId} is: nothing here navigates the object
     * graph.
     *
     * <p><strong>{@code fk_transactions_group_id} exists</strong> — added by
     * {@code V10__groups.sql}, which discharged the debt
     * {@code V7__transactions.sql} recorded when {@code groups} did not yet
     * exist. V10 maps a violation of it to {@code 404 GROUP_NOT_FOUND}
     * (its contract item 1).
     *
     * <p><strong>Written by both {@code POST} and {@code PATCH /transactions}
     * as of 2026-11-03.</strong> Before that date nothing in Domain 4 wrote it:
     * {@code group_members} did not exist, so the membership check
     * api-overview.md §4.2 specifies was <em>vacuously false</em> and every
     * group-scoped write — a real member's included — was answered
     * {@code 403 NOT_GROUP_MEMBER}. That table is applied now and
     * {@code TransactionService#requireScopeAndGroupAgree} performs the real
     * check against it, so a member's group transaction is stored and a
     * non-member's is still that {@code 403}. The column having always been
     * mapped is why that fix touched one method and no mapping.
     *
     * <p>Note the shipped frontend's own precedent, which this must not break:
     * an <em>individual</em> split's consumption-share row is
     * {@code scope='personal'} with {@code groupId: null}. Group scope is not a
     * synonym for "came from a split".
     */
    @Column(name = "group_id")
    private UUID groupId;

    @Column(name = "payment_mode", nullable = false, length = 10)
    private PaymentMode paymentMode;

    /** Non-null if and only if {@link #paymentMode} is {@link PaymentMode#BOTH}. */
    @Column(name = "cash_amount", precision = 12, scale = 2)
    private BigDecimal cashAmount;

    /** Non-null if and only if {@link #paymentMode} is {@link PaymentMode#BOTH}. */
    @Column(name = "online_amount", precision = 12, scale = 2)
    private BigDecimal onlineAmount;

    /**
     * Set when this transaction is the caller's own consumption-share record
     * created from a split expense. Nullable {@code uuid}, covered by
     * {@code fk_transactions_split_expense_id} ({@code V11__split_expenses.sql},
     * the second half of V7's deferred-FK debt).
     *
     * <p><strong>Written only by {@code SplitExpenseService}, and no write path
     * in Domain 4 writes it</strong> — api-overview.md §4.2 says only a split
     * expense may set it, so neither {@code CreateTransactionRequest} nor
     * {@code UpdateTransactionRequest} carries the field. That is deliberate and
     * is unchanged by the 2026-11-03 group-membership fix.
     */
    @Column(name = "split_expense_id")
    private UUID splitExpenseId;

    /**
     * Free-text note. {@code text} in PostgreSQL with <strong>no length
     * cap</strong>, deliberately (Database Architect, 2026-10-24) — hence no
     * {@code length} here and no {@code @Size} on the request DTOs. Mapping it
     * as a bounded {@code varchar} is the silent mistake that instruction
     * exists to prevent.
     */
    @Column(name = "notes")
    private String notes;

    /**
     * A Cloudinary {@code public_id} — <strong>not a URL</strong>
     * (docs/decisions/0020-receipt-upload-cloudinary-signed-direct.md §3). It
     * cannot be navigated to or rendered; reading the asset needs a
     * short-lived signed delivery URL that only {@code GET /transactions/{id}}
     * mints, and only after its owner check has passed.
     *
     * <p>Generated server-side as {@code {root}/receipts/{user_id}/{uuid}} and
     * never client-chosen; the shape is re-checked against the caller's own id
     * on every write ({@code service/ReceiptPublicIdPolicy}). Covered by the
     * partial unique index {@code uq_transactions_receipt_public_id}, so one
     * asset belongs to exactly one transaction
     * ({@code 409 RECEIPT_ALREADY_ATTACHED}).
     *
     * <p><strong>Safe to log</strong> on its own — it grants nothing without a
     * signature (security-architecture.md §8).
     */
    @Column(name = "receipt_public_id", length = 255)
    private String receiptPublicId;

    /**
     * Client-generated id for idempotent offline-sync dedup on
     * {@code /sync/push} (data-model.md §2.2, security-architecture.md §9).
     *
     * <p>Accepted and stored by {@code POST /transactions} because the contract
     * lists it (api-overview.md §4.2) and the column exists, but
     * <strong>nothing in this domain deduplicates on it</strong>: idempotency is
     * specified for {@code /sync/push} (Domain 8, unbuilt) and the schema
     * carries no unique index on this column, so a race-safe dedup is not
     * expressible here. {@code updatable = false} — a record's provenance does
     * not change.
     */
    @Column(name = "client_id", updatable = false)
    private UUID clientId;

    /**
     * Optimistic concurrency (data-model.md §2.2). Starts at {@code 1} and is
     * incremented by exactly {@code 1} on every successful
     * {@code PATCH /transactions/{id}}; a stale value supplied by a client is
     * {@code 409 VERSION_CONFLICT} (api-overview.md §4.4).
     *
     * <p><strong>Deliberately a plain column, not a JPA {@code @Version}
     * field</strong> — a real decision, recorded because the opposite looks
     * more idiomatic:
     *
     * <ul>
     *   <li>The contract pins the <em>initial</em> value at {@code 1} and the
     *       column defaults to {@code 1}. A {@code @Version} field's seed is
     *       the provider's choice, and this project's entities use
     *       <em>assigned</em> ids, which makes Spring Data {@code merge} rather
     *       than {@code persist} (backend/README.md §3, point 5) — so whether a
     *       detached instance's version survives the merge is provider
     *       behaviour this session could not run. Setting the column explicitly
     *       removes that question entirely.</li>
     *   <li>The contract needs the <em>client's</em> submitted version compared
     *       to the stored one and answered with a specific error code.
     *       {@code @Version} expresses that as
     *       {@code ObjectOptimisticLockingFailureException} thrown at flush,
     *       which is a second translation layer for a check the service must
     *       make explicitly anyway.</li>
     *   <li>Race safety is provided instead by a {@code SELECT ... FOR UPDATE}
     *       on the write path's fetch
     *       ({@code TransactionRepository#findForUpdateByIdAndUserIdAndDeletedAtIsNull}),
     *       so the compare-then-increment is atomic rather than
     *       nearly-atomic.</li>
     * </ul>
     *
     * <p><strong>A soft delete does not bump it</strong> — see
     * {@code TransactionService#deleteTransaction}.
     */
    @Column(name = "version", nullable = false)
    private int version;

    /**
     * Soft delete (constitution §14): offline clients need deletes to
     * <em>propagate</em> through {@code /sync/pull}, not vanish. A non-null
     * value excludes the row from {@code GET /transactions} and
     * {@code GET /transactions/{id}} (api-overview.md §4).
     *
     * <p>The row keeps its {@link #receiptPublicId}, and therefore keeps the
     * Cloudinary asset: no write path in this phase destroys one (ADR 0020 §9).
     */
    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    /**
     * The LWW clock (ADR 0027 §5.1, V18): the effective timestamp of the last
     * applied <em>client-authored</em> create or update. Not {@code updated_at},
     * which server propagations bump. The bulk rename/reassignment statements in
     * {@code TransactionRepository} never set it. {@code NULL} loses to any
     * client write.
     */
    @Column(name = "last_client_write_at")
    private OffsetDateTime lastClientWriteAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
