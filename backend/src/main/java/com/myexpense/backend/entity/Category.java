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
 * Maps to the {@code categories} table (docs/architecture/data-model.md §2.1,
 * database/migrations/V3__categories.sql, as amended by
 * {@code V4__categories_case_insensitive_name.sql},
 * {@code V6__categories_subcategories.sql},
 * {@code V8__categories_misc_fallback.sql} and
 * {@code V15__categories_soft_delete.sql}).
 *
 * <p>Categories are <strong>per-user</strong>, not a global lookup table:
 * {@code user_id} is a real column on every row, and a name is unique — case
 * insensitively — only within one user's list, and (since ADR 0019 §3) only
 * among one parent's children. Two partial unique indexes enforce that,
 * replacing V4's single functional index; both names are listed on
 * {@code CategoryService.UNIQUE_NAME_CONSTRAINTS}. Every query in
 * {@code CategoryRepository} is filtered by the authenticated principal's id
 * for that reason (security-architecture.md §2).
 *
 * <p><strong>A subcategory is a row in this same table</strong> (ADR 0019 §1):
 * {@link #parentCategoryId} is the only thing that distinguishes one, and
 * exactly one level is allowed — a row with a parent can never itself be a
 * parent (§2). A subcategory is otherwise an ordinary, fully mutable,
 * user-owned expense category.
 *
 * <p><strong>Every row here is an expense category</strong> (ADR 0018 §1).
 * Income is not a category: {@code transactions.type} is the discriminator, an
 * income transaction carries {@code category_id = NULL} with its display
 * values taken from {@code service/IncomeCategorySnapshot}, and this entity
 * deliberately carries no {@code isIncome}/{@code kind}/{@code slug} marker
 * (ADR 0018 §4 — the table has no column for one either).
 *
 * <p>The primary key is application-assigned ({@link UUID#randomUUID()} in the
 * service layer) rather than relying on the column's {@code gen_random_uuid()}
 * default — the same convention {@link User} already uses.
 *
 * <p><strong>No currency field, deliberately.</strong> {@code monthlyCap} is a
 * plain amount in the one unit of account; currency is a display symbol only
 * and {@code users.default_currency_code} is the single currency column in the
 * whole schema (data-model.md §1.1,
 * docs/decisions/0017-per-currency-balances-and-partial-settlement.md's Scope
 * Narrowing banner). Do not add one here.
 *
 * <p>{@code monthlyCap} is {@link BigDecimal} against a
 * {@code numeric(12,2)} column — never {@code double} (data-model.md's
 * Conventions section). {@code null} is a real, distinct state meaning "no
 * cap"; it must never be collapsed to {@code BigDecimal.ZERO}, which the
 * database's own {@code chk_categories_monthly_cap_positive} would reject
 * anyway.
 *
 * <p>{@code created_at}/{@code updated_at} are maintained by Hibernate
 * ({@link CreationTimestamp}/{@link UpdateTimestamp}) — the schema has no
 * trigger for them, consistent with V1/V2, and a stale {@code updated_at}
 * would undermine the last-write-wins sync story (constitution §14).
 */
@Entity
@Table(name = "categories")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class Category {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Owner. Never settable from a request body — it comes from the JWT principal. */
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "icon_name", nullable = false, length = 100)
    private String iconName;

    /**
     * Column is {@code varchar(4)}; the API contract (api-overview.md §3.2)
     * is stricter at 1–2 characters and is enforced at the DTO layer. A
     * stricter API rule over a looser column is intentional.
     */
    @Column(name = "glyph", nullable = false, length = 4)
    private String glyph;

    /**
     * {@code null} means "no cap" — a real state, not a missing value.
     *
     * <p><strong>Top-level rows only</strong> since ADR 0019 §4: a row with a
     * {@link #parentCategoryId} must carry {@code null} here, which the
     * database also enforces
     * ({@code chk_categories_subcategory_has_no_cap}). A parent's cap is
     * evaluated <em>inclusive</em> of its children's spending, so a per-child
     * cap would be a second, undecided arithmetic — deliberately deferred,
     * not designed.
     */
    @Column(name = "monthly_cap", precision = 12, scale = 2)
    private BigDecimal monthlyCap;

    /**
     * {@code null} = this is a top-level category. Non-null = this row is a
     * <strong>subcategory</strong> of that row (data-model.md §2.1, ADR 0019
     * §1/§2).
     *
     * <p>Mapped as a bare {@link UUID}, not a {@code @ManyToOne} association,
     * for the same reason {@link #userId} is: nothing in this domain needs to
     * navigate the object graph (the tree is assembled from one flat read in
     * {@code CategoryService}), and an association would add a lazy proxy that
     * earns its keep nowhere. It would also be a poor fit for the actual
     * constraint, which is <em>composite</em> —
     * {@code (user_id, parent_category_id) → (user_id, id)}, backed by
     * {@code UNIQUE (user_id, id)} — because "the parent is owned by the same
     * user" is the point of the foreign key, not an afterthought. Postgres
     * {@code MATCH SIMPLE} skips that check whenever any column of the key is
     * {@code NULL}, so a top-level row passes freely.
     *
     * <p><strong>Never settable from a request body on update.</strong>
     * {@code CreateCategoryRequest} carries it (optional); {@code
     * UpdateCategoryRequest} deliberately does not, and must not gain it — a
     * row's level is fixed at creation and there is no move/promote/demote in
     * this round (ADR 0019 §9, api-overview.md §3.3).
     *
     * <p>{@code updatable = false} records that invariant in the mapping
     * itself: even a stray {@code setParentCategoryId(...)} could not reach
     * the database through this entity.
     */
    @Column(name = "parent_category_id", updatable = false)
    private UUID parentCategoryId;

    /**
     * {@code true} only for the 8 rows seeded at registration
     * ({@code DefaultCategoryCatalog}). Informational — it does not make a row
     * immutable (api-overview.md §3.3 allows renaming/re-capping any category
     * the caller owns) — and it is never settable through the API: a
     * client-created category is always {@code false}.
     *
     * <p><strong>Not a way to find the protected row</strong> — see
     * {@link #protectedCategory}. All eight seeded rows carry this flag, and
     * {@code V8}'s own STEP 4 allows a hand-promoted row that carries
     * {@code is_protected} <em>without</em> {@code is_default}, so the two are
     * not even guaranteed co-extensive.
     *
     * <p>Named {@code defaultCategory} rather than following {@link User}'s
     * {@code is_premium} → {@code premium} convention only because
     * {@code default} is a Java keyword.
     */
    @Column(name = "is_default", nullable = false)
    private boolean defaultCategory;

    /**
     * {@code true} on <strong>exactly one row per user</strong> — the seeded
     * {@code Misc} category, which is
     * {@code DELETE /api/v1/categories/{id}}'s reassignment target
     * (database/migrations/V8__categories_misc_fallback.sql, ADR 0021 §2.1,
     * data-model.md §2.1).
     *
     * <p>It means <em>one</em> thing: <strong>this row may not be renamed and
     * may not be deleted.</strong> It is otherwise an ordinary category —
     * selectable, cappable, re-iconable, and it may receive subcategories. A
     * <em>mutability policy</em>, not a semantic marker: it does not say what
     * the row <em>is</em> (every row here is still an expense category and
     * {@code transactions.type} is still the sole money-direction
     * discriminator), which is why it narrows ADR 0018 §4's "fully mutable"
     * wording without reopening its ban on
     * {@code isIncome}/{@code kind}/{@code slug}/{@code tone}.
     *
     * <p><strong>This column is the ONLY way the protected row is found</strong>
     * — {@code WHERE user_id = :callerId AND is_protected}, never by the name
     * {@code Misc}, never by {@code is_default}, never by a well-known id
     * (ADR 0018 §5: nothing in this system resolves a category by name).
     * {@code CategoryService} does that lookup in exactly one place; see its
     * {@code resolveProtectedCategory}.
     *
     * <p>Mapped as a primitive {@code boolean} because the column is
     * {@code BOOLEAN NOT NULL DEFAULT FALSE} — there is no third state. It is
     * <strong>never a request field</strong> on any endpoint: only the
     * registration seed sets it, and {@code V8}'s
     * {@code trg_categories_enforce_protection} additionally refuses to let an
     * {@code UPDATE} clear it (which would otherwise make "unprotect, then
     * delete" a two-statement bypass).
     *
     * <p>Named {@code protectedCategory} for the same reason
     * {@link #defaultCategory} is named that way: {@code protected} is a Java
     * keyword.
     */
    @Column(name = "is_protected", nullable = false)
    private boolean protectedCategory;

    /**
     * <strong>Soft delete</strong> ({@code V15__categories_soft_delete.sql},
     * ADR 0024 §1/§4). {@code null} = live; non-null = the UTC instant the
     * user deleted this row. The same shape as {@code Transaction.deletedAt}.
     *
     * <p><strong>A category is never hard-deleted</strong> (Project Owner,
     * 2026-11-03). {@code DELETE /categories/{id}} stamps this column — and
     * {@code updated_at}, to the <em>same</em> instant — on the target and on
     * every subcategory it cascades to, through
     * {@code CategoryRepository#stampDeletedAt}. That one shared instant is what
     * a future restore uses to identify one deletion as a unit (ADR 0024 §6.1),
     * so it must never be written per row. {@code version} does not exist on
     * this table, so there is nothing else to leave alone.
     *
     * <p><strong>Every read filters it</strong> — by name ({@code ...DeletedAtIsNull})
     * on derived queries and by {@code c.deletedAt is null} in JPQL (ADR 0024
     * §4.2's review rule). There is deliberately no entity-level
     * {@code @SQLRestriction}/{@code @SoftDelete}: {@code transactions} filters
     * explicitly and so does this table (ADR 0024 §4.2).
     *
     * <p>Never written through an entity save: no service sets it on a loaded
     * instance, and every path that saves a loaded {@code Category}
     * ({@code PATCH}) first takes a write lock on a <em>live</em> row, so a
     * stale instance cannot write {@code NULL} back over a concurrent delete.
     * Never exposed in any response DTO; the sync tombstone shape is Domain 8's
     * to design (ADR 0024 §4.7).
     *
     * <p>{@code chk_categories_protected_not_deleted} refuses a non-null value
     * on the protected row ({@code 23514}, a logged {@code 500}); the service
     * refuses it first with {@code 400 CATEGORY_PROTECTED}.
     */
    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    /**
     * The LWW clock (ADR 0027 §5.1, V18) — set only by an applied client create
     * or {@code PATCH}. {@code stampDeletedAt} and every propagation leave it.
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
