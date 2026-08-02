package com.myexpense.backend.service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.hibernate.exception.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.CreateCategoryRequest;
import com.myexpense.backend.dto.request.UpdateCategoryRequest;
import com.myexpense.backend.dto.response.CategoryDeletionResponse;
import com.myexpense.backend.dto.response.CategoryResponse;
import com.myexpense.backend.dto.response.CategoryUsageResponse;
import com.myexpense.backend.entity.Category;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.exception.CategoryNameAlreadyExistsException;
import com.myexpense.backend.exception.IdConflictException;
import com.myexpense.backend.exception.CategoryNotFoundException;
import com.myexpense.backend.exception.CategoryProtectedException;
import com.myexpense.backend.exception.ParentCategoryNotFoundException;
import com.myexpense.backend.exception.SubcategoryCapNotSupportedException;
import com.myexpense.backend.exception.SubcategoryDepthExceededException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.CategoryRepository;
import com.myexpense.backend.repository.EntityInserter;
import com.myexpense.backend.repository.SplitExpenseRepository;
import com.myexpense.backend.repository.TransactionRepository;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.sync.ChangeLogEntityTypes;
import com.myexpense.backend.sync.ChangeSets;
import com.myexpense.backend.sync.ClientIds;
import com.myexpense.backend.sync.IdempotentWriteExecutor;
import com.myexpense.backend.sync.LastWriteWins;
import com.myexpense.backend.sync.WriteContext;
import com.myexpense.backend.sync.WriteResult;

import tools.jackson.databind.ObjectMapper;

/**
 * Business rules for the Categories domain (api-overview.md §3.1–§3.5), plus
 * the registration-time seeding of the 8 defaults
 * ({@link DefaultCategoryCatalog}, data-model.md §2.1, ADR 0018 §2 and
 * ADR 0021 §2.1).
 *
 * <p>Every method takes the authenticated {@code userId} and scopes every read
 * and write to it — there is no method here that can address another user's
 * category. The id is resolved from the JWT by {@code @CurrentUserId} in the
 * controller and passed straight through (security-architecture.md §2). A
 * category id that belongs to someone else is indistinguishable from one that
 * does not exist: both are {@code 404 CATEGORY_NOT_FOUND}, never a 403, so a
 * non-owner learns nothing about whether the id is real. <strong>The same
 * applies to a create request's {@code parentCategoryId}</strong>, which
 * resolves to {@code 404 PARENT_CATEGORY_NOT_FOUND} when it names another
 * user's row (ADR 0019 §7).
 *
 * <p><strong>One optional level of subcategories, since 2026-10-22</strong>
 * (ADR 0019). This class is where the level distinction lives: a subcategory
 * is an ordinary {@code categories} row with a {@code parentCategoryId}, and
 * the three endpoints' shapes changed around that one column. Four rules are
 * enforced here, all of them before anything is written:
 * <ol>
 *   <li>a {@code monthlyCap} may not accompany a {@code parentCategoryId},
 *       and may not be set on a row that has a parent (§4);</li>
 *   <li>a {@code parentCategoryId} must resolve to a row owned by the caller
 *       (§7);</li>
 *   <li>that row must itself be top-level — <strong>exactly one level, and
 *       this check is mandatory regardless of whether the database also adds a
 *       trigger</strong> (§2);</li>
 *   <li>a name is unique, case-insensitively, <strong>among its
 *       siblings</strong> — top-level names among top-level names, a child's
 *       name among its own parent's children (§3).</li>
 * </ol>
 *
 * <p><strong>{@code user_settings.subcategories_enabled} is never read
 * here, deliberately</strong> (ADR 0019 §6.1). It is a client affordance, not
 * an authorization rule: {@code POST} accepts a parent whether the flag is on
 * or off, and {@code GET} always returns the complete tree. Adding a read of
 * it would make a response shape depend on a preference the calling screen may
 * not have loaded yet, which is a race with no upside. Do not add one.
 *
 * <p><strong>Since 2026-10-25 this class also writes to
 * {@code transactions}</strong> (ADR 0021, api-overview.md §3.3/§3.4/§3.5) —
 * three bulk statements on {@link TransactionRepository}, and that is the one
 * genuinely surprising thing about this file:
 * <ul>
 *   <li><strong>a rename PROPAGATES.</strong> {@code PATCH} refreshes the
 *       category snapshot on that category's transactions (UPDATE 1) and the
 *       <em>parent</em> name on its children's transactions (UPDATE 2). This
 *       deliberately reverses ADR 0018's "a rename must never rewrite
 *       transaction history" by Project Owner ruling; the snapshot columns
 *       stay, and what changed is that they are now "frozen until the category
 *       itself changes" rather than frozen forever. <em>Any test asserting the
 *       OLD name survives a rename is inverted.</em></li>
 *   <li><strong>a delete REASSIGNS</strong> every affected transaction — and,
 *       since ADR 0024 §4.8, every split expense the caller created — to the
 *       caller's protected {@code Misc} row, and then
 *       <strong>soft-deletes</strong> the category, cascading to its
 *       subcategories (ADR 0024: nothing is ever hard-deleted).</li>
 * </ul>
 *
 * <p><strong>Since 2026-11-03 every read here is of LIVE rows only</strong>
 * (ADR 0024 §4.2, {@code V15__categories_soft_delete.sql}). A soft-deleted
 * category is indistinguishable from a non-existent one: {@code GET} omits it,
 * {@code PATCH}/usage/{@code DELETE} answer {@code 404}, a new subcategory
 * cannot be created under it, and its name is free to reuse at once — the
 * four sibling-name pre-checks filter {@code deleted_at IS NULL} exactly as the
 * partial unique indexes do.
 * {@link TransactionRepository} is injected rather than
 * {@code TransactionService} on purpose: these are category-domain business
 * rules that happen to write denormalized columns on another table, and routing
 * them through that service would add three pass-through methods carrying no
 * logic of their own while coupling two services (constitution §5 allows a
 * business-layer class to use more than one repository; it does not ask for a
 * service-to-service hop).
 *
 * <p><strong>The protected {@code Misc} row is resolved in exactly ONE place —
 * {@link #resolveProtectedCategory}</strong> — and by
 * {@code user_id = :callerId AND is_protected} only: never by name, never by
 * {@code is_default}, never by a well-known id (ADR 0018 §5, ADR 0021 §2.1,
 * {@code V8}'s CONTRACT item 2). One site rather than two is the whole
 * mitigation: a second implementation of this lookup is how a by-name match
 * creeps back in. That method also never <em>creates</em> the row — its absence
 * is a broken schema invariant and an honest {@code 500}.
 *
 * <p><strong>No {@code noRollbackFor} anywhere in this class, re-checked
 * against the ADR 0021 changes rather than assumed — and the delete path was
 * checked specifically, because it is the first method here that writes before
 * it could throw.</strong> backend/README.md §3 records how that trap silently
 * broke account lockout and token-family revocation in Domain 1: a method that
 * writes and <em>then</em> throws needs the rollback suppressed on every
 * transactional boundary in the call chain. Nothing here needs that:
 * <ul>
 *   <li>{@code createCategory}/{@code updateCategory} decide every rejection
 *       <em>before</em> mutating anything — including all four subcategory
 *       rules above and {@code CATEGORY_PROTECTED}, which is why
 *       {@code updateCategory} keeps its two explicit phases and why the cap
 *       and protection rules are evaluated inside phase 1 rather than next to
 *       the assignments they guard;</li>
 *   <li>{@link #deleteCategory} decides <em>both</em> of its user-facing
 *       errors — {@code 404 CATEGORY_NOT_FOUND} and
 *       {@code 400 CATEGORY_PROTECTED} — and resolves the reassignment target
 *       before the first write. After the reassigning UPDATEs it can still
 *       throw, but only {@link IllegalStateException} on a broken invariant
 *       (the soft delete stamped a different number of rows than were
 *       resolved, or a live child survived under the deleted target), and
 *       <strong>for that case a rollback is exactly what must happen</strong>:
 *       the whole operation is one transaction and a partial delete would
 *       leave transactions pointing at {@code Misc} while their category is
 *       still live. Suppressing the rollback there would be the bug, not the
 *       fix;</li>
 *   <li>{@link #persist} translates a unique-constraint violation into a 409
 *       <em>after</em> a failed flush — the write never landed, so rolling
 *       back is correct;</li>
 *   <li>{@link #seedDefaultsFor} writes and never throws deliberately; if it
 *       fails, rolling the whole registration back is the intended outcome
 *       (see that method's own Javadoc).</li>
 * </ul>
 * Re-check this if a future change here adds an audit row or a counter that
 * must survive a rejection.
 */
@Service
public class CategoryService {

    private static final Logger log = LoggerFactory.getLogger(CategoryService.class);

    /**
     * The <strong>two</strong> partial unique indexes that enforce
     * "a name is unique, case-insensitively, among its siblings"
     * (ADR 0019 §3), both of which must map to the one
     * {@code 409 CATEGORY_NAME_ALREADY_EXISTS}:
     *
     * <ul>
     *   <li>{@code uq_categories_user_lower_name_top_level} —
     *       {@code (user_id, lower(name)) WHERE parent_category_id IS NULL}</li>
     *   <li>{@code uq_categories_user_parent_lower_name} —
     *       {@code (user_id, parent_category_id, lower(name))
     *       WHERE parent_category_id IS NOT NULL}</li>
     * </ul>
     *
     * <p><strong>This was a single constant until 2026-10-22</strong>
     * ({@code uq_categories_user_id_lower_name}, V4's unpartitioned index).
     * That index is <em>dropped</em> by the ADR 0019 migration, not kept
     * alongside: it forbids two cases this round deliberately allows
     * ({@code Food › Snacks} together with {@code Transport › Snacks}, and a
     * top-level {@code Snacks} together with {@code Food › Snacks}).
     * Partial indexes are required rather than one three-column index because
     * a plain unique key over a nullable column does not behave correctly in
     * PostgreSQL — multiple {@code NULL}s do not conflict, so every top-level
     * name would be exempt from the rule.
     *
     * <p>Which of the two arrives is decided by the row rather than by this
     * code: a duplicate top-level name can only violate the first, a duplicate
     * sibling name only the second (Database Architect, 2026-10-22). Both mean
     * the same thing to a client, which is why they map to one error code.
     *
     * <p>Matched by name, never by parsing the driver's message text, per the
     * Database Architect's handoff note. <strong>A partial functional unique
     * index reports identically to a table constraint</strong> — the same
     * reasoning V4 recorded and the Project Owner verified live: PostgreSQL
     * raises {@code SQLSTATE 23505} and puts the <em>index's</em> name in the
     * error's {@code CONSTRAINT} field, which is what
     * {@link ConstraintViolationException#getConstraintName()} surfaces. Both
     * the {@code lower(name)} expression and the partial {@code WHERE} clause
     * appear only in the error {@code DETAIL}, never in the name, so there is
     * still nothing to parse — only the set of strings grew from one to two.
     *
     * <p><strong>Two full names, deliberately — never the shared prefix.</strong>
     * {@code V6} also adds {@code uq_categories_user_id_id}
     * ({@code UNIQUE (user_id, id)}), which exists purely so the composite
     * parent foreign key is declarable and has nothing to do with names, and
     * <strong>{@code V8} adds a fourth</strong>,
     * {@code uq_categories_user_protected}
     * ({@code (user_id) WHERE is_protected}), which means "at most one
     * protected row per user" and is unreachable through this API at all. All
     * four share the {@code uq_categories_user_} prefix and only the two listed
     * here mean "duplicate name", so a prefix matcher would mislabel both of
     * the others (Database Architect, 2026-10-22 and {@code V8}'s CONTRACT
     * item 4, which repeats the warning now that there are four). Matching on
     * these two full strings is safe against both in both directions: neither
     * listed name is a substring of {@code uq_categories_user_id_id} or
     * {@code uq_categories_user_protected}, and neither of those is a substring
     * of a listed name.
     *
     * <p><strong>{@code V15} (ADR 0024 §4.1) rebuilt both indexes as partial on
     * {@code deleted_at IS NULL} under the SAME names</strong>, so this list is
     * unchanged and a race between two live duplicates is still a clean
     * {@code 409}. A soft-deleted row no longer holds its name in either index.
     *
     * <p><strong>These two names and the migration must land in the same
     * restart.</strong> While they disagree, a concurrent duplicate insert
     * stops being a clean {@code 409} and becomes a logged {@code 500}: the
     * pre-checks still catch every sequential duplicate, but the race loser's
     * violation carries a constraint name this list does not contain. It fails
     * closed rather than partially — V4's old literal is not a substring of
     * either new name — and the old name is deliberately <em>not</em> kept in
     * this list as a transition aid, because with V4's index still in place a
     * legitimate {@code Transport › Snacks} would then be answered with a
     * plausible-looking {@code 409} instead of an honest {@code 500}. A
     * half-applied migration must look broken, not merely strict.
     */
    private static final List<String> UNIQUE_NAME_CONSTRAINTS = List.of(
            "uq_categories_user_lower_name_top_level",
            "uq_categories_user_parent_lower_name");

    private final CategoryRepository categoryRepository;
    private final UserRepository userRepository;
    private final TransactionRepository transactionRepository;

    /**
     * Injected for one statement: the category delete's split-expense
     * reassignment (ADR 0024 §4.8). A repository rather than
     * {@code SplitExpenseService} for the same reason
     * {@link TransactionRepository} is injected rather than
     * {@code TransactionService} — see the class Javadoc. No cycle:
     * {@code SplitExpenseService} depends on this class only through
     * {@code CategorySnapshotResolver}, and this class depends on no service.
     */
    private final SplitExpenseRepository splitExpenseRepository;
    private final EntityInserter entityInserter;
    private final IdempotentWriteExecutor writeExecutor;
    private final ChangeLogWriter changeLogWriter;
    private final ObjectMapper objectMapper;

    /** Change-log field names of the delete's two counts (ADR 0027 §6.3). */
    private static final String REASSIGNED_TRANSACTION_COUNT = "reassignedTransactionCount";
    private static final String DELETED_SUBCATEGORY_COUNT = "deletedSubcategoryCount";

    public CategoryService(
            CategoryRepository categoryRepository,
            UserRepository userRepository,
            TransactionRepository transactionRepository,
            SplitExpenseRepository splitExpenseRepository,
            EntityInserter entityInserter,
            IdempotentWriteExecutor writeExecutor,
            ChangeLogWriter changeLogWriter,
            ObjectMapper objectMapper) {
        this.categoryRepository = categoryRepository;
        this.userRepository = userRepository;
        this.transactionRepository = transactionRepository;
        this.splitExpenseRepository = splitExpenseRepository;
        this.entityInserter = entityInserter;
        this.writeExecutor = writeExecutor;
        this.changeLogWriter = changeLogWriter;
        this.objectMapper = objectMapper;
    }

    /**
     * {@code GET /api/v1/categories} — the caller's whole list as a two-level
     * tree, unpaginated per the contract.
     *
     * <p><strong>The returned array holds top-level categories only</strong>;
     * each one carries its own children in {@code subcategories} (ADR 0019
     * §7). The nesting is the point: no consumer has to filter a flat list to
     * find the level it wants, which is what went wrong twice when {@code
     * Income} was a row in this table.
     *
     * <p><strong>One query, not N+1</strong> (constitution §10, ADR 0019
     * follow-up item 3): one owner-scoped read returns both levels and
     * {@link #toTree} assembles the structure in memory. Fetching children per
     * parent would be 1 + N round trips for a response this already has every
     * row for.
     */
    @Transactional(readOnly = true)
    public List<CategoryResponse> listCategories(UUID userId) {
        requireUser(userId);
        // Live rows only (ADR 0024 §4.2): a soft-deleted category and its
        // cascaded children are absent from the tree.
        return toTree(categoryRepository.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAscNameAsc(userId));
    }

    /**
     * {@code POST /api/v1/categories} — always {@code isDefault: false}
     * (api-overview.md §3.2). Creates a top-level category, or a subcategory
     * when {@code parentCategoryId} is present (ADR 0019 §7).
     */
    public WriteResult<CategoryResponse> createCategory(
            UUID userId, CreateCategoryRequest request, WriteContext context) {
        UUID requestedId = ClientIds.requireNotNil(request.id(), "id");
        // Not @Transactional: IdempotentWriteExecutor owns the boundary (ADR 0027 §4.3).
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.CATEGORY, ChangeLog.OPERATION_CREATE, requestedId),
                recorded -> WriteResult.created(currentResponse(userId, recorded.getEntityId())),
                () -> doCreateCategory(userId, request, requestedId, context));
    }

    private WriteResult<CategoryResponse> doCreateCategory(
            UUID userId, CreateCategoryRequest request, UUID requestedId, WriteContext context) {
        requireUser(userId);

        // ADR 0027 §3.3 step 3: explicit lookup, soft-deleted rows included.
        // Never save() with a client-supplied id.
        if (requestedId != null) {
            Category existing = categoryRepository.findById(requestedId).orElse(null);
            if (existing != null) {
                if (!userId.equals(existing.getUserId())) {
                    throw new IdConflictException();
                }
                return WriteResult.created(currentResponse(userId, requestedId));
            }
        }
        OffsetDateTime effectiveWriteAt = context.effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC));

        UUID parentCategoryId = request.parentCategoryId();

        // Rejection order, stated because it is a real decision rather than an
        // accident: the request-shape rule first, then the reference lookups.
        // A cap sent alongside a parent is wrong regardless of whether that
        // parent exists, so it is answered without a database round trip and
        // without revealing anything about the id. (Bean Validation has
        // already rejected every single-field problem before this method runs.)
        if (parentCategoryId != null && request.monthlyCap() != null) {
            throw new SubcategoryCapNotSupportedException();
        }

        if (parentCategoryId != null) {
            // Owner-scoped: another user's id is a 404, identical to a
            // non-existent one. Never a 403, which would confirm it is real.
            //
            // This pre-resolution is also what keeps the database's composite
            // same-owner foreign key (fk_categories_parent_category_id)
            // unreachable from a legal request: without it, a missing or
            // other-owner parent would surface as an unmapped 23503 and a 500
            // instead of this 404 (Database Architect, 2026-10-22). The FK
            // stays the real guarantee; this is the clean error.
            //
            // LIVE and SHARE-LOCKED (ADR 0024 §4.4 — required, not optional).
            // Under soft delete the self-FK no longer fails when a parent is
            // deleted, so without this lock a child created while its parent
            // is being deleted would stay live under a hidden parent and
            // vanish from the tree. FOR SHARE conflicts with the delete's
            // FOR UPDATE: if the delete commits first, this re-evaluates
            // deleted_at IS NULL and finds nothing (404 below); if this
            // create commits first, the delete then cascades to the new child.
            // A deleted parent is a 404, exactly like a non-existent one.
            Category parent = categoryRepository.findForShareByIdAndUserIdAndDeletedAtIsNull(parentCategoryId, userId)
                    .orElseThrow(ParentCategoryNotFoundException::new);
            // Exactly one level (ADR 0019 §2). The row exists and is the
            // caller's own, so this is ineligibility rather than absence — a
            // 404 here would be a lie. Mandatory in this layer whether or not
            // the database also carries a trigger for it.
            if (parent.getParentCategoryId() != null) {
                throw new SubcategoryDepthExceededException();
            }
        }

        // Trimmed before the uniqueness check and before storage: the unique
        // indexes fold case but not whitespace, so 'Food' and 'Food ' would
        // otherwise both be storable as distinct categories that look
        // identical to a user (Database Architect's handoff note; ADR 0018 §6
        // and ADR 0019 §3 both leave trimming exactly as it was).
        String name = request.name().trim();
        // Case-insensitive since ADR 0018 §6 and sibling-scoped since ADR 0019
        // §3: 'food' still conflicts with an existing 'Food' at the same
        // level, while 'Food > Snacks' and 'Transport > Snacks' may coexist.
        if (isDuplicateSiblingName(userId, parentCategoryId, name)) {
            throw new CategoryNameAlreadyExistsException();
        }

        Category category = Category.builder()
                .id(requestedId != null ? requestedId : UUID.randomUUID())
                .lastClientWriteAt(effectiveWriteAt)
                .userId(userId)
                .name(name)
                .iconName(request.iconName().trim())
                .glyph(request.glyph().trim())
                .monthlyCap(request.monthlyCap())
                .defaultCategory(false)
                // Never client-settable, and set explicitly rather than left to
                // the primitive's default so the invariant is visible here:
                // only the registration seed creates a protected row, exactly
                // one per user (ADR 0021 §2.1, api-overview.md §3.2). A request
                // carrying "isProtected" is ignored like any unknown field —
                // CreateCategoryRequest has no such property.
                .protectedCategory(false)
                .parentCategoryId(parentCategoryId)
                .build();

        // INSERT only (ADR 0027 §3.3): persist, never merge.
        Category saved = insert(category);
        // Never the cap's value — a spending limit is personal financial
        // information (constitution §23). Only whether one was set, and
        // whether this row is a subcategory (a shape fact, not a name).
        log.info("Category created for user {} (id={}, capSet={}, subcategory={})",
                userId, saved.getId(), saved.getMonthlyCap() != null, saved.getParentCategoryId() != null);

        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.CATEGORY, saved.getId(),
                ChangeLog.OPERATION_CREATE, ChangeSets.create(loggedFields(saved, true)), context,
                effectiveWriteAt, true);
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_CATEGORY_CREATED, ChangeLogSentences.CATEGORY,
                ChangeLogSentences.category("created", saved.getName()), ChangeLogWriter.Related.NONE, changeLogId);
        // A brand-new row can have no children, at either level.
        return WriteResult.created(toResponse(saved, List.of()));
    }

    /**
     * {@code PATCH /api/v1/categories/{id}} — owner-scoped partial update
     * (api-overview.md §3.3).
     *
     * <p>A seeded default is updatable like any other category: the contract
     * places no restriction on {@code isDefault} rows, and Budget Settings'
     * category caps are applied to exactly those rows. {@code isDefault}
     * itself is server-owned and never changes here.
     *
     * <p><strong>Works on either level, and never changes a row's level</strong>
     * (ADR 0019 §9). {@code name}/{@code iconName}/{@code glyph} apply to a
     * subcategory exactly as to a top-level category. There is no
     * {@code parentCategoryId} on the request DTO and no code path here that
     * writes that column, so reparenting is structurally impossible rather
     * than merely rejected. Two level-dependent behaviours:
     * <ul>
     *   <li>a non-null {@code monthlyCap} on a subcategory is a
     *       {@code 400} (caps are top-level-only, §4) — an explicit
     *       {@code null} stays a legal no-op;</li>
     *   <li>the duplicate-name check compares against the row's own
     *       <em>siblings</em>, so renaming {@code Food › Snacks} collides only
     *       with {@code Food}'s other children (§3).</li>
     * </ul>
     *
     * <p><strong>A name/icon/glyph change PROPAGATES to this category's
     * transactions, inside this same transaction</strong> (ADR 0021 §1,
     * api-overview.md §3.3) — see {@link #propagateSnapshotChange}, which is
     * where the two UPDATEs and their precise trigger conditions live. A
     * cap-only change propagates nothing: no snapshot value depends on it, and
     * bumping transaction rows' {@code updated_at} for it would push noise into
     * every offline client's sync cursor.
     *
     * <p><strong>A PROTECTED row refuses a {@code name} change, per field</strong>
     * (ADR 0021 §2.1, §3.3): {@code 400 CATEGORY_PROTECTED}, while
     * {@code iconName}, {@code glyph} and {@code monthlyCap} are accepted on it
     * exactly as on any other row — and an icon change on it propagates like
     * any other.
     */
    public WriteResult<CategoryResponse> updateCategory(
            UUID userId, UUID categoryId, UpdateCategoryRequest request, WriteContext context) {
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.CATEGORY, ChangeLog.OPERATION_UPDATE, categoryId),
                recorded -> ChangeLog.OUTCOME_SUPERSEDED.equals(recorded.getOutcome())
                        ? WriteResult.<CategoryResponse>superseded()
                        : WriteResult.ok(currentResponse(userId, categoryId)),
                () -> doUpdateCategory(userId, categoryId, request, context));
    }

    private WriteResult<CategoryResponse> doUpdateCategory(
            UUID userId, UUID categoryId, UpdateCategoryRequest request, WriteContext context) {
        requireUser(userId);
        OffsetDateTime effectiveWriteAt = context.effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC));
        if (context.lwwMode()) {
            // LWW mode (ADR 0027 §5.2): the caller's row, deleted included,
            // write-locked. Superseded is decided before any validation.
            Category current = categoryRepository.findForUpdateByIdAndUserId(categoryId, userId)
                    .orElseThrow(CategoryNotFoundException::new);
            String reason = LastWriteWins.supersededReason(
                    current.getDeletedAt() != null, current.getLastClientWriteAt(), effectiveWriteAt);
            if (reason != null) {
                changeLogWriter.logSuperseded(userId, ChangeLogEntityTypes.CATEGORY, categoryId,
                        ChangeSets.attempted(loggedFields(current, false), attemptedFields(request)),
                        reason, context, effectiveWriteAt, "the category " + current.getName(),
                        ChangeLogWriter.Related.NONE);
                log.info("Category {} update superseded for user {} (reason={})", categoryId, userId, reason);
                return WriteResult.superseded();
            }
        }
        // Live and WRITE-LOCKED (ADR 0024 §4.2). A deleted category is a 404.
        // The lock matters because persist() below saves the whole entity,
        // deleted_at included: without it, a PATCH that read the row just
        // before a concurrent delete committed would write deleted_at = NULL
        // back and resurrect the category. With it, the PATCH waits for the
        // delete, PostgreSQL re-evaluates deleted_at IS NULL, and the answer
        // is an honest 404.
        Category category = categoryRepository.findForUpdateByIdAndUserIdAndDeletedAtIsNull(categoryId, userId)
                .orElseThrow(CategoryNotFoundException::new);
        Map<String, Object> before = loggedFields(category, false);

        // ---------------------------------------------------------------
        // Phase 1 — resolve each requested change and reject anything not
        // allowed. Nothing is mutated in this phase.
        // ---------------------------------------------------------------

        // The row's own level, read once: it is fixed at creation and nothing
        // below can change it.
        UUID parentCategoryId = category.getParentCategoryId();
        boolean isSubcategory = parentCategoryId != null;

        // hasMonthlyCap() is true even for an explicit "monthlyCap": null,
        // which is how the contract expresses "clear the cap" (§3.3). An
        // omitted key leaves the stored cap untouched — the two must not
        // behave the same way.
        boolean capProvided = request.hasMonthlyCap();

        // Caps are top-level-only (ADR 0019 §4), and the database agrees
        // (chk_categories_subcategory_has_no_cap). Rejected here, first in the
        // phase, for the same reason the create path rejects it first: it is
        // the cheapest rule and it does not depend on any other field. An
        // explicit null is deliberately NOT rejected — clearing a cap the row
        // could not have had is a harmless no-op, and the ADR's wording is
        // "reject a non-null monthlyCap".
        if (capProvided && request.getMonthlyCap() != null && isSubcategory) {
            throw new SubcategoryCapNotSupportedException();
        }

        // The protected row (the seeded `Misc`, V8) may not be RENAMED — and
        // that is the whole of its immutability: iconName, glyph and monthlyCap
        // are accepted on it like on any other row (ADR 0021 §2.1,
        // api-overview.md §3.3). So this is a per-FIELD refusal, not a per-row
        // one, and it is decided here — service-side, before any write — with
        // V8's trg_categories_enforce_protection as a backstop that can only
        // ever produce an honest 500 (a plpgsql RAISE carries no constraint
        // name, so it is not mappable onto this 400 even in principle).
        //
        // Second in the phase, for the same reason the cap rule is first: it
        // costs no database round trip and depends on no other field.
        //
        // An explicit "name": null is NOT refused. `name` backs a NOT NULL
        // column, so this DTO treats an explicit null exactly like omission
        // (its own Javadoc; the same lenient rule Domain 2 applies) — there is
        // no rename being requested, so there is nothing to refuse. That
        // mirrors the cap rule immediately above, which also rejects only a
        // NON-null value.
        if (category.isProtectedCategory() && request.hasName() && request.getName() != null) {
            throw CategoryProtectedException.forRename();
        }

        String newName = null;
        if (request.hasName() && request.getName() != null) {
            newName = request.getName().trim();
            // equals(), not equalsIgnoreCase(): re-casing a category's own
            // name ('Food' -> 'food') is a real change and must still be
            // applied, so only an exact no-op skips the check. The check
            // itself is case-insensitive (ADR 0018 §6), sibling-scoped
            // (ADR 0019 §3) and excludes this row, so a self-recase passes it
            // — exactly as the partial index does, since the row's old value
            // is replaced rather than duplicated.
            if (!newName.equals(category.getName())
                    && isDuplicateSiblingName(userId, parentCategoryId, newName, categoryId)) {
                throw new CategoryNameAlreadyExistsException();
            }
        }

        String newIconName = null;
        if (request.hasIconName() && request.getIconName() != null) {
            newIconName = request.getIconName().trim();
        }

        String newGlyph = null;
        if (request.hasGlyph() && request.getGlyph() != null) {
            newGlyph = request.getGlyph().trim();
        }

        // Which of the three snapshot values is ACTUALLY changing, computed
        // while the stored values are still readable — i.e. the last thing
        // phase 1 does, deliberately, because phase 2 overwrites them.
        //
        // "Actually" matters twice. Re-submitting a category's own current name
        // is a legal 200 that must not bump every one of its transactions'
        // updated_at (that column is the sync cursor, so a no-op rename would
        // hand every offline client a pile of rows to re-pull for nothing). And
        // `nameChanged` on its own decides whether UPDATE 2 runs at all, which
        // is how "an icon-only change must never touch parent_category_name"
        // stays a property of the code rather than a comment.
        boolean nameChanged = newName != null && !newName.equals(category.getName());
        boolean iconNameChanged = newIconName != null && !newIconName.equals(category.getIconName());
        boolean glyphChanged = newGlyph != null && !newGlyph.equals(category.getGlyph());

        // ---------------------------------------------------------------
        // Phase 2 — apply.
        // ---------------------------------------------------------------
        if (newName != null) {
            category.setName(newName);
        }
        if (newIconName != null) {
            category.setIconName(newIconName);
        }
        if (newGlyph != null) {
            category.setGlyph(newGlyph);
        }
        if (capProvided) {
            category.setMonthlyCap(request.getMonthlyCap());
        }
        // ADR 0027 §5.2: only this client-authored write moves the LWW clock;
        // propagateSnapshotChange below never touches it.
        category.setLastClientWriteAt(effectiveWriteAt);

        Category saved = persist(category);
        // Field names and the cap's presence only — never values.
        log.info("Category {} updated for user {} (name={}, iconName={}, glyph={}, cap={}, subcategory={})",
                saved.getId(), userId, newName != null, newIconName != null, newGlyph != null,
                capProvided ? (request.getMonthlyCap() == null ? "cleared" : "set") : "unchanged",
                isSubcategory);

        // Propagation runs AFTER the row's own write and INSIDE the same
        // transaction (ADR 0021 §1.2): persist() has already flushed the new
        // values, so the UPDATEs below cannot copy a half-applied state, and if
        // either of them fails the category rename rolls back with them.
        if (nameChanged || iconNameChanged || glyphChanged) {
            propagateSnapshotChange(userId, saved, nameChanged);
        }

        // Propagations are NOT logged (ADR 0027 §6.3): they are consequences of
        // this one logged category write.
        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.CATEGORY, categoryId,
                ChangeLog.OPERATION_UPDATE, ChangeSets.update(before, loggedFields(saved, false)), context,
                effectiveWriteAt, true);
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_CATEGORY_EDITED, ChangeLogSentences.CATEGORY,
                ChangeLogSentences.category("edited", saved.getName()), ChangeLogWriter.Related.NONE, changeLogId);
        return WriteResult.ok(toResponse(saved, childrenOf(userId, saved)));
    }

    /**
     * {@code GET /api/v1/categories/{id}/usage} — the delete pre-flight
     * (api-overview.md §3.5, ADR 0021 §2.2).
     *
     * <p>Owner-scoped and <strong>side-effect-free</strong>: it writes nothing,
     * reserves nothing and is never sent back to the server, so calling it is
     * not a step in a two-phase delete. It exists because the warning has to be
     * shown <em>before</em> the user confirms, and because the obvious
     * alternative — counting from the client's own paginated transactions store
     * — is wrong in the dangerous direction: a category with 300 transactions,
     * none of them on the page the client happens to hold, would delete with no
     * warning at all.
     *
     * <p><strong>Legal for the protected row, deliberately.</strong> There is no
     * {@code CATEGORY_PROTECTED} branch here: asking about {@code Misc} is a
     * legal question with a legal answer, and only deleting it is refused
     * (§3.5).
     *
     * <p><strong>The counts come from the same resolution the delete uses</strong>
     * ({@link #subcategoryIdsOf} + {@link #rollUpIds}), which is what makes
     * "you cannot be warned about one number and have another happen" a property
     * of the code rather than a promise. {@code subcategoryCount} is therefore
     * that same resolved list's size rather than a second {@code COUNT} query
     * that could disagree with it.
     */
    @Transactional(readOnly = true)
    public CategoryUsageResponse getCategoryUsage(UUID userId, UUID categoryId) {
        requireUser(userId);
        // Live only (ADR 0024 §4.2): asking about a deleted category is a 404,
        // like asking about one that never existed. No lock — this writes
        // nothing and its answer is advisory (§3.5).
        Category category = categoryRepository.findByIdAndUserIdAndDeletedAtIsNull(categoryId, userId)
                .orElseThrow(CategoryNotFoundException::new);

        List<UUID> subcategoryIds = subcategoryIdsOf(userId, category);
        // Live rows only — this number describes what the USER will see change,
        // and a soft-deleted transaction appears in no read (§3.5). The
        // delete's own reassignedTransactionCount is deliberately broader; see
        // CategoryDeletionResponse.
        long transactionCount = transactionRepository.countByUserIdAndCategoryIdInAndDeletedAtIsNull(
                userId, rollUpIds(categoryId, subcategoryIds));

        return new CategoryUsageResponse(categoryId, transactionCount, subcategoryIds.size());
    }

    /**
     * {@code DELETE /api/v1/categories/{id}} — <strong>soft-deletes</strong>
     * one of the caller's categories, cascading to its subcategories, after
     * reassigning every affected transaction and every affected split expense
     * the caller created to the caller's protected {@code Misc} row
     * (api-overview.md §3.4, ADR 0021 §2 as amended by ADR 0024 §4.3/§4.8).
     *
     * <p><strong>The whole operation is one transaction, in this order</strong>
     * (ADR 0024 §4.3), and the order is not interchangeable:
     * <ol>
     *   <li>fetch the target owner-scoped, <strong>live and write-locked</strong>
     *       ({@code FOR UPDATE}) — unknown, another user's, and already-deleted
     *       are one identical {@code 404 CATEGORY_NOT_FOUND}, never a
     *       {@code 403};</li>
     *   <li>refuse the protected row with {@code 400 CATEGORY_PROTECTED} — it
     *       is the reassignment target every other delete depends on;</li>
     *   <li>resolve the reassignment target by column
     *       ({@link #resolveProtectedCategory});</li>
     *   <li>resolve the live subcategory ids, write-locked — the affected set is
     *       the target plus those, the same roll-up
     *       {@code GET /transactions?categoryId=} and §3.5 use;</li>
     *   <li>one UPDATE reassigning every transaction in that set (soft-deleted
     *       ones included), writing {@code reassigned_from_category_id};</li>
     *   <li>one UPDATE reassigning every split expense the caller created in
     *       that set, writing the same marker (ADR 0024 §4.8);</li>
     *   <li>soft-delete the subcategory rows <em>by id</em>, then the target
     *       row — {@code deleted_at} and {@code updated_at} set to
     *       <strong>one shared instant</strong>, each count verified;</li>
     *   <li>post-condition: no live child remains under the target.</li>
     * </ol>
     * Steps 1–4 are all reads, so every answer a client can be given is decided
     * before the first write (see this class's Javadoc on the rollback trap).
     *
     * <p><strong>A SOFT delete</strong> (ADR 0024, superseding ADR 0021 §2.7's
     * hard delete by Project Owner ruling, 2026-11-03): the rows stay in the
     * database and disappear from every read. The cost ADR 0021 §2.7 named —
     * a {@code deleted_at IS NULL} filter on every read of this table — is now
     * paid on purpose and is visible in every {@code CategoryRepository} method
     * name. <strong>A second {@code DELETE} of the same id is a
     * {@code 404}</strong>: the operation is idempotent in effect, not in status
     * code, and a client retrying a delete the user already confirmed must
     * treat that {@code 404} as success. {@code deletedSubcategoryCount} keeps
     * its name and now counts subcategories soft-deleted.
     *
     * <p><strong>What this does NOT touch</strong> (ADR 0021 §2.5, ADR 0024
     * §4.6), recorded so none of it is later filed as a gap: a saved
     * {@code budget_period_category_caps} row keeps its frozen
     * {@code category_name} <em>and</em> its stored {@code category_id} (which
     * is never nulled); the budget read returns {@code categoryId: null} for it
     * through a liveness-only join, so a restore would bring the link back with
     * no write. Income rows are unreachable because their {@code category_id}
     * is {@code NULL}.
     */
    public WriteResult<CategoryDeletionResponse> deleteCategory(UUID userId, UUID categoryId, WriteContext context) {
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.CATEGORY, ChangeLog.OPERATION_DELETE, categoryId),
                recorded -> WriteResult.ok(recordedDeletion(recorded)),
                () -> doDeleteCategory(userId, categoryId, context));
    }

    /**
     * Deletes are terminal (ADR 0027 §5.4): a live category is always deleted,
     * whatever its LWW timestamp. Logs one row per deleted category — the target
     * (primary, carrying the key and the two counts) and each cascaded
     * subcategory (secondary, no key, no activity) — per §6.3.
     */
    private WriteResult<CategoryDeletionResponse> doDeleteCategory(
            UUID userId, UUID categoryId, WriteContext context) {
        requireUser(userId);

        // Step 1 — live, owner-scoped, WRITE-LOCKED (ADR 0024 §4.3 step 1,
        // §4.4). Unknown, another user's and already-deleted are one identical
        // 404, so a second DELETE of the same id is a 404 (§1.4). The lock is
        // what serializes this delete with every write that share-locks the
        // category before storing a reference to it.
        Category target = categoryRepository.findForUpdateByIdAndUserIdAndDeletedAtIsNull(categoryId, userId)
                .orElseThrow(CategoryNotFoundException::new);

        // Step 2 — the row exists and is the caller's own, so this is
        // ineligibility rather than absence or an authorization failure — 400,
        // never 403 and never 404 (ADR 0021 §2.1, §3.4's error table). Same
        // code as the rename refusal: one condition, one code.
        if (target.isProtectedCategory()) {
            throw CategoryProtectedException.forDelete();
        }

        // Step 3 — the reassignment target, by column, never by name.
        Category fallbackCategory = resolveProtectedCategory(userId);

        // Step 4 — the live subcategory id set, WRITE-LOCKED too (parent
        // first, then children in id order). A transaction or split expense
        // tagged to a SUBCATEGORY share-locks that subcategory, not this
        // parent, so locking the children here is what makes such a write and
        // this delete serialize as well (see the repository method).
        List<Category> subcategories = lockLiveSubcategories(userId, target);
        List<UUID> subcategoryIds = subcategories.stream().map(Category::getId).toList();

        // Last values for the change log, read before the bulk soft delete
        // below clears the persistence context (ADR 0027 §6.3).
        Map<String, Object> targetLastValues = loggedFields(target, false);
        Map<UUID, Map<String, Object>> subcategoryLastValues = new LinkedHashMap<>();
        for (Category subcategory : subcategories) {
            subcategoryLastValues.put(subcategory.getId(), loggedFields(subcategory, false));
        }
        String targetName = target.getName();

        // The fallback row's values are read off the entity NOW, before the
        // bulk soft delete below clears the persistence context and detaches
        // it. They are bound as parameters anyway, so this is the natural
        // order — but it is also the reason the order is safe.
        //
        // The fallback can never be inside the affected set, structurally: a
        // protected row is always top-level (chk_categories_protected_is_top_level),
        // so it cannot be one of the target's children, and step 2 above has
        // already ruled out it being the target.
        List<UUID> affectedCategoryIds = rollUpIds(categoryId, subcategoryIds);

        // ONE instant for every row this delete writes: the reassigned
        // transactions' and split expenses' updated_at, and deleted_at AND
        // updated_at on the target and its children. The shared instant on the
        // category rows is load-bearing — it is how a future restore tells
        // "deleted with this parent" from "deleted on its own earlier"
        // (ADR 0024 §6.1) — so the clock is read exactly once.
        OffsetDateTime deletedAt = OffsetDateTime.now(ZoneOffset.UTC);

        // Step 5 — transactions, soft-deleted ones included, each recording
        // its prior category in reassigned_from_category_id (ADR 0024 §6.2).
        int reassignedTransactionCount = transactionRepository.reassignToFallbackCategory(
                userId,
                affectedCategoryIds,
                fallbackCategory.getId(),
                fallbackCategory.getName(),
                fallbackCategory.getIconName(),
                fallbackCategory.getGlyph(),
                deletedAt);

        // Step 6 — split expenses the caller created (ADR 0024 §4.8, Project
        // Owner ruling). Every member of a shared split sees Misc from now on.
        // Not counted in the response: CategoryDeletionResponse gains no field
        // and reassignedTransactionCount stays transactions-only, so the
        // client refreshes its split data after any successful delete.
        int reassignedSplitExpenseCount = splitExpenseRepository.reassignToFallbackCategory(
                userId,
                affectedCategoryIds,
                fallbackCategory.getId(),
                fallbackCategory.getName(),
                fallbackCategory.getIconName(),
                fallbackCategory.getGlyph(),
                deletedAt);

        // Step 7 — the cascaded SOFT delete: children by id, then the target,
        // both with the same instant. Each count is verified against what was
        // resolved (ADR 0021 §2.4's rule, carried over by ADR 0024 §4.3). With
        // both rows locked above a mismatch should be impossible, so it means
        // a broken invariant, and rolling the whole delete back is correct: a
        // half-finished cascade would leave transactions on Misc while their
        // category is still live.
        if (!subcategoryIds.isEmpty()) {
            int stampedSubcategories = categoryRepository.stampDeletedAt(userId, subcategoryIds, deletedAt);
            if (stampedSubcategories != subcategoryIds.size()) {
                throw new IllegalStateException(
                        "Category delete resolved " + subcategoryIds.size() + " subcategories but soft-deleted "
                                + stampedSubcategories + " for user " + userId);
            }
        }
        int stampedTarget = categoryRepository.stampDeletedAt(userId, List.of(categoryId), deletedAt);
        if (stampedTarget != 1) {
            throw new IllegalStateException(
                    "Category delete soft-deleted " + stampedTarget + " rows for category " + categoryId
                            + " and user " + userId + "; expected exactly 1");
        }

        // Step 8 — post-condition: no LIVE child may remain under the deleted
        // target (ADR 0024 §4.3 step 8). toTree() would silently drop such a
        // row, so the user would lose sight of a category they can still use.
        // Unreachable while subcategory create share-locks its parent; checked
        // anyway, because soft delete removed the self-FK backstop that used to
        // make this loud.
        long liveChildrenLeft = categoryRepository.countByUserIdAndParentCategoryIdAndDeletedAtIsNull(
                userId, categoryId);
        if (liveChildrenLeft != 0) {
            throw new IllegalStateException(
                    "Category delete left " + liveChildrenLeft + " live subcategories under category "
                            + categoryId + " for user " + userId);
        }

        // Ids and counts only — never a category name, and never anything about
        // the amounts on the reassigned rows (constitution §23).
        log.info("Category {} soft-deleted for user {} (reassignedTransactions={}, "
                        + "reassignedSplitExpenses={}, deletedSubcategories={})",
                categoryId, userId, reassignedTransactionCount, reassignedSplitExpenseCount,
                subcategoryIds.size());

        OffsetDateTime effectiveWriteAt = context.effectiveWriteAt(deletedAt);
        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put(REASSIGNED_TRANSACTION_COUNT, reassignedTransactionCount);
        counts.put(DELETED_SUBCATEGORY_COUNT, subcategoryIds.size());
        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.CATEGORY, categoryId,
                ChangeLog.OPERATION_DELETE, ChangeSets.delete(targetLastValues, deletedAt, counts), context,
                effectiveWriteAt, true);
        subcategoryLastValues.forEach((subcategoryId, lastValues) -> changeLogWriter.logApplied(
                userId, ChangeLogEntityTypes.CATEGORY, subcategoryId, ChangeLog.OPERATION_DELETE,
                ChangeSets.delete(lastValues, deletedAt, Map.of()), context, effectiveWriteAt, false));
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_CATEGORY_DELETED, ChangeLogSentences.CATEGORY,
                ChangeLogSentences.category("deleted", targetName), ChangeLogWriter.Related.NONE, changeLogId);
        return WriteResult.ok(new CategoryDeletionResponse(reassignedTransactionCount, subcategoryIds.size()));
    }

    /**
     * The two propagation UPDATEs behind {@code PATCH /categories/{id}}
     * (api-overview.md §3.3, ADR 0021 §1.2). Runs in the caller's transaction,
     * after the category row's own write.
     *
     * <p><strong>UPDATE 1 — rows tagged to this category itself.</strong>
     * Refreshes {@code category_name}, {@code category_icon_name} and
     * {@code category_glyph}. All three propagate, not just the name: a
     * transaction showing a new name beside the old icon reads as a bug, and a
     * user who changes an icon is expressing the same intent as one who changes
     * a name. (ADR 0021 §1.3 flags that as its own derived rule — the Project
     * Owner's words were about the name — and narrowing it to name-only is one
     * argument in this call.)
     *
     * <p><strong>UPDATE 2 — rows tagged to this category's CHILDREN.</strong>
     * Refreshes {@code parent_category_name} and nothing else, and runs
     * <strong>only</strong> when the <em>name</em> changed on a
     * <em>top-level</em> row that actually has children. It is the statement
     * that gets missed: a transaction tagged to {@code Food › Lunch} carries
     * Lunch's id, so renaming {@code Food} matches zero rows in UPDATE 1 and the
     * row would keep rendering the old parent name beside the correct leaf name
     * in one string.
     *
     * <p>Three precisions, each structural rather than a comment:
     * <ul>
     *   <li><strong>an icon- or glyph-only change never reaches UPDATE 2</strong>
     *       — there is no {@code parent_category_icon_name} column to write, so
     *       {@code nameChanged} alone gates it;</li>
     *   <li><strong>renaming a SUBCATEGORY runs UPDATE 1 only</strong> — a
     *       subcategory can have no children (ADR 0019 §2), so
     *       {@link #subcategoryIdsOf} returns empty without a query;</li>
     *   <li><strong>the child id set comes from {@code categories} in one
     *       query</strong> — there is no {@code parent_category_id} on
     *       {@code transactions} and none is to be added.</li>
     * </ul>
     *
     * <p><strong>One timestamp for both statements</strong>, captured once: the
     * rows they touch changed in the same logical write, and two clock reads
     * would give an offline client two different cursor positions for one
     * event. It is passed explicitly because a bulk JPQL update bypasses
     * {@code @UpdateTimestamp} and the schema has no trigger for
     * {@code updated_at} either — and {@code updated_at} is the sync cursor, so
     * without it this feature would silently not reach a single offline client.
     * {@code version} is deliberately not touched; see
     * {@link TransactionRepository#refreshCategorySnapshot}.
     */
    private void propagateSnapshotChange(UUID userId, Category category, boolean nameChanged) {
        OffsetDateTime propagatedAt = OffsetDateTime.now(ZoneOffset.UTC);

        int refreshedRows = transactionRepository.refreshCategorySnapshot(
                userId,
                category.getId(),
                category.getName(),
                category.getIconName(),
                category.getGlyph(),
                propagatedAt);

        int refreshedChildRows = 0;
        if (nameChanged) {
            List<UUID> subcategoryIds = subcategoryIdsOf(userId, category);
            if (!subcategoryIds.isEmpty()) {
                refreshedChildRows = transactionRepository.refreshParentCategorySnapshot(
                        userId, subcategoryIds, category.getName(), propagatedAt);
            }
        }

        // Sync status is an explicitly allowed log category (constitution §23);
        // counts and ids only, no names and no amounts.
        log.info("Category {} snapshot propagated for user {} "
                        + "(nameChanged={}, transactionRows={}, childTransactionRows={})",
                category.getId(), userId, nameChanged, refreshedRows, refreshedChildRows);
    }

    /**
     * <strong>The ONE place the protected {@code Misc} row is resolved</strong>
     * (ADR 0021 §2.1, {@code V8__categories_misc_fallback.sql}'s CONTRACT
     * item 2). Everything that needs it calls this; nothing re-implements it.
     *
     * <p>Found by {@code user_id = :callerId AND is_protected} and by nothing
     * else — <strong>never by the name {@code Misc}, never by
     * {@code is_default}, never by a well-known id.</strong> Nothing in this
     * system resolves a category by name (ADR 0018 §5), and that is a safety
     * property rather than a style preference: names are unique only
     * case-insensitively and only among siblings, a user may already own a
     * category called {@code misc}, and a name-matched target would be
     * hijackable by a rename — which, after ADR 0021 §1, would then propagate
     * into transaction history. One call site is the mitigation that keeps it
     * that way, because two implementations of this lookup is how a by-name
     * match creeps back in.
     *
     * <p><strong>It resolves; it must NEVER create.</strong> A get-or-create
     * here would put schema-invariant repair on a user-facing financial write
     * path, and it would still need a collision error, so it buys nothing
     * {@code V8} does not already provide: that migration backfills one
     * protected row for every account that existed and asserts the result
     * (STEP 5/STEP 7), the registration seed covers every account created
     * since ({@link DefaultCategoryCatalog}'s 8th entry), and
     * {@code uq_categories_user_protected} guarantees there is never more than
     * one. If the row is genuinely absent, the invariant is broken and
     * {@link IllegalStateException} → a logged {@code 500 INTERNAL_ERROR} is
     * the honest answer (ADR 0021, "Existing data"). The most likely cause is
     * {@code V8} not having been applied, which is also why that is a loud
     * failure rather than a quiet repair.
     *
     * <p><strong>Made {@code public} by Domain 6 sub-step 3, for a second caller
     * rather than for convenience.</strong> ADR 0023 §3 gives
     * {@code POST /split-expenses} the same need — a request omitting
     * {@code categoryId} snapshots the creator's protected {@code Misc} row,
     * because {@code split_expenses}' four snapshot columns are {@code NOT NULL}
     * and §9.1 makes {@code categoryId} optional — and ADR 0023's Backend
     * follow-up item 4 repeats the rule that matters: resolved
     * <strong>by {@code is_protected}, never by name</strong>. Widening the
     * visibility of this one method is what keeps that true;
     * {@code CategorySnapshotResolver} calls it instead of re-implementing the
     * lookup, which is the exact duplication the paragraph above warns about. The
     * method itself is unchanged.
     */
    public Category resolveProtectedCategory(UUID userId) {
        // The LIVE protected row (ADR 0024 §4.2) — the same predicate as
        // V15's uq_categories_user_protected. It can never be soft-deleted
        // (chk_categories_protected_not_deleted), so this cannot change the
        // answer; it keeps "the protected row" one definition everywhere.
        return categoryRepository.findByUserIdAndProtectedCategoryIsTrueAndDeletedAtIsNull(userId)
                .orElseThrow(() -> new IllegalStateException(
                        "User " + userId + " has no protected category row. "
                                + "V8__categories_misc_fallback.sql guarantees exactly one per user "
                                + "and the registration seed creates it; this service never creates it."));
    }

    /**
     * The ids of a row's <strong>live</strong> subcategories — <strong>empty,
     * with no query, for a row that is itself a subcategory</strong> (ADR 0019
     * §2: exactly one level, so a child can have no children). Shared by the
     * usage count and rename propagation's UPDATE 2; the delete cascade uses
     * {@link #lockLiveSubcategories}, which applies the same predicate with a
     * row lock, so all three agree on what "this category's children" means.
     */
    private List<UUID> subcategoryIdsOf(UUID userId, Category category) {
        if (category.getParentCategoryId() != null) {
            return List.of();
        }
        return categoryRepository.findSubcategoryIds(userId, category.getId());
    }

    /**
     * {@link #subcategoryIdsOf} for the delete: the same live children, but
     * write-locked ({@code FOR UPDATE}) in id order, after the target's own
     * lock (ADR 0024 §4.4). Empty, with no query, for a subcategory target.
     */
    private List<Category> lockLiveSubcategories(UUID userId, Category target) {
        if (target.getParentCategoryId() != null) {
            return List.of();
        }
        // Rows rather than ids since ADR 0027: the delete logs each cascaded
        // subcategory's last values (§6.3).
        return categoryRepository
                .findForUpdateByUserIdAndParentCategoryIdAndDeletedAtIsNullOrderByIdAsc(userId, target.getId());
    }

    /**
     * The rolled-up id set: the category itself followed by its subcategories —
     * the same set {@code GET /transactions?categoryId=} matches (ADR 0019 §5),
     * which is what §3.5's count and §3.4's reassignment are both defined over.
     */
    private static List<UUID> rollUpIds(UUID categoryId, List<UUID> subcategoryIds) {
        List<UUID> ids = new ArrayList<>(subcategoryIds.size() + 1);
        ids.add(categoryId);
        ids.addAll(subcategoryIds);
        return List.copyOf(ids);
    }

    /**
     * Seeds the 8 default categories for a brand-new user. Called by
     * {@code AuthService.register()} for <strong>every</strong> registration,
     * with no exemption for test accounts (Project Owner, 2026-10-02; the
     * count became 7 with ADR 0018 §2 and 8 again with ADR 0021 §2.1, nothing
     * else about the hook changed).
     *
     * <p><strong>The 8th row is what makes {@code DELETE /categories/{id}}
     * possible at all</strong> ({@code V8__categories_misc_fallback.sql}'s
     * CONTRACT item 1): the seeded {@code Misc} category is the reassignment
     * target, it carries {@code is_protected = true}, and it must exist for
     * every account. This hook is the <em>only</em> thing that creates it for
     * accounts registered from now on — {@code V8}'s backfill could only cover
     * accounts that existed when it ran, and the service deliberately never
     * creates it on demand ({@link #resolveProtectedCategory}). So a
     * registration that skipped the 8th entry would leave an account whose
     * every category delete is a {@code 500}.
     *
     * <p><strong>Untouched by ADR 0019 §8, deliberately:</strong> every seeded
     * row is top-level ({@code parent_category_id = NULL}, which is simply what
     * {@link DefaultCategoryCatalog}'s builder already produces), and
     * <strong>no subcategory is ever seeded</strong>. Choosing which children
     * {@code Food} has is a product decision nobody has made; seeding any
     * would also make the feature exist for users who never enabled it, and
     * would recreate the registered-before/registered-after divergence
     * ADR 0018 had to clean up. The second level starts empty for everyone.
     *
     * <p><strong>Transaction semantics, deliberately chosen.</strong> This
     * method has no {@code REQUIRES_NEW}: it joins {@code register()}'s
     * existing transaction, so the user row, the role row and these 8
     * category rows all commit together or not at all. If seeding fails, the
     * registration rolls back and no account is created — which is the
     * intended outcome. A freshly created user cannot collide with either
     * uniqueness index, so a failure here is a genuine bug (a changed catalog
     * with a duplicate name, or a broken schema), and the alternative —
     * swallowing it so registration "succeeds" — would leave an account with
     * no categories at all, which the Add Expense flow depends on and which no
     * endpoint in this phase can repair (there is no re-seed endpoint, by
     * design). Since ADR 0021 it would also leave an account with no
     * reassignment target, which is a second, quieter reason not to swallow it.
     *
     * <p>Not idempotent, and does not need to be: the only caller creates the
     * user in the same transaction. Calling it twice for one user would
     * violate the top-level unique index, which is the correct, loud failure —
     * nothing here silently ignores a conflict.
     */
    @Transactional
    public void seedDefaultsFor(UUID userId) {
        List<Category> rows = DefaultCategoryCatalog.newRowsFor(userId);
        // Flushed inside the transaction so any failure surfaces here, while
        // there is still a transaction to roll back, rather than at commit.
        categoryRepository.saveAllAndFlush(rows);
        log.info("Seeded {} default categories for new user {}", rows.size(), userId);
    }

    /**
     * Flushes inside the transaction so a unique-constraint violation
     * surfaces here rather than at commit, where it could no longer be mapped
     * onto a meaningful status code.
     *
     * <p>The two partial unique indexes named in
     * {@link #UNIQUE_NAME_CONSTRAINTS} are the actual guarantee; the
     * {@code existsBy...} pre-checks above are only the friendly path. Two
     * concurrent requests claiming the same name under the same parent can
     * both pass those checks, and the loser must still get the contract's 409
     * rather than a 500. Both halves are kept on purpose (ADR 0018 §6,
     * carried over verbatim by ADR 0019 §3): the pre-check gives the clean
     * error, the index is the only real guard against the race.
     *
     * <p>The violation is identified by <strong>constraint name</strong>, not
     * by matching driver message text (Database Architect's handoff note).
     * Anything else is rethrown and logged as an unexpected error rather than
     * mislabelled a name conflict. Everything V6 added to this table can now
     * reach here, and <strong>none of it means "duplicate name"</strong>:
     * <ul>
     *   <li>{@code trg_categories_enforce_depth_one} — the database's
     *       defence-in-depth depth-1 trigger. A plpgsql {@code RAISE} has no
     *       associated constraint, so {@code getConstraintName()} is
     *       <strong>null</strong> on this path; see
     *       {@link #isUniqueNameViolation}, which is written null-safe for
     *       exactly that reason.</li>
     *   <li>{@code chk_categories_subcategory_has_no_cap} and
     *       {@code chk_categories_parent_not_self} — CHECK constraints the
     *       layers above should already have answered as a 400.</li>
     *   <li>{@code fk_categories_parent_category_id} — the composite
     *       same-owner parent FK. {@code createCategory} resolves the parent
     *       owner-scoped first, so a legal request never reaches it.</li>
     *   <li>{@code uq_categories_user_id_id} — {@code UNIQUE (user_id, id)},
     *       which exists only so that composite FK is declarable. It shares a
     *       prefix with the two name indexes and means something entirely
     *       different; see {@link #UNIQUE_NAME_CONSTRAINTS} on why matching
     *       the full names rather than that prefix matters.</li>
     *   <li><strong>{@code V8} adds three more ways to arrive, and none of them
     *       means "duplicate name" either</strong>
     *       ({@code V8__categories_misc_fallback.sql}'s CONTRACT item 4):
     *       {@code trg_categories_enforce_protection} (a trigger, so
     *       <strong>null</strong> constraint name on all three of its
     *       {@code RAISE}s — the same null branch V6's depth trigger already
     *       needed), {@code chk_categories_protected_is_top_level} and
     *       {@code uq_categories_user_protected}. The last two are unreachable
     *       through this API: no endpoint accepts a parent change and none
     *       accepts {@code isProtected}. The trigger is reachable only by a
     *       service bug, because the user-facing refusal is
     *       {@code 400 CATEGORY_PROTECTED}, decided before the write.</li>
     *   <li><strong>{@code V15} keeps the three index names byte-identical
     *       and adds three more, none of which means "duplicate name"</strong>
     *       ({@code V15__categories_soft_delete.sql}'s CONTRACT item 3):
     *       {@code chk_categories_protected_not_deleted} ({@code 23514}),
     *       {@code fk_transactions_reassigned_from_category_id} and
     *       {@code fk_split_expenses_reassigned_from_category_id}
     *       ({@code 23503}). All three are unreachable through the API and must
     *       stay logged {@code 500}s; they are raised by the bulk statements in
     *       {@link #deleteCategory}, which no translator wraps, so they reach
     *       {@code GlobalExceptionHandler}'s catch-all. Neither listed name is a
     *       substring of any of them. {@code V15} also widens
     *       {@code trg_categories_enforce_protection} to refuse
     *       <em>every</em> hard {@code DELETE} — still a {@code RAISE}, still a
     *       <strong>null</strong> constraint name, still a {@code 500}.</li>
     * </ul>
     * Reaching any of them means a validation rule in this class was skipped,
     * so an honest 500 with a logged stack trace is the right answer, not a
     * plausible-looking 400 or 409.
     *
     * <p>Also note: the id is assigned rather than generated, so Spring Data
     * merges instead of persisting and hands back a <em>different</em> managed
     * instance. Only that returned instance carries the
     * {@code @CreationTimestamp}/{@code @UpdateTimestamp} values the response
     * needs — the same wrinkle backend/README.md §3 (point 5) records for
     * {@code register()}'s {@code createdAt}.
     */
    private Category persist(Category category) {
        try {
            return categoryRepository.saveAndFlush(category);
        } catch (DataIntegrityViolationException ex) {
            if (isUniqueNameViolation(ex)) {
                throw new CategoryNameAlreadyExistsException();
            }
            throw ex;
        }
    }

    /**
     * The create path's INSERT (ADR 0027 §3.3): {@code persist}, never
     * {@code merge}. A primary-key violation is rethrown unchanged for
     * {@code IdempotentWriteExecutor}'s re-run.
     */
    private Category insert(Category category) {
        try {
            return entityInserter.insert(category);
        } catch (DataIntegrityViolationException ex) {
            if (isUniqueNameViolation(ex)) {
                throw new CategoryNameAlreadyExistsException();
            }
            throw ex;
        }
    }

    /** Replay read: the caller's row in its current state, soft-deleted included. */
    private CategoryResponse currentResponse(UUID userId, UUID categoryId) {
        Category row = categoryRepository.findById(categoryId)
                .filter(category -> userId.equals(category.getUserId()))
                .orElseThrow(CategoryNotFoundException::new);
        return toResponse(row, row.getDeletedAt() != null ? List.of() : childrenOf(userId, row));
    }

    /**
     * Replay of a delete: {@code 200} with the counts the original delete
     * recorded on its primary change-log row (ADR 0027 §4.3).
     */
    private CategoryDeletionResponse recordedDeletion(ChangeLog recorded) {
        int reassigned = 0;
        int deletedSubcategories = 0;
        List<?> changes = objectMapper.readValue(recorded.getChanges(), List.class);
        for (Object element : changes) {
            if (element instanceof Map<?, ?> change && change.get("after") instanceof Number count) {
                if (REASSIGNED_TRANSACTION_COUNT.equals(change.get("field"))) {
                    reassigned = count.intValue();
                } else if (DELETED_SUBCATEGORY_COUNT.equals(change.get("field"))) {
                    deletedSubcategories = count.intValue();
                }
            }
        }
        return new CategoryDeletionResponse(reassigned, deletedSubcategories);
    }

    /** ADR 0027 §6.3's logged fields for {@code category}; {@code parentCategoryId} is create-only. */
    static Map<String, Object> loggedFields(Category category, boolean create) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("name", category.getName());
        fields.put("iconName", category.getIconName());
        fields.put("glyph", category.getGlyph());
        fields.put("monthlyCap", category.getMonthlyCap());
        if (create) {
            fields.put("parentCategoryId", category.getParentCategoryId());
        }
        return fields;
    }

    /** The fields a superseded PATCH tried to set (ADR 0027 §6.3). */
    static Map<String, Object> attemptedFields(UpdateCategoryRequest request) {
        Map<String, Object> fields = new LinkedHashMap<>();
        if (request.hasName() && request.getName() != null) {
            fields.put("name", request.getName().trim());
        }
        if (request.hasIconName() && request.getIconName() != null) {
            fields.put("iconName", request.getIconName().trim());
        }
        if (request.hasGlyph() && request.getGlyph() != null) {
            fields.put("glyph", request.getGlyph().trim());
        }
        if (request.hasMonthlyCap()) {
            fields.put("monthlyCap", request.getMonthlyCap());
        }
        return fields;
    }

    /**
     * {@code true} only when this integrity violation is one of the two
     * sibling-name unique indexes.
     *
     * <p><strong>Null-safe by design, not by luck</strong> (Database
     * Architect, 2026-10-22, re-stated by {@code V8}'s CONTRACT item 4 which
     * adds <strong>three more unnamed paths</strong>). Not every integrity
     * error carries a constraint name: {@code V6}'s
     * {@code trg_categories_enforce_depth_one} and {@code V8}'s
     * {@code trg_categories_enforce_protection} both raise from plpgsql, and a
     * {@code RAISE} has no associated constraint, so
     * {@link ConstraintViolationException#getConstraintName()} returns
     * {@code null} on all four of those paths. Folding the case of that value
     * without a guard would throw a {@link NullPointerException} <em>inside</em>
     * the handler for the original failure, which is the worst place to throw:
     * the real error would be replaced by a confusing one. This is true of any
     * trigger-raised or otherwise unnamed integrity error, so the guard is
     * written generally rather than special-cased for either trigger — and the
     * loop keeps walking the cause chain afterwards, in case a named violation
     * sits deeper in it.
     *
     * <p>A {@code null} name is correctly <em>not</em> a name conflict: the
     * caller rethrows, {@code GlobalExceptionHandler} logs it and answers
     * {@code 500 INTERNAL_ERROR}, which is the honest outcome for a database
     * invariant that this service's own checks should have caught first.
     */
    private static boolean isUniqueNameViolation(DataIntegrityViolationException ex) {
        for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException violation) {
                String constraintName = violation.getConstraintName();
                if (constraintName != null) {
                    String foldedName = constraintName.toLowerCase(Locale.ROOT);
                    return UNIQUE_NAME_CONSTRAINTS.stream().anyMatch(foldedName::contains);
                }
            }
        }
        return false;
    }

    /**
     * "Does one of this row's siblings already use this name, folding case?"
     * — the create-path pre-check, scoped by level (ADR 0019 §3).
     *
     * <p>The two branches are explicit rather than one query taking a
     * possibly-null parent id, because {@code parent_category_id = NULL} is
     * never true in SQL: a single parameterized query would silently answer
     * "no conflict" for every top-level name, i.e. it would look like it
     * worked while enforcing nothing.
     */
    private boolean isDuplicateSiblingName(UUID userId, UUID parentCategoryId, String name) {
        // Live siblings only (ADR 0024 §4.2) — the same rows V15's partial
        // indexes cover, so a deleted 'Food' never blocks a new 'Food'.
        if (parentCategoryId == null) {
            return categoryRepository.existsByUserIdAndParentCategoryIdIsNullAndNameIgnoreCaseAndDeletedAtIsNull(
                    userId, name);
        }
        return categoryRepository.existsByUserIdAndParentCategoryIdAndNameIgnoreCaseAndDeletedAtIsNull(
                userId, parentCategoryId, name);
    }

    /** The same live-sibling check for an update, excluding the row being updated. */
    private boolean isDuplicateSiblingName(UUID userId, UUID parentCategoryId, String name, UUID excludedId) {
        if (parentCategoryId == null) {
            return categoryRepository.existsByUserIdAndParentCategoryIdIsNullAndNameIgnoreCaseAndIdNotAndDeletedAtIsNull(
                    userId, name, excludedId);
        }
        return categoryRepository.existsByUserIdAndParentCategoryIdAndNameIgnoreCaseAndIdNotAndDeletedAtIsNull(
                userId, parentCategoryId, name, excludedId);
    }

    /**
     * The children of a just-updated row, for its response.
     *
     * <p>A subcategory has none by the depth rule, so that case costs no
     * query. A top-level row needs one bounded read: returning an empty
     * {@code subcategories} array for a parent that has children would be a
     * lie, and a client that writes this response into its store (which is
     * exactly what the settings store already does, and what
     * {@code useCategoriesStore} will do) would read it as "this parent's
     * subcategories are gone".
     */
    private List<CategoryResponse> childrenOf(UUID userId, Category category) {
        if (category.getParentCategoryId() != null) {
            return List.of();
        }
        // Live children only (ADR 0024 §4.2).
        return categoryRepository
                .findByUserIdAndParentCategoryIdAndDeletedAtIsNullOrderByCreatedAtAscNameAsc(userId, category.getId())
                .stream()
                .map(child -> toResponse(child, List.of()))
                .toList();
    }

    /**
     * Assembles one user's flat row set into the contract's two-level tree
     * (api-overview.md §3.1).
     *
     * <p>Two passes over the same list, no further queries: the first groups
     * every row that has a parent under that parent's id, the second emits the
     * top-level rows in the repository's deterministic order, each carrying
     * its own children in that same order. {@code subcategories} is always a
     * list, never {@code null} — {@code []} for a leaf and for a childless
     * parent.
     *
     * <p>Two states this cannot produce, both impossible by construction
     * rather than by care here: a child whose parent is absent (the composite
     * foreign key {@code (user_id, parent_category_id) → (user_id, id)}
     * guarantees the parent is one of this same user's rows; since ADR 0024 the
     * input is live rows only, and a live child under a soft-deleted parent is
     * prevented by the {@code FOR SHARE} parent fetch on create and by
     * {@link #deleteCategory}'s post-condition), and a grandchild (the depth-1
     * rule). If either ever appeared —
     * only reachable by direct SQL against the database — the row would be
     * silently absent from this response rather than crashing it. That is the
     * right failure mode for an impossible state in a read path, and it is
     * recorded here so it is a known property rather than a surprise.
     */
    private static List<CategoryResponse> toTree(List<Category> rows) {
        Map<UUID, List<CategoryResponse>> childrenByParentId = new LinkedHashMap<>();
        for (Category row : rows) {
            if (row.getParentCategoryId() != null) {
                childrenByParentId
                        .computeIfAbsent(row.getParentCategoryId(), parentId -> new ArrayList<>())
                        .add(toResponse(row, List.of()));
            }
        }

        List<CategoryResponse> topLevel = new ArrayList<>();
        for (Category row : rows) {
            if (row.getParentCategoryId() == null) {
                // copyOf, so the DTO handed to Jackson holds no reference to
                // the mutable accumulator above — a record component that is a
                // live ArrayList is a sharp edge worth not leaving behind.
                List<CategoryResponse> children = childrenByParentId.getOrDefault(row.getId(), List.of());
                topLevel.add(toResponse(row, List.copyOf(children)));
            }
        }
        return List.copyOf(topLevel);
    }

    /**
     * A valid token whose user row no longer exists is a 401, not a 404 — the
     * missing resource <em>is</em> the principal (same rule as Domain 2).
     */
    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }

    private static CategoryResponse toResponse(Category category, List<CategoryResponse> subcategories) {
        return new CategoryResponse(
                category.getId(),
                category.getName(),
                category.getIconName(),
                category.getGlyph(),
                category.getMonthlyCap(),
                category.isDefaultCategory(),
                category.isProtectedCategory(),
                category.getParentCategoryId(),
                subcategories,
                category.getCreatedAt(),
                category.getUpdatedAt());
    }
}
