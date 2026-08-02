package com.myexpense.backend.repository;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.Category;

import jakarta.persistence.LockModeType;

/**
 * Persistence only (constitution §9). Every method here is a Spring Data
 * derived query or JPQL with <strong>bound</strong> parameters — never
 * concatenated — and there is no native SQL and no dynamically-built query
 * anywhere in this domain (security-architecture.md §12).
 *
 * <p><strong>Every lookup takes {@code userId}.</strong> There is deliberately
 * no {@code findById(UUID)} usage in this domain's service: a category is
 * owner-scoped, so "fetch by id" must mean "fetch by id <em>belonging to the
 * caller</em>" or an id guessed from another account would be readable
 * (api-overview.md §3.3's owner-scoped convention,
 * security-architecture.md §2). <strong>That now includes resolving a
 * {@code parentCategoryId}</strong>: the parent is fetched through
 * {@link #findForShareByIdAndUserIdAndDeletedAtIsNull} like any other row, so a parent belonging to
 * someone else is indistinguishable from one that does not exist (404, never
 * 403 — ADR 0019 §7).
 *
 * <p><strong>Every method here states which LEVEL it means</strong> (ADR 0019
 * §1's honest cost, recorded rather than glossed): once
 * {@code parent_category_id} exists, "read the user's categories" is no longer
 * unambiguous. That burden is confined to this interface and
 * {@code CategoryService} — which is the mitigation the ADR relies on — and is
 * neutralized at the API boundary by the nested read shape, so no consumer
 * filters a flat list to find the level it wants.
 *
 * <p><strong>Every method here also states that it reads LIVE rows
 * only</strong> (ADR 0024 §4.2, {@code V15__categories_soft_delete.sql}).
 * A category delete is a soft delete ({@link #stampDeletedAt}), and a deleted
 * row must be indistinguishable from a non-existent one through the API. The
 * filter is <em>visible</em> rather than implicit, matching
 * {@code TransactionRepository}: derived methods carry {@code DeletedAtIsNull}
 * in their names and JPQL carries {@code c.deletedAt is null}. There is
 * deliberately no entity-level {@code @SQLRestriction}/{@code @SoftDelete}
 * (ADR 0024 §4.2). <strong>Review rule:</strong> a method here without the
 * filter is a defect unless its name says {@code DeletedAtIsNotNull} (a future
 * trash read, ADR 0024 §6) or its Javadoc says why.
 *
 * <p><strong>No SQL {@code DELETE} exists in this interface, and none may be
 * added</strong> (ADR 0024 §1, §4.3). The old {@code deleteByUserIdAndIdIn}
 * was removed, not left unused; {@code V15}'s trigger refuses every hard
 * {@code DELETE} on {@code categories} anyway, as a logged {@code 500}. Do not
 * call the inherited {@code delete*} methods of {@link JpaRepository}.
 */
public interface CategoryRepository extends JpaRepository<Category, UUID> {

    /**
     * {@code GET /api/v1/categories} — the caller's whole list,
     * <strong>both levels in one flat read</strong>.
     *
     * <p>Not paginated: the contract (api-overview.md §3.1) returns a plain
     * {@code CategoryResponse[]}, and the set is small and bounded in practice
     * (8 seeded defaults plus whatever the user adds by hand). Constitution
     * §11's pagination guidance is aimed at lists that grow without bound.
     *
     * <p>Ordering is {@code created_at} then {@code name} purely so the
     * response is deterministic — the contract specifies none. The 8 seeded
     * defaults are inserted in one transaction and can share a creation
     * instant, so in practice they come back name-ordered, with
     * later hand-created categories after them.
     *
     * <p><strong>Top-level rows and subcategories both come back here, and
     * that is deliberate</strong> (ADR 0019 follow-up item 3 — "one query, not
     * N+1"). The endpoint's response is a two-level tree, but it is assembled
     * in {@code CategoryService} from this single result set rather than by
     * fetching children per parent. A derived query cannot express
     * "parents, each with its children" anyway, and for a few dozen rows per
     * user an in-memory grouping is both simpler and strictly fewer round
     * trips (constitution §10 — avoid N+1; §11 — do not optimize past the
     * measured need).
     *
     * <p><strong>Live rows only</strong> (ADR 0024 §4.2). Also read by
     * {@code StatisticsService} for its category map, so a deleted category is
     * never emitted as a slice. A soft-deleted parent's children are
     * soft-deleted in the same instant, so this never returns a live child
     * whose parent is missing (the delete's post-condition and the
     * {@code FOR SHARE} parent fetch on subcategory create guarantee it).
     */
    List<Category> findByUserIdAndDeletedAtIsNullOrderByCreatedAtAscNameAsc(UUID userId);

    /**
     * Owner-scoped, <strong>live</strong> single fetch, with no lock — an id
     * belonging to another account, an unknown id and a soft-deleted id all
     * resolve to empty, i.e. one identical 404 (ADR 0024 §1.4).
     *
     * <p>Used where nothing is written that depends on the row staying live:
     * {@code GET /categories/{id}/usage}, and
     * {@code CategorySnapshotResolver#parentNameOf} (a display value only).
     * Every path that <em>stores</em> a reference to a category, or saves the
     * row itself, uses one of the two locking variants below instead.
     */
    Optional<Category> findByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    /**
     * The same owner-scoped live fetch, taking a <strong>write lock</strong>
     * ({@code SELECT ... FOR UPDATE}) — the {@code DELETE} target (ADR 0024
     * §4.3 step 1, §4.4) and the {@code PATCH} target.
     *
     * <p><strong>Why the delete locks.</strong> Under soft delete the self-FK
     * no longer fails loudly when a child is created under a parent that is
     * being deleted. The lock conflicts with the {@code FOR SHARE} that
     * {@link #findForShareByIdAndUserIdAndDeletedAtIsNull} takes for every write
     * storing a reference to this row (subcategory create, transaction and
     * split-expense category resolution, budget caps), so those writes and the
     * delete serialize: whichever commits first, the other sees its result.
     *
     * <p><strong>Why the PATCH locks.</strong> {@code PATCH} saves the loaded
     * entity, and Hibernate writes every mapped column, {@code deleted_at}
     * included. Without the lock a {@code PATCH} that read the row just before a
     * concurrent delete committed would write {@code deleted_at = NULL} back
     * and silently resurrect it. With the lock the {@code PATCH} waits, then
     * PostgreSQL re-evaluates {@code deleted_at IS NULL} against the committed
     * row (READ COMMITTED), finds nothing, and the {@code PATCH} is a
     * {@code 404}.
     *
     * <p>Spring Data ignores the text between {@code find} and {@code By}, so
     * this derives the same query as the plain fetch with a different lock
     * mode — the precedent is
     * {@code TransactionRepository#findForUpdateByIdAndUserIdAndDeletedAtIsNull}.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Category> findForUpdateByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    /**
     * LWW-mode {@code PATCH} only (ADR 0027 §5.2/§5.4): owner-scoped and
     * write-locked, <strong>including soft-deleted rows</strong>, so an update to
     * the caller's own deleted category is {@code 409 WRITE_SUPERSEDED}
     * (reason {@code deleted}) rather than {@code 404}. Never used by a read.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Category> findForUpdateByIdAndUserId(UUID id, UUID userId);

    /**
     * The same owner-scoped live fetch, taking a <strong>share lock</strong>
     * ({@code SELECT ... FOR SHARE}, {@link LockModeType#PESSIMISTIC_READ} on
     * PostgreSQL) — for every write that is about to store a reference to this
     * category (ADR 0024 §4.4).
     *
     * <p><strong>Required for subcategory create's parent fetch.</strong>
     * {@code FOR SHARE} conflicts with the delete's {@code FOR UPDATE}:
     * <ul>
     *   <li>if the delete wins, this statement waits, PostgreSQL re-evaluates
     *       the {@code WHERE} against the updated row under READ COMMITTED,
     *       finds {@code deleted_at} set and returns empty — so the create is
     *       {@code 404 PARENT_CATEGORY_NOT_FOUND};</li>
     *   <li>if the create wins, the delete waits for it to commit and then
     *       resolves the new child into its cascade.</li>
     * </ul>
     * Two concurrent creates under one parent both take {@code FOR SHARE} and
     * do not block each other.
     *
     * <p><strong>Also used, as ADR 0024 §4.4 recommends, by
     * {@code CategorySnapshotResolver}</strong> (transaction create/patch and
     * split-expense create), so a row stored between the delete's reassignment
     * and its soft delete can no longer point at a hidden category.
     *
     * <p>Must run inside a read-write transaction; every caller is one.
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    Optional<Category> findForShareByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    /**
     * The caller's <strong>live</strong> categories among {@code ids}, share-locked
     * ({@code FOR SHARE}) — {@code BudgetService#resolveCaps}' one read for a
     * whole {@code categoryCaps} array (ADR 0024 §4.2 and §4.4).
     *
     * <p>One query for the whole array, never one per entry (constitution §10).
     * An id that is unknown, another user's, or soft-deleted is simply absent
     * from the result, which the service answers with
     * {@code 404 CATEGORY_NOT_FOUND} — a deleted category is not cappable. The
     * share lock serializes the save with a concurrent delete of a capped
     * category, exactly as {@link #findForShareByIdAndUserIdAndDeletedAtIsNull}
     * does for a single row.
     *
     * <p>{@code ids} must be non-empty (an empty {@code IN} list is not valid
     * SQL); the caller skips the call for an empty caps array.
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    List<Category> findForShareByUserIdAndIdInAndDeletedAtIsNull(UUID userId, Collection<UUID> ids);

    /**
     * The live children of the {@code DELETE} target, write-locked
     * ({@code FOR UPDATE}), in id order — the cascade set for
     * {@code CategoryService#deleteCategory} (ADR 0024 §4.3 step 4).
     *
     * <p><strong>Why the children are locked as well as the target.</strong>
     * A transaction or split expense tagged to a <em>subcategory</em> share-locks
     * that subcategory, not its parent. Locking the children here, after the
     * target and before the reassignment UPDATEs, makes such a write and the
     * delete serialize too: the delete's reassignment then runs after the write
     * commits and sees its row, or the write waits and finds the subcategory
     * gone. The lock order is parent, then children by id — the same order on
     * every delete, so two deletes cannot deadlock each other on these rows.
     *
     * <p>Entities rather than an id projection only because a lock needs
     * entities to attach to; the caller reads the ids and nothing else. Used
     * only by the delete. The usage pre-flight and rename propagation keep the
     * lock-free {@link #findSubcategoryIds}.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    List<Category> findForUpdateByUserIdAndParentCategoryIdAndDeletedAtIsNullOrderByIdAsc(
            UUID userId, UUID parentCategoryId);

    /**
     * The children of one of the caller's categories, in the same
     * deterministic order as the list endpoint.
     *
     * <p>Used only by {@code PATCH /categories/{id}}, so the updated row's
     * response carries its real {@code subcategories} instead of an empty
     * array that would be a lie (and that a client writing the response into
     * its store would read as "this parent lost its children"). One extra
     * bounded query on a single-row update, and only when the updated row is
     * itself top-level — a subcategory's children are empty by the depth rule,
     * with no query needed to know it.
     *
     * <p><strong>Live children only</strong> (ADR 0024 §4.2): a soft-deleted
     * child is gone as far as the client is concerned, so echoing it in a
     * {@code PATCH} response would put it back into the client's store.
     */
    List<Category> findByUserIdAndParentCategoryIdAndDeletedAtIsNullOrderByCreatedAtAscNameAsc(
            UUID userId, UUID parentCategoryId);

    /**
     * How many <strong>live</strong> children a category has — the delete's
     * post-condition (ADR 0024 §4.3 step 8): after the cascade, this must be
     * {@code 0} for the target, or the whole delete rolls back. A live child
     * under a soft-deleted parent would be silently dropped by
     * {@code CategoryService#toTree}, so the user would lose sight of it.
     */
    long countByUserIdAndParentCategoryIdAndDeletedAtIsNull(UUID userId, UUID parentCategoryId);

    /**
     * Friendly pre-check for {@code 409 CATEGORY_NAME_ALREADY_EXISTS} when
     * creating a <strong>top-level</strong> category.
     *
     * <p><strong>Case-insensitive, and since ADR 0019 §3 also
     * parent-scoped.</strong> The rule is "unique among its siblings": a
     * top-level name conflicts only with other top-level names, which is why
     * this method carries {@code ParentCategoryIdIsNull} and why the old
     * unscoped {@code existsByUserIdAndNameIgnoreCase} was replaced rather
     * than kept — that one encoded a rule the contract no longer has, and
     * would have rejected a top-level {@code Snacks} merely because
     * {@code Food › Snacks} exists.
     *
     * <p>It matches the partial unique index
     * {@code uq_categories_user_lower_name_top_level} on
     * {@code (user_id, lower(name)) WHERE parent_category_id IS NULL}, which
     * supersedes V4's unpartitioned {@code uq_categories_user_id_lower_name}.
     * <strong>Case-insensitivity is not relaxed by that change</strong> — only
     * the key's scope changed. {@code Food} and {@code food} still cannot
     * coexist at either level, which is the whole of ADR 0018 §6 and is what
     * keeps this check in agreement with the frontend's own
     * {@code utils/categories.js#isDuplicateCategoryName}.
     *
     * <p>{@code IgnoreCase} makes Spring Data fold the case of both sides with
     * the value still bound, never concatenated
     * (security-architecture.md §12). {@code ParentCategoryIdIsNull} binds
     * nothing at all, so this method takes the same two arguments it always
     * did.
     *
     * <p><strong>One correction to the Database Architect's 2026-10-21
     * handoff note, flagged rather than quietly absorbed.</strong> That note
     * said this renders as {@code lower(name) = lower(?)}, i.e. byte-identical
     * to the index expression so the planner could use the index for this
     * pre-check. Spring Data JPA's own keyword table documents
     * {@code IgnoreCase} as rendering <strong>{@code UPPER(x.name) =
     * UPPER(?1)}</strong>, not {@code lower}. Nothing about this domain's
     * behaviour depends on which one it is:
     * <ul>
     *   <li>the pre-check is case-insensitive either way, which is all
     *       ADR 0018 §6 requires of it;</li>
     *   <li>the index — not this query — is the guarantee, and its violations
     *       still map to {@code 409} by constraint name;</li>
     *   <li>the planner can still use the index's {@code user_id} leading
     *       column, and this table holds single digits of rows per user, so
     *       the lost expression match is not a measurable cost
     *       (constitution §11).</li>
     * </ul>
     * The one real consequence is that an exotic Unicode pair whose
     * {@code upper} and {@code lower} foldings disagree could be judged
     * differently by this check and by the index. That is a smaller version of
     * the client/server case-folding caveat ADR 0018 §6 already records and
     * accepts, and it resolves the same way: <strong>the index wins</strong>,
     * and a violation it raises is still a clean {@code 409}, never a
     * {@code 500}. Do not "fix" this with a hand-written {@code @Query} — a
     * derived query was specified, and no derived keyword renders
     * {@code lower}.
     *
     * <p>Still whitespace-sensitive: the service trims before comparing and
     * storing, so trailing-space near-duplicates cannot be created. The index,
     * not this query, is the real guarantee — two concurrent creates can both
     * pass this check.
     *
     * <p><strong>Live rows only — and this is the filter most likely to be
     * missed</strong> (ADR 0024 §4.2). Since {@code V15} the index carries
     * {@code AND deleted_at IS NULL}, so a deleted {@code Food} no longer holds
     * its name. If this pre-check still counted deleted rows, deleting
     * {@code Food} and creating {@code Food} again would be a {@code 409} from
     * the service even though the database would accept it — the "can never
     * re-create Food" bug, moved up a layer. The same holds for the three
     * sibling pre-checks below.
     */
    boolean existsByUserIdAndParentCategoryIdIsNullAndNameIgnoreCaseAndDeletedAtIsNull(UUID userId, String name);

    /**
     * The sibling pre-check for creating a <strong>subcategory</strong>:
     * "does this parent already have a child with this name, folding case".
     *
     * <p>Matches the second partial unique index,
     * {@code uq_categories_user_parent_lower_name} on
     * {@code (user_id, parent_category_id, lower(name))
     * WHERE parent_category_id IS NOT NULL}. Scoping by {@code parent_category_id}
     * is what makes {@code Food › Snacks} and {@code Transport › Snacks} both
     * creatable (ADR 0019 §3) while {@code Food › Snacks} and
     * {@code Food › snacks} still conflict.
     *
     * <p>{@code parentCategoryId} must be non-null here. A {@code null} would
     * render as {@code parent_category_id = null}, which is never true in SQL,
     * so this method would quietly answer "no conflict" for every top-level
     * name — the top-level path uses
     * {@link #existsByUserIdAndParentCategoryIdIsNullAndNameIgnoreCaseAndDeletedAtIsNull}
     * instead, and {@code CategoryService} chooses between the two explicitly
     * rather than passing a possibly-null id to one of them.
     *
     * <p>Live rows only (ADR 0024 §4.2): a deleted {@code Food › Snacks}
     * does not block a new one.
     */
    boolean existsByUserIdAndParentCategoryIdAndNameIgnoreCaseAndDeletedAtIsNull(
            UUID userId, UUID parentCategoryId, String name);

    /**
     * The same sibling pre-check for updating a <strong>top-level</strong>
     * category: "is this name already used by a <em>different</em> top-level
     * category of mine", so re-submitting a category's own current name is
     * never a conflict — and neither is re-casing it ({@code Food} →
     * {@code food} on the same row), because {@code IdNot} excludes that row
     * here exactly as the index excludes it when the row is replaced.
     *
     * <p>Live rows only (ADR 0024 §4.2): renaming {@code Groceries} to the
     * name of a deleted {@code Food} is allowed.
     */
    boolean existsByUserIdAndParentCategoryIdIsNullAndNameIgnoreCaseAndIdNotAndDeletedAtIsNull(
            UUID userId, String name, UUID id);

    /**
     * The same sibling pre-check for updating a <strong>subcategory</strong> —
     * compared only against the children of its own parent, and excluding
     * itself so a rename-to-own-name and a self-recase both stay 200s.
     *
     * <p>Note the argument order follows the method name, so
     * {@code parentCategoryId} comes before {@code name}.
     *
     * <p>Live rows only (ADR 0024 §4.2).
     */
    boolean existsByUserIdAndParentCategoryIdAndNameIgnoreCaseAndIdNotAndDeletedAtIsNull(
            UUID userId, UUID parentCategoryId, String name, UUID id);

    /**
     * <strong>The caller's protected category</strong> — the reassignment
     * target {@code DELETE /api/v1/categories/{id}} moves transactions to
     * (api-overview.md §3.4, ADR 0021 §2.1,
     * {@code V8__categories_misc_fallback.sql}'s CONTRACT item 2).
     *
     * <p><strong>This is the one rule in this domain that must not be
     * reinterpreted:</strong> the row is found by
     * {@code WHERE user_id = :userId AND is_protected} — <strong>never by the
     * name {@code Misc}, never by {@code is_default}, never by a well-known
     * id.</strong> Nothing in this system resolves a category by name
     * (ADR 0018 §5), names are unique only case-insensitively and only within a
     * parent, a user may already own a category called {@code misc}, and names
     * are mutable while identity must not be — a name-matched target would be
     * hijackable by a rename, which (after ADR 0021 §1) would then propagate
     * into transaction history. {@code is_default} cannot do the job either: it
     * is {@code true} for all eight seeded rows and is explicitly
     * informational.
     *
     * <p><strong>{@link Optional} rather than a {@link List}, and that is
     * structural.</strong> The partial unique index
     * {@code uq_categories_user_protected} on
     * {@code (user_id) WHERE is_protected} guarantees <em>at most</em> one row,
     * so this cannot return two and the service never has to choose between
     * candidates under concurrency. "At least one" comes from the registration
     * seed ({@code DefaultCategoryCatalog}'s 8th entry) and, for accounts that
     * predate it, from {@code V8}'s STEP 5 backfill plus its STEP 7 assertion.
     *
     * <p><strong>An empty result is a broken invariant, not a repair path.</strong>
     * {@code CategoryService} resolves this row and <strong>must never create
     * it</strong> (ADR 0021, "Existing data"): a get-or-create inside a delete
     * transaction would put schema-invariant repair on a user-facing financial
     * write path. Absence is an honest {@code 500}.
     *
     * <p>Derived as {@code ...ProtectedCategoryIsTrue} because the entity field
     * is {@code Category.protectedCategory} ({@code protected} being a Java
     * keyword), mapped to {@code is_protected}.
     *
     * <p><strong>The LIVE protected row</strong> (ADR 0024 §4.1/§4.2):
     * {@code WHERE user_id = :userId AND is_protected AND deleted_at IS NULL},
     * which matches {@code V15}'s predicate on
     * {@code uq_categories_user_protected} exactly, so "the protected row" means
     * one thing in the index, here and in the invariant. The filter cannot
     * change the result today — {@code chk_categories_protected_not_deleted}
     * stops the protected row ever being soft-deleted — and is carried anyway
     * for that one definition.
     */
    Optional<Category> findByUserIdAndProtectedCategoryIsTrueAndDeletedAtIsNull(UUID userId);

    /**
     * The ids of one of the caller's categories' <strong>live</strong>
     * children — the roll-up set that {@code GET /categories/{id}/usage} (§3.5)
     * counts and that rename propagation's second UPDATE targets (§3.3).
     * {@code DELETE /categories/{id}} resolves the same set through
     * {@link #findForUpdateByUserIdAndParentCategoryIdAndDeletedAtIsNullOrderByIdAsc},
     * which is this query plus a row lock (ADR 0024 §4.4).
     *
     * <p><strong>{@code c.deletedAt is null}</strong> (ADR 0024 §4.2): a
     * soft-deleted child is not part of the category any more. Its
     * transactions were already reassigned to {@code Misc} when it was deleted,
     * so counting or re-propagating it would be wrong, and it would inflate
     * §3.5's {@code subcategoryCount}.
     *
     * <p><strong>Ids only, in one query</strong> (ADR 0019 §5, constitution §10
     * — no N+1). Both use sites reach it through one service helper
     * ({@code CategoryService#subcategoryIdsOf}) and need a set of ids to bind
     * into a predicate, not entities: nothing reads a child's name, cap or
     * timestamps, so loading whole rows into the persistence context would be
     * wasted work.
     *
     * <p>A scalar projection needs JPQL: no derived-query keyword selects a
     * single column. The parameters are still bound, never concatenated
     * (security-architecture.md §12).
     *
     * <p>Owner-scoped like everything else here, even though
     * {@code fk_categories_parent_category_id} is composite
     * ({@code (user_id, parent_category_id) → (user_id, id)}) and therefore
     * already guarantees a child shares its parent's owner. The predicate is
     * kept because this set goes on to drive a bulk {@code UPDATE} on financial
     * data, which is where an unscoped {@code WHERE} is most expensive to get
     * wrong.
     */
    @Query("""
            select c.id from Category c
             where c.userId = :userId
               and c.parentCategoryId = :parentCategoryId
               and c.deletedAt is null
            """)
    List<UUID> findSubcategoryIds(
            @Param("userId") UUID userId, @Param("parentCategoryId") UUID parentCategoryId);

    /**
     * <strong>The soft delete</strong> — stamps {@code deleted_at} and
     * {@code updated_at} with one instant on the named live rows, owner-scoped,
     * and returns <strong>how many rows it actually stamped</strong>
     * (ADR 0024 §4.3 step 7). This replaces the hard
     * {@code deleteByUserIdAndIdIn}, which was removed: no category row is ever
     * hard-deleted (Project Owner, 2026-11-03), and {@code V15}'s trigger
     * refuses any {@code DELETE} on this table.
     *
     * <p><strong>Called twice per delete with the SAME {@code deletedAt}:</strong>
     * the subcategory ids first, then the target id on its own. The shared
     * instant is load-bearing — a future restore identifies "this category plus
     * exactly the children deleted with it" by
     * {@code deleted_at = <target's deleted_at>} (ADR 0024 §6.1), which is why
     * the caller captures the instant once and passes it to both calls. Do not
     * read the clock inside this method.
     *
     * <p><strong>By id, never by {@code parent_category_id}</strong>, and
     * scoped {@code user_id = :userId AND deleted_at IS NULL}. The caller
     * compares the returned count with the number of ids it resolved and rolls
     * back on a mismatch (ADR 0021 §2.4's rule, carried over). The
     * {@code deleted_at IS NULL} conjunct also means a row deleted concurrently
     * is not re-stamped with a later instant, which would split one deletion
     * into two for restore.
     *
     * <p><strong>{@code updated_at} is set explicitly</strong>, to the same
     * instant: a bulk JPQL update bypasses {@code @UpdateTimestamp}, and
     * {@code updated_at} is the sync cursor that will carry the tombstone
     * (ADR 0024 §1.3, §4.7). There is no {@code version} on this table.
     *
     * <p>A bulk update bypasses the persistence context: hence
     * {@code flushAutomatically} (any pending category write reaches the
     * database first) and {@code clearAutomatically} (no managed
     * {@code Category} may survive with a stale {@code deleted_at = null} that
     * a later save could write back). The caller must read anything it still
     * needs off its entities <em>before</em> calling this.
     *
     * <p>Named {@code stamp...} rather than {@code softDeleteBy...} so that a
     * search for {@code deleteBy} (ADR 0024 follow-up item 9) finds only the
     * one exempt hard delete in the backend.
     *
     * <p>Every {@code BEFORE UPDATE} trigger on this table lets it through:
     * {@code trg_categories_enforce_protection} exits early for an ordinary
     * row, and {@code trg_categories_enforce_depth_one} finds the parent still
     * top-level. A protected row would be refused by
     * {@code chk_categories_protected_not_deleted} ({@code 23514}, a logged
     * {@code 500}); the service refuses it first with
     * {@code 400 CATEGORY_PROTECTED}.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update Category c
               set c.deletedAt = :deletedAt,
                   c.updatedAt = :deletedAt
             where c.userId = :userId
               and c.id in :categoryIds
               and c.deletedAt is null
            """)
    int stampDeletedAt(
            @Param("userId") UUID userId,
            @Param("categoryIds") Collection<UUID> categoryIds,
            @Param("deletedAt") OffsetDateTime deletedAt);
}
