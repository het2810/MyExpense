package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.hibernate.exception.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.BudgetCategoryCapRequest;
import com.myexpense.backend.dto.request.UpsertBudgetPeriodRequest;
import com.myexpense.backend.dto.response.BudgetCategoryCapResponse;
import com.myexpense.backend.dto.response.BudgetPeriodResponse;
import com.myexpense.backend.entity.BudgetPeriod;
import com.myexpense.backend.entity.BudgetPeriodCategoryCap;
import com.myexpense.backend.entity.Category;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.exception.BudgetPeriodNotFoundException;
import com.myexpense.backend.exception.BudgetRuleViolationException;
import com.myexpense.backend.exception.CategoryNotFoundException;
import com.myexpense.backend.exception.NoActivePeriodException;
import com.myexpense.backend.exception.PeriodOverlapException;
import com.myexpense.backend.exception.SubcategoryCapNotSupportedException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.BudgetPeriodCategoryCapRepository;
import com.myexpense.backend.repository.BudgetPeriodRepository;
import com.myexpense.backend.repository.BudgetCategoryCapRow;
import com.myexpense.backend.repository.CategoryRepository;
import com.myexpense.backend.repository.EntityInserter;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.sync.ChangeLogEntityTypes;
import com.myexpense.backend.sync.ChangeSets;
import com.myexpense.backend.sync.ClientIds;
import com.myexpense.backend.sync.IdempotentWriteExecutor;
import com.myexpense.backend.sync.LastWriteWins;
import com.myexpense.backend.sync.WriteContext;
import com.myexpense.backend.sync.WriteResult;

/**
 * Business rules for the Budget domain (api-overview.md §5.1–§5.3), against
 * {@code database/migrations/V14__budget.sql} and every item of its CONTRACT
 * block.
 *
 * <p>Every method takes the authenticated {@code userId} and scopes every read
 * and write by it (security-architecture.md §2). An id that is unknown
 * <em>or</em> belongs to another account is a {@code 404} — never a {@code 403},
 * which would confirm the id is real.
 *
 * <h2>"The active period" is the most recently CREATED period</h2>
 *
 * <p>Not the one covering today. data-model.md §3.1, api-overview.md §5's intro
 * and ADR 0011 all define it that way and all three state the consequence: the
 * row is returned regardless of whether its {@code end_date} has passed, and the
 * client decides "ended" by comparing {@code endDate} to today. Nothing in this
 * class computes that comparison, and no response field reports it.
 * <strong>data-model.md's Indexes section contradicts this</strong> — flagged by
 * {@code V14} FLAG 1 and flagged onward in backend/README.md §18.6, not resolved
 * here.
 *
 * <h2>{@code 404 NO_ACTIVE_PERIOD} is a normal answer</h2>
 *
 * <p>{@code V14} contract item 2: it is ADR 0011's first-run signal, and
 * immediately after {@code V14} is applied it is the answer for every existing
 * user, because nothing is backfilled. It is therefore not logged as a failure.
 *
 * <h2>The upsert is one transaction, and the cap rows are REPLACED</h2>
 *
 * <p>{@code V14} contract item 3. The request's {@code categoryCaps} array is the
 * complete new set, so an edit deletes the period's existing cap rows and inserts
 * the new ones inside the same {@code @Transactional} boundary — a
 * partially-replaced cap set is a budget the user never set. {@code category_name}
 * is resolved <strong>fresh at every save</strong>, including on an edit: a save
 * is a new decision, so it snapshots the name as it is now. What §3.2 forbids is
 * rewriting a row that is <em>not</em> being saved, which is why
 * {@link #updatePeriodCaps} is reached only from the save path and why nothing
 * here propagates a category rename or delete onto a stored cap (ADR 0021 §2.5;
 * the rename half is that ADR's Open Question 3 and belongs to the Project
 * Owner).
 *
 * <h2>The transactional-rollback audit for this class</h2>
 *
 * <p><strong>No {@code noRollbackFor} anywhere, and that is a conclusion rather
 * than an omission</strong> (backend/README.md §3's trap, which has silently
 * broken two features in this project). The upsert writes a period and then its
 * caps, so it is exactly the shape that trap waits for; audited statement by
 * statement:
 * <ul>
 *   <li><strong>Every user-facing rejection is decided BEFORE the first
 *       write.</strong> Reversed dates, {@code 404 BUDGET_PERIOD_NOT_FOUND},
 *       {@code 404 CATEGORY_NOT_FOUND}, the subcategory refusal, the duplicate
 *       category and {@code 400 PERIOD_OVERLAP} are all resolved in phase 1,
 *       where there is nothing written for a rollback to discard.</li>
 *   <li><strong>The only throws that can arrive after a write are the two
 *       translated constraint violations</strong> — the exclusion constraint
 *       losing a concurrent race, and the cap uniqueness index — and for both,
 *       rolling back is the <em>required</em> outcome, not a trap to suppress:
 *       the whole point is that the overlapping period must not persist. A
 *       {@code noRollbackFor} there would commit the very row the error
 *       reports.</li>
 *   <li>PostgreSQL aborts the transaction on a constraint violation anyway, so
 *       there is no "keep the good half" option to choose even in principle.</li>
 * </ul>
 * Nothing here writes a counter, a revocation or an audit row that must survive
 * its own error, which is the only case {@code noRollbackFor} exists for.
 */
@Service
public class BudgetService {

    private static final Logger log = LoggerFactory.getLogger(BudgetService.class);

    /**
     * {@code V14}'s exclusion constraint — <strong>the one load-bearing
     * constraint name in this domain</strong>, and the first exclusion
     * constraint in this schema.
     *
     * <p>{@code EXCLUDE USING gist (user_id WITH =, daterange(start_date,
     * end_date, '[]') WITH &&)}, i.e. "no two of one user's periods may share a
     * day". It raises <strong>{@code SQLSTATE 23P01}
     * ({@code exclusion_violation})</strong>, a SQLSTATE this backend had never
     * seen before Domain 5 — every mapped violation until now was {@code 23505}
     * (unique), {@code 23503} (FK), {@code 23514} (CHECK), {@code 23502}
     * (not-null) or {@code 23000} (a trigger {@code RAISE}).
     *
     * <p><strong>It is matched by NAME, and no branch anywhere in this class
     * switches on a SQLSTATE</strong> ({@code V14} contract item 1). That is the
     * whole reason {@code 23P01} needs no special plumbing here: a handler
     * organised by SQLSTATE would have to grow a new branch and, until it did,
     * would answer {@code 500} for an ordinary user mistake. Organised by
     * constraint name, the new SQLSTATE is simply irrelevant.
     *
     * <p><strong>The service still pre-checks overlap and returns a clean
     * {@code 400 PERIOD_OVERLAP} itself</strong> ({@link #upsertPeriod}'s phase
     * 1). This constraint is the <em>race backstop</em> — two concurrent
     * {@code PUT}s that both passed a pre-check taken before either committed —
     * not the mapping. A double-tapped Save is enough to need it.
     */
    private static final String EXCLUSION_PERIOD_OVERLAP = "excl_budget_periods_user_period_overlap";

    /**
     * {@code uq_budget_period_category_caps_period_category} —
     * {@code UNIQUE (budget_period_id, category_id)}, {@code SQLSTATE 23505} →
     * {@code 400 VALIDATION_ERROR} for a duplicated category within one
     * {@code categoryCaps} array ({@code V14} contract item 1).
     *
     * <p>Pre-checked in phase 1 so the clean error comes from the service; this
     * is the backstop. Note it places no limit on rows whose {@code category_id}
     * has been nulled by a category delete — multiple {@code NULL}s never
     * conflict in PostgreSQL — which is exactly right: a period that capped three
     * since-deleted categories must keep all three rows.
     */
    private static final String UNIQUE_PERIOD_CATEGORY = "uq_budget_period_category_caps_period_category";

    private final BudgetPeriodRepository budgetPeriodRepository;
    private final BudgetPeriodCategoryCapRepository capRepository;
    private final CategoryRepository categoryRepository;
    private final UserRepository userRepository;

    public BudgetService(
            BudgetPeriodRepository budgetPeriodRepository,
            BudgetPeriodCategoryCapRepository capRepository,
            CategoryRepository categoryRepository,
            UserRepository userRepository,
            EntityInserter entityInserter,
            IdempotentWriteExecutor writeExecutor,
            ChangeLogWriter changeLogWriter) {
        this.budgetPeriodRepository = budgetPeriodRepository;
        this.capRepository = capRepository;
        this.categoryRepository = categoryRepository;
        this.userRepository = userRepository;
        this.entityInserter = entityInserter;
        this.writeExecutor = writeExecutor;
        this.changeLogWriter = changeLogWriter;
    }

    private final EntityInserter entityInserter;
    private final IdempotentWriteExecutor writeExecutor;
    private final ChangeLogWriter changeLogWriter;

    /**
     * {@code GET /api/v1/budget/active-period} (§5.1) — the caller's most
     * recently created period, with its complete cap list.
     *
     * <p>{@code 404 NO_ACTIVE_PERIOD} when the caller has never saved one, which
     * is a normal first-run answer and not logged as a failure.
     */
    @Transactional(readOnly = true)
    public BudgetPeriodResponse getActivePeriod(UUID userId) {
        requireUser(userId);
        BudgetPeriod period = budgetPeriodRepository
                .findFirstByUserIdOrderByCreatedAtDescIdDesc(userId)
                .orElseThrow(NoActivePeriodException::new);
        return toResponse(period);
    }

    /**
     * {@code GET /api/v1/budget/periods/{id}} (§5.3) — one period by id,
     * owner-scoped. Used by the Budget Summary retrospective to show a
     * just-ended period's final numbers, so a period whose {@code end_date} has
     * passed is a perfectly ordinary, expected subject here.
     */
    @Transactional(readOnly = true)
    public BudgetPeriodResponse getPeriod(UUID userId, UUID periodId) {
        requireUser(userId);
        BudgetPeriod period = budgetPeriodRepository
                .findByIdAndUserId(periodId, userId)
                .orElseThrow(BudgetPeriodNotFoundException::new);
        return toResponse(period);
    }

    /**
     * {@code PUT /api/v1/budget/periods} (§5.2) — edits the caller's period in
     * place when {@code id} is supplied ({@code 200 OK}), inserts a new one when
     * it is not ({@code 201 Created}).
     *
     * <p><strong>Two phases, and the boundary between them is the point.</strong>
     * Phase 1 resolves and rejects everything, touching nothing. Phase 2 writes.
     * That ordering is what makes {@code noRollbackFor} unnecessary (see the
     * class Javadoc) and what keeps every one of {@code V14}'s constraints
     * unreachable from a legal request.
     *
     * <p><strong>Editing an old period does not make it the active one.</strong>
     * {@code created_at} is {@code updatable = false}, so §5.1's answer is
     * unchanged by an edit — which is the correct reading of "most recently
     * created" and worth knowing before being surprised by it.
     */
    public WriteResult<BudgetPeriodResponse> upsertPeriod(
            UUID userId, UpsertBudgetPeriodRequest request, WriteContext context) {
        UUID requestedId = ClientIds.requireNotNil(request.id(), "id");
        // Not @Transactional: IdempotentWriteExecutor owns the boundary (ADR 0027 §4.3).
        // A replay answers the ORIGINAL 201 or 200.
        return writeExecutor.execute(userId, context,
                new IdempotentWriteExecutor.ReplayMatch(ChangeLogEntityTypes.BUDGET_PERIOD,
                        Set.of(ChangeLog.OPERATION_CREATE, ChangeLog.OPERATION_UPDATE), requestedId),
                recorded -> {
                    if (ChangeLog.OUTCOME_SUPERSEDED.equals(recorded.getOutcome())) {
                        return WriteResult.superseded();
                    }
                    BudgetPeriodResponse current = getPeriod(userId, recorded.getEntityId());
                    return ChangeLog.OPERATION_CREATE.equals(recorded.getOperation())
                            ? WriteResult.created(current)
                            : WriteResult.ok(current);
                },
                () -> doUpsertPeriod(userId, request, requestedId, context));
    }

    private WriteResult<BudgetPeriodResponse> doUpsertPeriod(
            UUID userId, UpsertBudgetPeriodRequest request, UUID requestedId, WriteContext context) {
        requireUser(userId);
        OffsetDateTime effectiveWriteAt = context.effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC));

        // -----------------------------------------------------------------
        // Phase 1 — resolve and reject. NOTHING is written in this phase.
        // -----------------------------------------------------------------

        // Re-checked server-side even though Bean Validation already rejected it
        // (UpsertBudgetPeriodRequest#isDateRangeValid), because the failure mode
        // behind this one is unusually bad: a reversed range reaching
        // daterange() raises SQLSTATE 22000 with NO constraint name, which
        // nothing can translate. chk_budget_periods_date_order fires first and
        // IS named, so the worst case is an honest 500 — but neither should ever
        // be reached, so this is the third guard. Cheapest rule first, and it
        // needs no database round trip.
        if (request.endDate().isBefore(request.startDate())) {
            throw BudgetRuleViolationException.periodDatesReversed();
        }

        // Owner-scoped: another user's period id is a 404, byte-identical to a
        // nonexistent one, and never a 403. This is also what keeps
        // fk_budget_period_category_caps_budget_period_id unreachable.
        //
        // ADR 0027 §3.4 changed one case: an id that exists NOWHERE now
        // creates a period with that id (201). Another user's id stays 404,
        // never ID_CONFLICT. Looked up write-locked, so the LWW compare below
        // and the edit cannot interleave with a concurrent PUT.
        BudgetPeriod existing = null;
        if (requestedId != null) {
            BudgetPeriod found = budgetPeriodRepository.findForUpdateById(requestedId).orElse(null);
            if (found != null && !userId.equals(found.getUserId())) {
                throw new BudgetPeriodNotFoundException();
            }
            existing = found;
        }
        Map<String, Object> before = existing == null ? Map.of() : loggedFields(existing);

        // LWW (ADR 0027 §5.2) on the update branch only; a budget period has no
        // delete, so the only reason here is newer_write.
        if (existing != null && context.lwwMode()) {
            String reason = LastWriteWins.supersededReason(false, existing.getLastClientWriteAt(), effectiveWriteAt);
            if (reason != null) {
                changeLogWriter.logSuperseded(userId, ChangeLogEntityTypes.BUDGET_PERIOD, existing.getId(),
                        ChangeSets.attempted(before, attemptedFields(request)), reason, context,
                        effectiveWriteAt, "your budget", ChangeLogWriter.Related.NONE);
                log.info("Budget period {} save superseded for user {} (reason={})",
                        existing.getId(), userId, reason);
                return WriteResult.superseded();
            }
        }

        List<ResolvedCap> resolvedCaps = resolveCaps(userId, request.categoryCapsOrEmpty());

        // *** THE OVERLAP PRE-CHECK — the primary path for 400 PERIOD_OVERLAP.
        // The exclusion constraint is the race backstop, not the mapping (V14
        // contract item 1). Both ends inclusive, matching V14's '[]' range
        // bounds exactly; see BudgetPeriodRepository#countOverlapping for the
        // interval algebra and the Jan 31 / Feb 1 worked examples.
        //
        // "Excluding the period being edited" (§5.2's own wording) is the
        // excludeId argument. It is null on a create, where there is no row to
        // exclude.
        long overlapping = budgetPeriodRepository.countOverlapping(
                userId,
                request.startDate(),
                request.endDate(),
                existing == null ? null : existing.getId());
        if (overlapping > 0) {
            // Counts and ids only — never the amount or any cap value
            // (constitution §23: personal financial information is never
            // logged). This one is worth an INFO because V14 FLAG 4 makes it
            // reachable from a screen that believes it cannot happen.
            log.info("Budget period save rejected for user {} — overlaps {} existing period(s)",
                    userId, overlapping);
            throw new PeriodOverlapException();
        }

        // -----------------------------------------------------------------
        // Phase 2 — write. One transaction, period then caps.
        // -----------------------------------------------------------------

        boolean created = existing == null;
        BudgetPeriod saved;
        if (created) {
            BudgetPeriod period = BudgetPeriod.builder()
                    .id(requestedId != null ? requestedId : UUID.randomUUID())
                    .userId(userId)
                    .periodType(request.periodType())
                    .startDate(request.startDate())
                    .endDate(request.endDate())
                    .amount(request.amount())
                    .lastClientWriteAt(effectiveWriteAt)
                    .build();
            // INSERT only (ADR 0027 §3.3): a client-supplied id is never merged.
            saved = insertPeriod(period);
        } else {
            BudgetPeriod period = applyTo(existing, request);
            period.setLastClientWriteAt(effectiveWriteAt);
            saved = persistPeriod(period);
        }
        updatePeriodCaps(saved.getId(), resolvedCaps, created);

        log.info("Budget period {} for user {} (id={}, type={}, caps={})",
                created ? "created" : "updated", userId, saved.getId(), saved.getPeriodType(),
                resolvedCaps.size());

        Map<String, Object> after = loggedFields(saved);
        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.BUDGET_PERIOD, saved.getId(),
                created ? ChangeLog.OPERATION_CREATE : ChangeLog.OPERATION_UPDATE,
                created ? ChangeSets.create(after) : ChangeSets.update(before, after),
                context, effectiveWriteAt, true);
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_BUDGET_SAVED, ChangeLogSentences.BUDGET_SAVED,
                ChangeLogSentences.budgetSaved(saved.getStartDate(), saved.getEndDate()),
                ChangeLogWriter.Related.NONE, changeLogId);

        BudgetPeriodResponse response = toResponse(saved);
        return created ? WriteResult.created(response) : WriteResult.ok(response);
    }

    /** ADR 0027 §6.3's logged fields; {@code categoryCaps} is one value, the whole array. */
    private Map<String, Object> loggedFields(BudgetPeriod period) {
        List<Map<String, Object>> caps = new ArrayList<>();
        for (BudgetCategoryCapRow cap : capRepository.findCapRowsByBudgetPeriodId(period.getId())) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("categoryId", cap.categoryId());
            entry.put("categoryName", cap.categoryName());
            entry.put("monthlyCap", cap.monthlyCap());
            caps.add(entry);
        }
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("periodType", period.getPeriodType());
        fields.put("startDate", period.getStartDate());
        fields.put("endDate", period.getEndDate());
        fields.put("amount", period.getAmount());
        fields.put("categoryCaps", caps);
        return fields;
    }

    private static Map<String, Object> attemptedFields(UpsertBudgetPeriodRequest request) {
        List<Map<String, Object>> caps = new ArrayList<>();
        for (BudgetCategoryCapRequest cap : request.categoryCapsOrEmpty()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("categoryId", cap.categoryId());
            entry.put("monthlyCap", cap.monthlyCap());
            caps.add(entry);
        }
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("periodType", request.periodType());
        fields.put("startDate", request.startDate());
        fields.put("endDate", request.endDate());
        fields.put("amount", request.amount());
        fields.put("categoryCaps", caps);
        return fields;
    }

    private BudgetPeriod insertPeriod(BudgetPeriod period) {
        try {
            return entityInserter.insert(period);
        } catch (DataIntegrityViolationException ex) {
            throw translateBudgetViolation(ex);
        }
    }

    /**
     * Copies the request's mutable fields onto an existing row.
     *
     * <p>{@code id}, {@code user_id} and {@code created_at} are deliberately
     * absent: all three are {@code updatable = false} on the entity, and
     * {@code created_at} in particular decides which period is "active".
     */
    private static BudgetPeriod applyTo(BudgetPeriod period, UpsertBudgetPeriodRequest request) {
        period.setPeriodType(request.periodType());
        period.setStartDate(request.startDate());
        period.setEndDate(request.endDate());
        period.setAmount(request.amount());
        return period;
    }

    /**
     * Resolves every {@code categoryCaps} entry into the row that will be
     * written — <strong>and rejects every ineligible one, before anything is
     * written</strong>.
     *
     * <p>Three rules, in this order, because the order is a decision rather than
     * an accident:
     * <ol>
     *   <li><strong>No duplicate category in one array</strong> →
     *       {@code 400 VALIDATION_ERROR}. A request-shape rule, so it is answered
     *       without a database round trip and without revealing anything about
     *       the ids. {@code uq_budget_period_category_caps_period_category} is
     *       the backstop.</li>
     *   <li><strong>The category must be the CALLER'S</strong> →
     *       {@code 404 CATEGORY_NOT_FOUND} (§5.2's error table). The database's
     *       {@code fk_budget_period_category_caps_category_id} guarantees the
     *       category <em>exists</em>, not that the caller owns it — this table
     *       has no {@code user_id} column, so V6/V9/V11's composite same-owner
     *       trick is not available ({@code V14}'s own note on that FK). This
     *       check is the only owner guarantee there is.</li>
     *   <li><strong>The category must be TOP-LEVEL</strong> →
     *       {@code 400 VALIDATION_ERROR}, <em>not</em> a {@code 404}: the row
     *       resolves and is owned by the caller, it is simply not eligible
     *       (§5.2, ADR 0019 §4). It reuses
     *       {@link SubcategoryCapNotSupportedException}, the same exception
     *       {@code POST}/{@code PATCH /categories} already throw for a
     *       {@code monthlyCap} on a subcategory — one rule, one message, one
     *       code. {@code V14} deliberately does not enforce this structurally
     *       (its FLAG 3: the fact lives on another table's row, and the roadmap
     *       already plans to relax the rule), so <strong>this is the only
     *       enforcement that exists</strong>.</li>
     * </ol>
     *
     * <p><strong>One query for the whole array, not one per entry</strong>
     * (constitution §10). The caller's <em>live</em> categories among the
     * requested ids are read once, share-locked
     * ({@code CategoryRepository#findForShareByUserIdAndIdInAndDeletedAtIsNull},
     * ADR 0024 §4.2/§4.4), and both the name and the level come out of it, so a
     * 30-entry caps array costs one round trip rather than 30. Nothing is read
     * at all when the array is empty. A soft-deleted category's id is answered
     * {@code 404 CATEGORY_NOT_FOUND}, like an unknown one.
     *
     * <p><strong>{@code categoryName} is snapshotted here, fresh, on every
     * save</strong> — §5.2 does not accept it from the client, and this is the
     * single place in the backend that resolves it.
     */
    private List<ResolvedCap> resolveCaps(UUID userId, List<BudgetCategoryCapRequest> requested) {
        if (requested.isEmpty()) {
            return List.of();
        }

        Set<UUID> seen = new LinkedHashSet<>();
        for (BudgetCategoryCapRequest entry : requested) {
            if (!seen.add(entry.categoryId())) {
                throw BudgetRuleViolationException.duplicateCategoryCap();
            }
        }

        // Live, owner-scoped and SHARE-LOCKED, in one query for the whole
        // array (ADR 0024 §4.2/§4.4). A soft-deleted category is absent from
        // the result, so capping it is a 404 exactly like an unknown id — a
        // deleted category is not cappable. The FOR SHARE lock serializes this
        // save with a concurrent delete of a capped category.
        Map<UUID, Category> owned = new HashMap<>();
        for (Category category : categoryRepository.findForShareByUserIdAndIdInAndDeletedAtIsNull(userId, seen)) {
            owned.put(category.getId(), category);
        }

        List<ResolvedCap> resolved = new ArrayList<>(requested.size());
        for (BudgetCategoryCapRequest entry : requested) {
            Category category = owned.get(entry.categoryId());
            if (category == null) {
                throw new CategoryNotFoundException();
            }
            if (category.getParentCategoryId() != null) {
                throw new SubcategoryCapNotSupportedException();
            }
            resolved.add(new ResolvedCap(category.getId(), category.getName(), entry.monthlyCap()));
        }
        return resolved;
    }

    /**
     * Replaces one period's cap rows with the resolved set
     * ({@code V14} contract item 3).
     *
     * <p><strong>Delete-then-insert, with the delete issued as its own
     * statement</strong> — see
     * {@code BudgetPeriodCategoryCapRepository#deleteByBudgetPeriodId} for why
     * entity-level removal would violate the uniqueness index on any cap kept
     * across an edit (Hibernate orders inserts before deletes within one flush).
     *
     * <p>The delete is skipped on a create: a brand-new period id can have no cap
     * rows, so the statement would be a guaranteed zero-row {@code DELETE}.
     *
     * <p>Both halves run inside the caller's single transaction. If the insert
     * fails, the delete goes with it — a period left with its old caps is
     * recoverable; a period left with none is a budget the user never set.
     */
    private void updatePeriodCaps(UUID periodId, List<ResolvedCap> caps, boolean created) {
        if (!created) {
            capRepository.deleteByBudgetPeriodId(periodId);
        }
        if (caps.isEmpty()) {
            return;
        }
        List<BudgetPeriodCategoryCap> rows = new ArrayList<>(caps.size());
        for (ResolvedCap cap : caps) {
            rows.add(BudgetPeriodCategoryCap.builder()
                    .id(UUID.randomUUID())
                    .budgetPeriodId(periodId)
                    .categoryId(cap.categoryId())
                    // Server-resolved and frozen (§5.2). Never a request field.
                    .categoryName(cap.categoryName())
                    .monthlyCap(cap.monthlyCap())
                    .build());
        }
        persistCaps(rows);
    }

    /**
     * Flushed inside the transaction so a violation surfaces here — where it can
     * still be translated and rolled back — rather than at commit, after the
     * response has been built. The same reason {@code CategoryService#persist}
     * uses {@code saveAndFlush}, and the same wrinkle too: the id is assigned
     * rather than generated, so Spring Data merges and hands back a
     * <em>different</em> managed instance, and only that returned instance
     * carries the {@code @CreationTimestamp}/{@code @UpdateTimestamp} values the
     * response needs (backend/README.md §3, point 5).
     */
    private BudgetPeriod persistPeriod(BudgetPeriod period) {
        try {
            return budgetPeriodRepository.saveAndFlush(period);
        } catch (DataIntegrityViolationException ex) {
            throw translateBudgetViolation(ex);
        }
    }

    private List<BudgetPeriodCategoryCap> persistCaps(List<BudgetPeriodCategoryCap> rows) {
        try {
            return capRepository.saveAllAndFlush(rows);
        } catch (DataIntegrityViolationException ex) {
            throw translateBudgetViolation(ex);
        }
    }

    /**
     * Maps a budget-table integrity violation onto the exact code {@code V14}'s
     * CONTRACT assigns it, <strong>by full constraint name and never by parsing
     * driver message text or switching on a SQLSTATE</strong>.
     *
     * <p><strong>Null-safe by design, not by luck.</strong> {@code V14} repeats
     * the warning V6, V8, V10 and V11 each earned: not every integrity error
     * carries a constraint name — the two {@code categories} triggers in this
     * same application raise from plpgsql, and a {@code RAISE} has no associated
     * constraint, so {@link ConstraintViolationException#getConstraintName()}
     * returns {@code null} on those paths. Folding the case of that value without
     * a guard would throw a {@link NullPointerException} <em>inside</em> the
     * handler for the original failure, replacing a real error with a confusing
     * one. The loop keeps walking the cause chain after a null, in case a named
     * violation sits deeper in it.
     *
     * <p><strong>Full names, never a shared prefix.</strong> {@code V14} creates
     * five names beginning {@code chk_budget_} or {@code fk_budget_} and two
     * beginning {@code chk_budget_period_category_caps_}; neither string matched
     * here is a prefix or a substring of any of them, in either direction
     * ({@code V14} contract item 1's own warning).
     *
     * <p><strong>Everything else is rethrown unchanged and becomes a logged
     * {@code 500}</strong>, which is the honest answer, because every other
     * constraint on these two tables means a check in this class was skipped:
     * <ul>
     *   <li>{@code chk_budget_periods_amount_positive} and
     *       {@code chk_budget_period_category_caps_monthly_cap_positive} — Bean
     *       Validation's {@code @DecimalMin} answers both first.</li>
     *   <li>{@code chk_budget_periods_date_order} — three guards above it
     *       ({@code @AssertTrue}, phase 1's re-check).</li>
     *   <li>{@code chk_budget_period_category_caps_category_name_not_blank} —
     *       {@code V14} maps this one to {@code 500} explicitly, and rightly: the
     *       name is server-resolved, so a blank one is a service bug.</li>
     *   <li>{@code fk_budget_periods_user_id} — unreachable: the principal exists
     *       by definition of being authenticated.</li>
     *   <li>{@code fk_budget_period_category_caps_budget_period_id} — the period
     *       row is written in the same transaction, before its caps.</li>
     *   <li>{@code fk_budget_period_category_caps_category_id} — every entry is
     *       pre-resolved owner-scoped, so a legal request never reaches it.</li>
     * </ul>
     *
     * <p><strong>One thing that could not be verified without a live run</strong>
     * (backend/README.md §18.8): whether Hibernate populates
     * {@code getConstraintName()} for {@code SQLSTATE 23P01} on this stack the
     * way the Project Owner confirmed it does for {@code 23505}. If it does not,
     * the exclusion constraint's race loser becomes a logged {@code 500} instead
     * of a {@code 400} — the pre-check still answers every sequential overlap, so
     * only the concurrent case is affected, and the fix is local to this method.
     */
    private static RuntimeException translateBudgetViolation(DataIntegrityViolationException ex) {
        for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException violation) {
                String constraintName = violation.getConstraintName();
                if (constraintName != null) {
                    String folded = constraintName.toLowerCase(Locale.ROOT);
                    if (folded.contains(EXCLUSION_PERIOD_OVERLAP)) {
                        return new PeriodOverlapException();
                    }
                    if (folded.contains(UNIQUE_PERIOD_CATEGORY)) {
                        return BudgetRuleViolationException.duplicateCategoryCap();
                    }
                    return ex;
                }
            }
        }
        return ex;
    }

    /**
     * Loads a period's caps and assembles the response — one query for the
     * period's whole cap list, never one per cap (constitution §10,
     * {@code V14} contract item 7).
     *
     * <p><strong>The caps are re-read from the database even on the write
     * path</strong>, rather than reusing the list just inserted, so all three
     * endpoints order {@code categoryCaps} identically. Ordering in Java instead
     * would compare strings with {@code String.compareTo} while the two read
     * endpoints compare them with PostgreSQL's collation — the same array in two
     * different orders, for no benefit beyond one saved round trip.
     */
    private BudgetPeriodResponse toResponse(BudgetPeriod period) {
        List<BudgetCategoryCapResponse> caps = capRepository
                .findCapRowsByBudgetPeriodId(period.getId())
                .stream()
                .map(cap -> new BudgetCategoryCapResponse(
                        // Nullable: null means the capped category has since
                        // been deleted. Produced on read by the repository's
                        // liveness-only join (ADR 0024 §4.6) — the stored
                        // category_id is never nulled. The frozen name is what
                        // renders; nothing reads a display value from
                        // categories.
                        cap.categoryId(),
                        cap.categoryName(),
                        cap.monthlyCap()))
                .toList();

        return new BudgetPeriodResponse(
                period.getId(),
                period.getPeriodType(),
                period.getStartDate(),
                period.getEndDate(),
                period.getAmount(),
                caps,
                period.getCreatedAt(),
                period.getUpdatedAt());
    }

    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }

    /**
     * One {@code categoryCaps} entry after resolution: the owned, top-level
     * category it names, the <strong>freshly snapshotted</strong> name, and the
     * cap.
     *
     * <p>A value object rather than a half-built entity, so phase 1 can finish
     * every rejection before phase 2 constructs anything persistable.
     */
    private record ResolvedCap(UUID categoryId, String categoryName, BigDecimal monthlyCap) {
    }
}
