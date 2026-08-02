package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.hibernate.exception.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.CreateTransactionRequest;
import com.myexpense.backend.dto.request.ListTransactionsQuery;
import com.myexpense.backend.dto.request.UpdateTransactionRequest;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.dto.response.TransactionResponse;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.entity.PaymentMode;
import com.myexpense.backend.entity.Transaction;
import com.myexpense.backend.entity.TransactionScope;
import com.myexpense.backend.entity.TransactionType;
import com.myexpense.backend.entity.User;
import com.myexpense.backend.exception.GroupNotFoundException;
import com.myexpense.backend.exception.IdConflictException;
import com.myexpense.backend.exception.NotGroupMemberException;
import com.myexpense.backend.exception.ReceiptAlreadyAttachedException;
import com.myexpense.backend.exception.TransactionNotFoundException;
import com.myexpense.backend.exception.TransactionRuleViolationException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.exception.VersionConflictException;
import com.myexpense.backend.exception.WriteRequestValidationException;
import com.myexpense.backend.repository.EntityInserter;
import com.myexpense.backend.repository.GroupMemberRepository;
import com.myexpense.backend.repository.TransactionRepository;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.sync.ChangeLogEntityTypes;
import com.myexpense.backend.sync.ChangeSets;
import com.myexpense.backend.sync.IdempotentWriteExecutor;
import com.myexpense.backend.sync.LastWriteWins;
import com.myexpense.backend.sync.WriteContext;
import com.myexpense.backend.sync.WriteResult;

/**
 * Business rules for the Transactions domain (api-overview.md §4.1–§4.5).
 *
 * <p>Every method takes the authenticated {@code userId} and scopes every read
 * and write to it — there is no method here that can address another user's
 * transaction. The id is resolved from the JWT by {@code @CurrentUserId} in the
 * controller and passed straight through (security-architecture.md §2). A
 * transaction id that belongs to someone else, does not exist, or has been
 * soft-deleted is one identical {@code 404 TRANSACTION_NOT_FOUND}, never a
 * {@code 403}.
 *
 * <h2>Where each rule lives, and why not here</h2>
 *
 * <ul>
 *   <li><strong>The income/expense category rule</strong> —
 *       {@link CategorySnapshotResolver}, called from both write paths so
 *       §4.4's two {@code type} transitions cannot diverge from §4.2's create
 *       rule.</li>
 *   <li><strong>The six snapshot values</strong> — {@link CategorySnapshot},
 *       which applies all six together or none.</li>
 *   <li><strong>The {@code receiptPublicId} claim check</strong> —
 *       {@link ReceiptPublicIdPolicy}.</li>
 *   <li><strong>Single-field constraints</strong> — Bean Validation on the
 *       request DTOs, never ad-hoc {@code if}s here
 *       (security-architecture.md §3). Everything below is a genuine
 *       cross-field rule.</li>
 * </ul>
 *
 * <h2>No {@code noRollbackFor} anywhere in this class — checked, not assumed</h2>
 *
 * <p>backend/README.md §3 (points 3 and 4) records how that trap silently broke
 * account lockout and refresh-token-family revocation in Domain 1: a method that
 * writes and <em>then</em> throws needs the rollback suppressed on every
 * transactional boundary in the call chain. Nothing here does that:
 *
 * <ul>
 *   <li>{@link #createTransaction} and {@link #updateTransaction} are written in
 *       Domain 2/3's two explicit phases — <em>every</em> rejection
 *       ({@code 400}, the {@code 403 NOT_GROUP_MEMBER} membership gate,
 *       {@code 404}, {@code 409 VERSION_CONFLICT}, the pre-checked
 *       {@code 409 RECEIPT_ALREADY_ATTACHED}) is decided before a single field
 *       is mutated. <strong>That is why the group-membership check needs no
 *       {@code noRollbackFor}</strong>: it is a read in phase 1, so nothing has
 *       been written when it throws and the rollback it triggers has nothing to
 *       undo (re-confirmed when the check became real — see
 *       {@link #requireScopeAndGroupAgree});</li>
 *   <li>{@link #persist} translates a constraint violation into a {@code 409} or
 *       a {@code 404} <em>after</em> a failed flush — the write never landed, so
 *       rolling back is correct;</li>
 *   <li>{@link #deleteTransaction} writes once and cannot throw afterwards.</li>
 * </ul>
 *
 * <p>Re-check this if a future change adds an {@code activities} row, a counter,
 * or any audit write that must survive a rejection — Domain 6's split writes are
 * the first place that is likely.
 *
 * <h2>The application owns {@code version} and {@code updated_at}</h2>
 *
 * <p>{@code V7__transactions.sql} adds <strong>no trigger</strong> for either
 * (Database Architect, 2026-10-24), consistent with V1–V6.
 * {@code @UpdateTimestamp} on the entity maintains {@code updated_at} — which
 * matters beyond cosmetics, because it is the confirmed last-write-wins column
 * for sync (security-architecture.md §9) — and {@link #updateTransaction} is the
 * only thing that increments {@code version}. Any future write path that
 * bypasses the persistence layer (a bulk JPQL {@code UPDATE}, raw SQL) would
 * silently skip both.
 */
@Service
public class TransactionService {

    private static final Logger log = LoggerFactory.getLogger(TransactionService.class);

    /**
     * The contract's {@code "HH:mm"} (api-overview.md §4.1), used for both
     * directions: parsing the validated request string and formatting the
     * response. One formatter so the two can never disagree.
     */
    private static final DateTimeFormatter TXN_TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");

    /**
     * {@code transactions.version} on a brand-new row — matching both
     * api-overview.md §4.1's example and the column's own
     * {@code DEFAULT 1}. Assigned explicitly rather than relying on that
     * default, because Hibernate always supplies a value for a mapped
     * {@code NOT NULL} column, so the default would never actually apply.
     */
    private static final int INITIAL_VERSION = 1;

    /**
     * The partial unique index that enforces "one Cloudinary asset belongs to
     * exactly one transaction" — {@code uq_transactions_receipt_public_id} on
     * {@code (receipt_public_id) WHERE receipt_public_id IS NOT NULL}
     * (data-model.md Indexes, ADR 0020 §3) — which must map to
     * {@code 409 RECEIPT_ALREADY_ATTACHED}.
     *
     * <p>Matched by <strong>constraint name</strong>, never by parsing driver
     * message text, exactly as {@code CategoryService.UNIQUE_NAME_CONSTRAINTS}
     * does. A partial unique index reports identically to a table constraint:
     * PostgreSQL raises {@code SQLSTATE 23505} and puts the <em>index's</em>
     * name in the error's {@code CONSTRAINT} field, which is what
     * {@link ConstraintViolationException#getConstraintName()} surfaces — the
     * partial {@code WHERE} clause appears only in the error {@code DETAIL}.
     * That reasoning is live-verified for Domain 3's indexes.
     *
     * <p>A {@link List} of one, deliberately, rather than a bare {@link String}:
     * Domain 3's constant went from one name to two when a migration split its
     * index, and keeping the same shape here means that change would be a list
     * entry rather than a refactor.
     *
     * <p><strong>This name and {@code V7__transactions.sql} must agree.</strong>
     * If they do not, every <em>sequential</em> duplicate claim is still a clean
     * {@code 409} from the pre-check below, but a <em>concurrent</em> one
     * becomes a logged {@code 500}. It fails closed rather than loosely, and the
     * pre-check plus the index are both kept on purpose — the pre-check gives
     * the clean error, the index is the only real guard against the race.
     */
    private static final List<String> RECEIPT_UNIQUE_CONSTRAINTS =
            List.of("uq_transactions_receipt_public_id");

    /**
     * {@code 23503} → <strong>{@code 404 GROUP_NOT_FOUND}</strong>, which is the
     * mapping {@code V10__groups.sql}'s contract item 1 assigns this foreign key
     * by name. V10 added it ({@code transactions.group_id → groups.id}) as the
     * first half of the debt {@code V7__transactions.sql} recorded.
     *
     * <p><strong>It is the race backstop, not the error path.</strong> V10 says
     * so in those words: the constraint is "reachable only if a transaction is
     * written with a {@code groupId} the caller is not a member of, which §4.2's
     * membership check ({@code 403 NOT_GROUP_MEMBER}) must reject first". That
     * pre-check is {@link #requireScopeAndGroupAgree} and it resolves the group
     * through {@code group_members}, so a group that does not exist has no
     * membership row and is already a {@code 403}. What is left for this
     * constraint is the window between that check and the flush — which no
     * endpoint in this phase can open, since §7 has no group delete and every FK
     * in V10 is {@code NO ACTION}. Mapped anyway, because an unmapped integrity
     * violation is a {@code 500}.
     *
     * <p>Matched by <strong>full constraint name</strong> and never by a shared
     * prefix — V10 asks for that explicitly, and the names on this table sit
     * close together. Verified pairwise rather than assumed: this string is not a
     * substring of {@code fk_transactions_category_id},
     * {@code fk_transactions_user_id}, {@code fk_transactions_split_expense_id}
     * or {@code uq_transactions_receipt_public_id}, and — the one that looks like
     * a collision and is not — it is not a substring of
     * {@code chk_transactions_group_id_matches_scope} either, because that name
     * carries {@code chk_} where this one needs {@code fk_}, so the match breaks
     * on the leading {@code f}. Nothing extends this name, so no longer name can
     * contain it.
     */
    private static final String FK_TRANSACTIONS_GROUP = "fk_transactions_group_id";

    private final TransactionRepository transactionRepository;
    private final UserRepository userRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final CategorySnapshotResolver categorySnapshotResolver;
    private final ReceiptPublicIdPolicy receiptPublicIdPolicy;
    private final EntityInserter entityInserter;
    private final IdempotentWriteExecutor writeExecutor;
    private final ChangeLogWriter changeLogWriter;

    public TransactionService(
            TransactionRepository transactionRepository,
            UserRepository userRepository,
            GroupMemberRepository groupMemberRepository,
            CategorySnapshotResolver categorySnapshotResolver,
            ReceiptPublicIdPolicy receiptPublicIdPolicy,
            EntityInserter entityInserter,
            IdempotentWriteExecutor writeExecutor,
            ChangeLogWriter changeLogWriter) {
        this.transactionRepository = transactionRepository;
        this.userRepository = userRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.categorySnapshotResolver = categorySnapshotResolver;
        this.receiptPublicIdPolicy = receiptPublicIdPolicy;
        this.entityInserter = entityInserter;
        this.writeExecutor = writeExecutor;
        this.changeLogWriter = changeLogWriter;
    }

    /**
     * {@code GET /api/v1/transactions} — paginated and filtered
     * (api-overview.md §4.1).
     *
     * <p><strong>Paginated, unlike Domain 3's categories list</strong>: this is
     * the first genuinely unbounded list in the API (constitution §11). The page
     * size is capped by {@link ListTransactionsQuery}, so no single request can
     * be made to read the whole table.
     *
     * <p>The filters, the roll-up and the deterministic ordering are all in one
     * fixed JPQL query ({@code TransactionRepository#findFiltered}); this method
     * only converts the validated contract strings into enums and maps the page.
     * The conversions cannot throw — Bean Validation has already constrained
     * each to its exact contract literal.
     *
     * <p><strong>No join to {@code categories} happens here</strong>, for any
     * row: the five snapshot columns are what render, which is the whole purpose
     * of the denormalization (data-model.md §2.2). The only read that touches
     * that table is the {@code categoryId} roll-up, and it is a subquery inside
     * the same statement — never a per-row lookup.
     */
    @Transactional(readOnly = true)
    public PageResponse<TransactionResponse> listTransactions(UUID userId, ListTransactionsQuery query) {
        requireUser(userId);

        Page<Transaction> page = transactionRepository.findFiltered(
                userId,
                query.getScope() == null ? null : TransactionScope.fromValue(query.getScope()),
                query.getType() == null ? null : TransactionType.fromValue(query.getType()),
                query.getCategoryId(),
                query.getDateFrom(),
                query.getDateTo(),
                PageRequest.of(query.getPage(), query.getSize()));

        // A lambda rather than a TransactionService::toResponse method
        // reference, purely to leave no doubt about which of the two
        // toResponse overloads is selected.
        List<TransactionResponse> content = page.getContent().stream()
                .map(row -> toResponse(row))
                .toList();
        return PageResponse.of(page, content);
    }

    /**
     * {@code GET /api/v1/transactions/{id}} — owner-scoped single read
     * (api-overview.md §4.3), with the premium payment-method enrichment
     * applied.
     *
     * <p>The enrichment is gated on {@code users.is_premium} read from the
     * database, never on a client-side premium flag
     * (security-architecture.md §2) — which is why this is the one read here
     * that needs the {@link User} row rather than just an existence check.
     *
     * <p><strong>{@code receiptSignedUrl} is deliberately not produced</strong>
     * — the Cloudinary signing/delivery half of ADR 0020 is unbuilt (no
     * credentials, plan support unconfirmed; Project Owner, 2026-10-24). When it
     * lands, this is the only method in the API that may mint one, and only
     * after the owner-scoped fetch above has already succeeded: that ordering is
     * the access control (ADR 0020 §6), not a check someone has to remember.
     */
    @Transactional(readOnly = true)
    public TransactionResponse getTransaction(UUID userId, UUID transactionId) {
        User user = requireUser(userId);
        Transaction transaction = transactionRepository
                .findByIdAndUserIdAndDeletedAtIsNull(transactionId, userId)
                .orElseThrow(TransactionNotFoundException::new);
        return toDetailResponse(transaction, user.isPremium());
    }

    /**
     * {@code POST /api/v1/transactions} — {@code 201 Created}
     * (api-overview.md §4.2).
     *
     * <p>Two explicit phases: resolve and reject everything first, then build.
     * The order within phase 1 is deliberate: the scope/group "iff" and the
     * payment-split rule are dependency-free shape checks, so a malformed
     * request is answered without touching another table and without revealing
     * anything about an id it mentioned, and the two reads that <em>can</em>
     * reveal something — the group-membership gate and the owner-scoped category
     * resolution — are each the gate for the id they read. The membership query
     * sits inside {@link #requireScopeAndGroupAgree}, immediately after that
     * method's own shape check and therefore ahead of the payment split; a
     * request that is both a non-member group write and an unbalanced split is
     * {@code 403}, which is the precedence this endpoint has always had.
     */
    public WriteResult<TransactionResponse> createTransaction(
            UUID userId, CreateTransactionRequest request, WriteContext context) {
        UUID requestedId = resolveRequestedId(request);
        // Not @Transactional: IdempotentWriteExecutor owns the boundary so a
        // concurrent duplicate can be re-run as a replay (ADR 0027 §4.3).
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.TRANSACTION, ChangeLog.OPERATION_CREATE, requestedId),
                recorded -> WriteResult.created(currentResponse(userId, recorded.getEntityId())),
                () -> doCreateTransaction(userId, request, requestedId, context));
    }

    private WriteResult<TransactionResponse> doCreateTransaction(
            UUID userId, CreateTransactionRequest request, UUID requestedId, WriteContext context) {
        requireUser(userId);

        // ADR 0027 §3.3 step 3: explicit lookup of a client-supplied id,
        // soft-deleted rows included. Never save() with a client id.
        if (requestedId != null) {
            Transaction existing = transactionRepository.findById(requestedId).orElse(null);
            if (existing != null) {
                if (!userId.equals(existing.getUserId())) {
                    throw new IdConflictException();
                }
                return WriteResult.created(toResponse(existing));
            }
        }
        OffsetDateTime effectiveWriteAt = context.effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC));
        UUID newId = requestedId != null ? requestedId : UUID.randomUUID();

        TransactionType type = TransactionType.fromValue(request.type());
        TransactionScope scope = TransactionScope.fromValue(request.scope());
        PaymentMode paymentMode = PaymentMode.fromValue(request.paymentMode());

        // ---------------------------------------------------------------
        // Phase 1 — resolve each value and reject anything not allowed.
        // Nothing is written in this phase.
        // ---------------------------------------------------------------
        requireScopeAndGroupAgree(userId, scope, request.groupId());
        PaymentSplit split = resolvePaymentSplit(
                paymentMode, request.amount(), request.cashAmount(), request.onlineAmount(), null, null);
        CategorySnapshot snapshot = categorySnapshotResolver.resolve(userId, type, request.categoryId());
        String receiptPublicId = request.receiptPublicId();
        if (receiptPublicId != null) {
            receiptPublicIdPolicy.requireClaimableBy(userId, receiptPublicId);
            if (transactionRepository.existsByReceiptPublicId(receiptPublicId)) {
                throw new ReceiptAlreadyAttachedException();
            }
        }

        // ---------------------------------------------------------------
        // Phase 2 — build and persist.
        // ---------------------------------------------------------------
        Transaction transaction = Transaction.builder()
                .id(newId)
                .userId(userId)
                .title(request.title().trim())
                .txnDate(request.txnDate())
                // Cannot throw: @Pattern has already constrained the string to
                // HH:mm with a valid hour and minute.
                .txnTime(LocalTime.parse(request.txnTime(), TXN_TIME_FORMAT))
                .amount(request.amount())
                .type(type)
                .scope(scope)
                // Non-null exactly when scope='group', which phase 1 has already
                // established and whose membership it has already verified. The
                // builder was written to carry the value through rather than
                // hardcode a null for precisely this moment: making the check
                // real changed one method and left this line alone.
                .groupId(request.groupId())
                .paymentMode(paymentMode)
                .cashAmount(split.cashAmount())
                .onlineAmount(split.onlineAmount())
                // Stored exactly as sent: notes are free text, so trimming
                // could silently alter a deliberately formatted note. Clearing
                // is expressed by PATCH's explicit null, not by a blank string.
                .notes(request.notes())
                .receiptPublicId(receiptPublicId)
                // ADR 0027 §3.5: client_id = id on every new row; nothing reads it.
                .clientId(newId)
                .version(INITIAL_VERSION)
                .lastClientWriteAt(effectiveWriteAt)
                .build();
        snapshot.applyTo(transaction);

        // INSERT only (EntityInserter -> persist): a colliding id fails on the
        // primary key instead of merging over another user's row.
        Transaction saved = insert(transaction);
        // Never the amount, the title or the note — transaction amounts and
        // merchant detail are personal financial information (constitution §23,
        // security-architecture.md §8). Ids, the coarse operation shape, and
        // whether a receipt was attached are all that is logged;
        // receipt_public_id itself is explicitly safe to log, but the boolean is
        // what is actually useful here.
        log.info("Transaction created for user {} (id={}, type={}, paymentMode={}, receiptAttached={})",
                userId, saved.getId(), saved.getType().getValue(), saved.getPaymentMode().getValue(),
                saved.getReceiptPublicId() != null);

        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.TRANSACTION, saved.getId(),
                ChangeLog.OPERATION_CREATE, ChangeSets.create(loggedFields(saved, true)), context,
                effectiveWriteAt, true);
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_TRANSACTION_CREATED,
                ChangeLogSentences.TRANSACTION_CREATED,
                ChangeLogSentences.transactionCreated(saved.getTitle(), saved.getAmount()),
                ChangeLogWriter.Related.transaction(saved.getId()), changeLogId);
        return WriteResult.created(toResponse(saved));
    }

    /**
     * {@code PATCH /api/v1/transactions/{id}} — owner-scoped partial update
     * (api-overview.md §4.4).
     *
     * <h2>Optimistic concurrency</h2>
     *
     * <p>The row is fetched <strong>with a write lock</strong>
     * ({@code SELECT ... FOR UPDATE}), then the submitted {@code version} is
     * compared to the stored one; a mismatch is
     * {@code 409 VERSION_CONFLICT} and nothing is mutated. On success
     * {@code version} is incremented by exactly one. The lock is what makes the
     * compare-then-increment atomic — without it two concurrent patches holding
     * the same stale version would both pass and one would silently overwrite
     * the other, which is the exact outcome this error code exists to prevent
     * (security-architecture.md §9). See {@code Transaction#version} for why a
     * JPA {@code @Version} field was not used.
     *
     * <h2>Partial-update semantics</h2>
     *
     * <p>Absent fields leave their column untouched. {@code notes} and
     * {@code receiptPublicId} additionally distinguish absent from explicitly
     * {@code null}, which <em>clears</em> them — §3.3's verified
     * {@code monthlyCap} convention applied unchanged, via the same presence-flag
     * mechanism ({@link UpdateTransactionRequest}). Clearing
     * {@code receiptPublicId} clears the column and nothing else: the Cloudinary
     * asset is never destroyed (ADR 0020 §9).
     *
     * <p>{@code txnTime} is not updatable and is not a field on the request.
     *
     * <p><strong>{@code scope} and {@code groupId} are judged on their
     * <em>effective</em> values</strong> (supplied, else stored) and go through
     * the same gate as a create, so a {@code PATCH} cannot move a transaction
     * into a group the caller is not a member of. One consequence is newly
     * reachable and is a known gap rather than a rule: a group transaction cannot
     * be demoted to {@code personal}, because this field has no
     * absent-vs-explicit-{@code null} distinction with which to clear the stored
     * group id — see {@link UpdateTransactionRequest}'s own note on that field.
     *
     * <h2>The two {@code type} transitions, and the one case that must NOT
     * re-derive</h2>
     *
     * <p>The snapshot is re-resolved if and only if {@code type} actually
     * changes or a {@code categoryId} is supplied, which is §4.4's rule stated
     * as code:
     *
     * <ul>
     *   <li>{@code expense → income}: {@code category_id} becomes {@code null}
     *       and all five snapshot values are overwritten with the income
     *       constants, {@code parent_category_name} included. A non-null
     *       {@code categoryId} in the same request is a {@code 400}.</li>
     *   <li>{@code income → expense}: {@code categoryId} becomes
     *       <strong>required in that same request</strong> — absent is a
     *       {@code 400}, because the row must not be left with
     *       {@code type='expense'}, {@code category_id = NULL} and
     *       {@code category_name = 'Income'}.</li>
     *   <li>a {@code type}-preserving patch that never touches
     *       {@code categoryId} leaves all five alone — which is what makes
     *       editing a transaction tagged to a subcategory, without opening the
     *       category picker, preserve the assignment. Re-deriving
     *       unconditionally would also <em>break</em> an expense row with a
     *       null reference and intact snapshot values (reachable only by direct
     *       SQL now that a category delete reassigns to {@code Misc}), by
     *       demanding a {@code categoryId} the client has no reason to
     *       send.</li>
     *   <li>a {@code type}-preserving patch that <em>does</em> change
     *       {@code categoryId} re-derives all five, including resetting
     *       {@code parent_category_name} to {@code null} if the new category is
     *       top-level.</li>
     * </ul>
     *
     * <p><strong>Since ADR 0024:</strong> a {@code categoryId} naming a
     * soft-deleted category is {@code 404 CATEGORY_NOT_FOUND}, and any write
     * that actually changes {@code category_id} clears the internal
     * {@code reassigned_from_category_id} restore marker (§6.2). The marker is
     * never returned.
     */
    public WriteResult<TransactionResponse> updateTransaction(
            UUID userId, UUID transactionId, UpdateTransactionRequest request, WriteContext context) {
        // ADR 0027 §5.3: version is required in legacy mode only.
        if (!context.lwwMode() && request.getVersion() == null) {
            throw WriteRequestValidationException.versionRequired();
        }
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.TRANSACTION, ChangeLog.OPERATION_UPDATE, transactionId),
                recorded -> ChangeLog.OUTCOME_SUPERSEDED.equals(recorded.getOutcome())
                        ? WriteResult.<TransactionResponse>superseded()
                        : WriteResult.ok(currentResponse(userId, transactionId)),
                () -> doUpdateTransaction(userId, transactionId, request, context));
    }

    private WriteResult<TransactionResponse> doUpdateTransaction(
            UUID userId, UUID transactionId, UpdateTransactionRequest request, WriteContext context) {
        requireUser(userId);
        OffsetDateTime effectiveWriteAt = context.effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC));
        Transaction transaction;
        if (context.lwwMode()) {
            // LWW mode (ADR 0027 §5.2): lock the row INCLUDING soft-deleted
            // ones, owner-scoped; version is not checked.
            transaction = transactionRepository
                    .findForUpdateByIdAndUserId(transactionId, userId)
                    .orElseThrow(TransactionNotFoundException::new);
            String reason = LastWriteWins.supersededReason(
                    transaction.getDeletedAt() != null, transaction.getLastClientWriteAt(), effectiveWriteAt);
            if (reason != null) {
                // Logged and COMMITTED; the controller answers 409.
                changeLogWriter.logSuperseded(userId, ChangeLogEntityTypes.TRANSACTION, transactionId,
                        ChangeSets.attempted(loggedFields(transaction, false), attemptedFields(request)),
                        reason, context, effectiveWriteAt, transaction.getTitle(),
                        ChangeLogWriter.Related.transaction(transactionId));
                log.info("Transaction {} update superseded for user {} (reason={})", transactionId, userId, reason);
                return WriteResult.superseded();
            }
        } else {
            // Legacy mode: unchanged — live rows only, version checked.
            transaction = transactionRepository
                    .findForUpdateByIdAndUserIdAndDeletedAtIsNull(transactionId, userId)
                    .orElseThrow(TransactionNotFoundException::new);
            // A stale version means this request was composed against a row
            // that no longer exists in that form, so none of it should be
            // applied or even evaluated.
            if (transaction.getVersion() != request.getVersion()) {
                throw new VersionConflictException();
            }
        }
        Map<String, Object> before = loggedFields(transaction, false);

        // ---------------------------------------------------------------
        // Phase 1 — resolve each requested change and reject anything not
        // allowed. Nothing is mutated in this phase.
        // ---------------------------------------------------------------

        TransactionType effectiveType = request.getType() == null
                ? transaction.getType()
                : TransactionType.fromValue(request.getType());
        TransactionScope effectiveScope = request.getScope() == null
                ? transaction.getScope()
                : TransactionScope.fromValue(request.getScope());
        UUID effectiveGroupId = request.getGroupId() == null
                ? transaction.getGroupId()
                : request.getGroupId();
        requireScopeAndGroupAgree(userId, effectiveScope, effectiveGroupId);

        PaymentMode effectiveMode = request.getPaymentMode() == null
                ? transaction.getPaymentMode()
                : PaymentMode.fromValue(request.getPaymentMode());
        BigDecimal effectiveAmount = request.getAmount() == null
                ? transaction.getAmount()
                : request.getAmount();
        PaymentSplit split = resolvePaymentSplit(
                effectiveMode,
                effectiveAmount,
                request.getCashAmount(),
                request.getOnlineAmount(),
                transaction.getCashAmount(),
                transaction.getOnlineAmount());

        // null means "leave all five snapshot columns exactly as they are".
        CategorySnapshot snapshot = null;
        if (effectiveType != transaction.getType() || request.getCategoryId() != null) {
            snapshot = categorySnapshotResolver.resolve(userId, effectiveType, request.getCategoryId());
        }

        boolean receiptProvided = request.hasReceiptPublicId();
        String newReceiptPublicId = receiptProvided ? request.getReceiptPublicId() : null;
        if (newReceiptPublicId != null) {
            receiptPublicIdPolicy.requireClaimableBy(userId, newReceiptPublicId);
            // Excludes this row, so re-sending a transaction's own current
            // reference is never a conflict.
            if (transactionRepository.existsByReceiptPublicIdAndIdNot(newReceiptPublicId, transactionId)) {
                throw new ReceiptAlreadyAttachedException();
            }
        }

        // ---------------------------------------------------------------
        // Phase 2 — apply.
        // ---------------------------------------------------------------
        if (request.getTitle() != null) {
            transaction.setTitle(request.getTitle().trim());
        }
        if (request.getTxnDate() != null) {
            transaction.setTxnDate(request.getTxnDate());
        }
        transaction.setAmount(effectiveAmount);
        transaction.setType(effectiveType);
        transaction.setScope(effectiveScope);
        transaction.setGroupId(effectiveGroupId);
        transaction.setPaymentMode(effectiveMode);
        transaction.setCashAmount(split.cashAmount());
        transaction.setOnlineAmount(split.onlineAmount());
        if (snapshot != null) {
            // ADR 0024 §6.2: a client write that CHANGES category_id clears the
            // internal restore marker — the user re-tagged a row a category
            // delete had moved to Misc, which is a newer decision a future
            // restore must not undo. Compared before applyTo() overwrites the
            // stored id. Re-sending the row's current categoryId is not a
            // change and leaves the marker alone. expense -> income (category
            // becomes null) is a change and clears it.
            if (!Objects.equals(transaction.getCategoryId(), snapshot.categoryId())) {
                transaction.setReassignedFromCategoryId(null);
            }
            snapshot.applyTo(transaction);
        }
        if (request.hasNotes()) {
            transaction.setNotes(request.getNotes());
        }
        if (receiptProvided) {
            transaction.setReceiptPublicId(newReceiptPublicId);
        }
        transaction.setVersion(transaction.getVersion() + 1);
        // ADR 0027 §5.2: the applied client write moves the LWW clock.
        transaction.setLastClientWriteAt(effectiveWriteAt);

        Transaction saved = persist(transaction);
        // Which fields changed and the coarse shape of the change — never a
        // value (constitution §23).
        log.info("Transaction {} updated for user {} (version={}, type={}, paymentMode={}, "
                        + "categoryResnapshotted={}, notes={}, receipt={})",
                saved.getId(), userId, saved.getVersion(), saved.getType().getValue(),
                saved.getPaymentMode().getValue(), snapshot != null,
                request.hasNotes() ? (request.getNotes() == null ? "cleared" : "set") : "unchanged",
                receiptProvided ? (newReceiptPublicId == null ? "cleared" : "set") : "unchanged");

        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.TRANSACTION, saved.getId(),
                ChangeLog.OPERATION_UPDATE, ChangeSets.update(before, loggedFields(saved, false)), context,
                effectiveWriteAt, true);
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_TRANSACTION_EDITED,
                ChangeLogSentences.TRANSACTION_EDITED, ChangeLogSentences.transactionEdited(saved.getTitle()),
                ChangeLogWriter.Related.transaction(saved.getId()), changeLogId);
        return WriteResult.ok(toResponse(saved));
    }

    /**
     * {@code DELETE /api/v1/transactions/{id}} — <strong>soft</strong> delete,
     * {@code 204 No Content} (api-overview.md §4.5).
     *
     * <p>Sets {@code deleted_at} and removes nothing: offline clients need
     * deletes to <em>propagate</em> through {@code /sync/pull} rather than vanish
     * (constitution §14). The row is then excluded from every read in this
     * domain, so a second {@code DELETE} of the same id is a {@code 404} — see
     * {@link TransactionNotFoundException} for why that follows from the
     * contract rather than being a separate choice.
     *
     * <p><strong>{@code version} is deliberately not incremented.</strong> The
     * contract defines {@code version} purely as the conflict check for
     * {@code PATCH} (§4.4, security-architecture.md §9), and this endpoint takes
     * no body, performs no check and returns no row — so a bump would be
     * unobservable through the API. What sync actually reads is
     * {@code updated_at}, under the confirmed last-write-wins rule, and
     * {@code @UpdateTimestamp} advances that here. Bumping {@code version} as
     * well would be inventing a second signal with no specified consumer. One
     * consequence, correct and worth stating: a client holding a stale row can
     * still send a {@code PATCH} whose {@code version} matches, and gets a
     * {@code 404} rather than a {@code 409} — "it is gone" is the more useful
     * answer than "it moved on".
     *
     * <p>The row keeps its {@code receipt_public_id}, and therefore keeps the
     * Cloudinary asset and its uniqueness slot: no write path in this phase
     * destroys one (ADR 0020 §9).
     *
     * <p>The write-locked fetch is reused rather than a plain one, so a delete
     * racing a {@code PATCH} serialises instead of interleaving.
     */
    public WriteResult<Void> deleteTransaction(UUID userId, UUID transactionId, WriteContext context) {
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.TRANSACTION, ChangeLog.OPERATION_DELETE, transactionId),
                recorded -> WriteResult.noContent(),
                () -> doDeleteTransaction(userId, transactionId, context));
    }

    /**
     * Deletes are terminal (ADR 0027 §5.4): a live row is always deleted,
     * whatever its LWW timestamp; an already-deleted row stays the existing 404,
     * which clients treat as success. {@code last_client_write_at} is untouched.
     */
    private WriteResult<Void> doDeleteTransaction(UUID userId, UUID transactionId, WriteContext context) {
        requireUser(userId);
        Transaction transaction = transactionRepository
                .findForUpdateByIdAndUserIdAndDeletedAtIsNull(transactionId, userId)
                .orElseThrow(TransactionNotFoundException::new);
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        Map<String, Object> lastValues = loggedFields(transaction, false);

        transaction.setDeletedAt(now);
        persist(transaction);
        log.info("Transaction {} soft-deleted for user {}", transactionId, userId);

        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.TRANSACTION, transactionId,
                ChangeLog.OPERATION_DELETE, ChangeSets.delete(lastValues, now, Map.of()), context,
                context.effectiveWriteAt(now), true);
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_TRANSACTION_DELETED,
                ChangeLogSentences.TRANSACTION_DELETED,
                ChangeLogSentences.transactionDeleted(transaction.getTitle(), transaction.getAmount()),
                ChangeLogWriter.Related.transaction(transactionId), changeLogId);
        return WriteResult.noContent();
    }

    // -------------------------------------------------------------------
    // Cross-field rules
    // -------------------------------------------------------------------

    /**
     * The contract's "{@code groupId} required <strong>iff</strong>
     * {@code scope='group'}" (api-overview.md §4.2), enforced in both
     * directions, plus the group-membership gate.
     *
     * <p><strong>Order matters and is deliberate.</strong> The shape rule
     * ({@code group} needs an id) is answered first because it is cheap and
     * depends on nothing; only then does a well-formed group request reach the
     * membership gate, which costs a query.
     *
     * <h2>The membership gate — real since 2026-11-03, vacuous before it</h2>
     *
     * <p>Until {@code group_members} existed this method threw
     * {@code 403 NOT_GROUP_MEMBER} unconditionally, because the check §4.2
     * specifies was <em>vacuously false</em> for every input: with no membership
     * table, the caller was a member of no group. That rejected every
     * group-scoped write including a genuine member's, which is the bug the
     * Project Owner reported. {@code V10__groups.sql} created the table and it is
     * applied, so the check is now the real one:
     * {@code GroupMemberRepository#existsByGroupIdAndUserId} — the same single
     * query, in the same owner-scoped shape, that every §7 endpoint uses, with
     * {@code groupId} from the body and the user id from the JWT via
     * {@code @CurrentUserId} (never from a request field —
     * security-architecture.md §2).
     *
     * <p><strong>Registered members only, and that is not an omission.</strong>
     * The query matches on {@code group_members.user_id} and deliberately not on
     * {@code invited_contact_id}: a contact placeholder has no account, so it has
     * no principal that could be making an authenticated request. "The caller" is
     * always a registered member or nobody (that repository's own note).
     *
     * <h2>{@code 403} here, and {@code 403} for an unknown group too</h2>
     *
     * <p><strong>The code stays {@code 403 NOT_GROUP_MEMBER}, which differs from
     * §7's {@code 404 GROUP_NOT_FOUND} convention, and the difference is
     * approved.</strong> §4.2's error table assigns this endpoint {@code 403}
     * explicitly, and V10's contract item 1 records the divergence in those
     * words — "that endpoint's code differs from §7's 404 convention; that is the
     * approved contract and this FK does not change it". See
     * {@link NotGroupMemberException} for why it also does not violate
     * security-architecture.md §2.
     *
     * <p><strong>A {@code groupId} that names no group at all gets the same
     * {@code 403}</strong>, and that follows from the contract rather than being
     * a second choice: §4.2's error table has no {@code GROUP_NOT_FOUND} row, so
     * a {@code 404} here would be inventing a code this endpoint does not define
     * (constitution §15/§30). It is also the non-leaking answer, which is the
     * property §7 cares about: <em>one</em> query answers both halves, exactly as
     * {@link GroupNotFoundException} describes, so this method never learns
     * whether the group was absent or merely someone else's and cannot leak the
     * difference by accident. The two cases are one indistinguishable response.
     *
     * <p>The database agrees with all of it:
     * {@code chk_transactions_group_id_matches_scope} refuses a
     * {@code personal} row carrying a group id and a {@code group} row without
     * one (Database Architect, 2026-10-24), and {@code fk_transactions_group_id}
     * (V10) refuses a group id that references nothing. This method is the
     * friendly error; those two are backstops — see
     * {@link #FK_TRANSACTIONS_GROUP}.
     *
     * <p>Nothing is written before this returns, on either write path, which is
     * what makes the {@code noRollbackFor} trap a non-issue here rather than
     * something handled (see this class's Javadoc).
     */
    private void requireScopeAndGroupAgree(UUID userId, TransactionScope scope, UUID groupId) {
        if (scope == TransactionScope.GROUP) {
            if (groupId == null) {
                throw TransactionRuleViolationException.groupIdRequiredForGroupScope();
            }
            if (!groupMemberRepository.existsByGroupIdAndUserId(groupId, userId)) {
                throw new NotGroupMemberException();
            }
            return;
        }
        if (groupId != null) {
            throw TransactionRuleViolationException.groupIdNotAllowedForPersonalScope();
        }
    }

    /**
     * The {@code cash}/{@code online}/{@code both} rule, for creates and
     * updates alike (api-overview.md §4.2, security-architecture.md §3 — the
     * client's identical check is UX only and is never trusted).
     *
     * <p>Two shapes, and the asymmetry between them is the point:
     *
     * <ul>
     *   <li><strong>Not {@code both}</strong> → both columns are cleared. What
     *       is rejected here is a <em>supplied</em> non-null portion, not a
     *       stored one: switching a {@code both} transaction to {@code cash}
     *       must succeed without the client having to null out the portions it
     *       is abandoning, while a client that sends a portion alongside
     *       {@code cash} is stating something contradictory and gets a
     *       {@code 400}. An explicit {@code null} is fine, so a client that
     *       always sends every key is unaffected.</li>
     *   <li><strong>{@code both}</strong> → the <em>effective</em> portions
     *       (supplied, else stored) must both exist and sum exactly to the
     *       effective amount. One consequence worth knowing: patching
     *       {@code amount} alone on a {@code both} transaction is a
     *       {@code 400}, because the stored portions no longer add up. That is
     *       correct — the alternative is a row whose own arithmetic is briefly
     *       false, or a server guess at how to redistribute someone's
     *       money.</li>
     * </ul>
     *
     * <p>The comparison is {@link BigDecimal#compareTo} (exact decimal, scale
     * insensitive, so {@code 150.0} equals {@code 150.00}) over values already
     * constrained to at most two decimal places by {@code @Digits}. That is
     * stricter than security-architecture.md §3's "round to integer paise before
     * comparing" rather than an approximation of it, and it matches
     * {@code chk_transactions_cash_online_sum}, which also compares exactly.
     *
     * @param suppliedCash   the client's own {@code cashAmount}, or {@code null}
     *                       if it sent none
     * @param storedCash     the row's current value; {@code null} on a create
     */
    private static PaymentSplit resolvePaymentSplit(
            PaymentMode mode,
            BigDecimal amount,
            BigDecimal suppliedCash,
            BigDecimal suppliedOnline,
            BigDecimal storedCash,
            BigDecimal storedOnline) {

        if (mode != PaymentMode.BOTH) {
            if (suppliedCash != null || suppliedOnline != null) {
                throw TransactionRuleViolationException.paymentSplitNotAllowedForSingleMode();
            }
            return new PaymentSplit(null, null);
        }

        BigDecimal cash = suppliedCash != null ? suppliedCash : storedCash;
        BigDecimal online = suppliedOnline != null ? suppliedOnline : storedOnline;
        if (cash == null || online == null) {
            throw TransactionRuleViolationException.paymentSplitRequiredForBoth();
        }
        if (cash.add(online).compareTo(amount) != 0) {
            throw TransactionRuleViolationException.paymentSplitDoesNotSumToAmount();
        }
        return new PaymentSplit(cash, online);
    }

    /**
     * The resolved pair of payment-mode portions — both {@code null} unless the
     * mode is {@code both}.
     *
     * <p>A record rather than two out-parameters or a mutating helper, so that
     * "either both portions or neither" is expressed by the type and the two
     * columns cannot be assigned inconsistently — the same reason
     * {@link CategorySnapshot} groups its six values.
     */
    private record PaymentSplit(BigDecimal cashAmount, BigDecimal onlineAmount) {
    }

    // -------------------------------------------------------------------
    // Persistence + mapping
    // -------------------------------------------------------------------

    /**
     * Flushes inside the transaction so a unique-index violation surfaces here
     * rather than at commit, where it could no longer be mapped onto a
     * meaningful status code.
     *
     * <p>Only {@link #RECEIPT_UNIQUE_CONSTRAINTS} and
     * {@link #FK_TRANSACTIONS_GROUP} map to a client error. Everything else
     * {@code V7__transactions.sql} and {@code V10__groups.sql} can raise on this
     * table is rethrown and logged as an honest {@code 500}, and <strong>that is
     * correct</strong> — reaching one means a rule above was skipped, so a logged
     * stack trace beats a plausible-looking {@code 400}:
     *
     * <ul>
     *   <li>the eight {@code chk_transactions_*} CHECK constraints
     *       ({@code 23514}) — each restates a rule this class or a request DTO
     *       rejects first, {@code chk_transactions_group_id_matches_scope}
     *       included;</li>
     *   <li>{@code fk_transactions_category_id} ({@code 23503}) —
     *       {@link CategorySnapshotResolver} pre-resolves the category
     *       owner-scoped, so a legal request never reaches it.</li>
     *   <li>{@code fk_transactions_reassigned_from_category_id}
     *       ({@code 23503}, {@code V15}) — this class only ever writes
     *       {@code NULL} into that column, which no FK checks, so it is
     *       unreachable here; {@code V15} assigns it a {@code 500}.
     *       <strong>Neither matched name is a substring of it</strong>
     *       ({@code fk_transactions_group_id} breaks at
     *       {@code fk_transactions_r…}), so it cannot be mislabelled a
     *       {@code 404 GROUP_NOT_FOUND}.</li>
     * </ul>
     *
     * <p>Also note: the id is assigned rather than generated, so Spring Data
     * merges instead of persisting and hands back a <em>different</em> managed
     * instance. Only that returned instance carries the
     * {@code @CreationTimestamp}/{@code @UpdateTimestamp} values the response
     * needs — the same wrinkle backend/README.md §3 (point 5) records for
     * {@code register()}'s {@code createdAt}, and the reason every caller here
     * uses the return value rather than the instance it passed in.
     */
    private Transaction persist(Transaction transaction) {
        try {
            return transactionRepository.saveAndFlush(transaction);
        } catch (DataIntegrityViolationException ex) {
            throw translateWriteViolation(ex);
        }
    }

    /**
     * The create path's INSERT (ADR 0027 §3.3's JPA rule): {@code persist},
     * never {@code merge}. A primary-key violation is not mapped here — it is
     * rethrown unchanged so {@code IdempotentWriteExecutor} re-runs the request,
     * which then answers {@code 201} (caller's row) or {@code 409 ID_CONFLICT}.
     */
    private Transaction insert(Transaction transaction) {
        try {
            return entityInserter.insert(transaction);
        } catch (DataIntegrityViolationException ex) {
            throw translateWriteViolation(ex);
        }
    }

    /** ADR 0027 §3.5: {@code clientId} is a deprecated alias of {@code id}. */
    static UUID resolveRequestedId(CreateTransactionRequest request) {
        UUID id = request.id();
        UUID clientId = request.clientId();
        if (id != null && clientId != null && !id.equals(clientId)) {
            throw WriteRequestValidationException.idAndClientIdDiffer();
        }
        UUID requested = id != null ? id : clientId;
        if (requested != null && requested.getMostSignificantBits() == 0L
                && requested.getLeastSignificantBits() == 0L) {
            throw WriteRequestValidationException.nilId("id");
        }
        return requested;
    }

    /** Replay read: the caller's row in its current state, soft-deleted included (ADR 0027 §4.3). */
    private TransactionResponse currentResponse(UUID userId, UUID transactionId) {
        return transactionRepository.findById(transactionId)
                .filter(row -> userId.equals(row.getUserId()))
                .map(row -> toResponse(row))
                .orElseThrow(TransactionNotFoundException::new);
    }

    /**
     * ADR 0027 §6.3's logged fields for {@code transaction}, API names and
     * values. {@code txnTime} and {@code splitExpenseId} are create-only;
     * {@code deletedAt} is added by the delete's change set.
     */
    static Map<String, Object> loggedFields(Transaction transaction, boolean create) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("title", transaction.getTitle());
        fields.put("amount", transaction.getAmount());
        fields.put("type", transaction.getType().getValue());
        fields.put("categoryId", transaction.getCategoryId());
        fields.put("categoryName", transaction.getCategoryName());
        fields.put("parentCategoryName", transaction.getParentCategoryName());
        fields.put("txnDate", transaction.getTxnDate());
        if (create) {
            fields.put("txnTime", transaction.getTxnTime());
        }
        fields.put("scope", transaction.getScope().getValue());
        fields.put("groupId", transaction.getGroupId());
        fields.put("paymentMode", transaction.getPaymentMode().getValue());
        fields.put("cashAmount", transaction.getCashAmount());
        fields.put("onlineAmount", transaction.getOnlineAmount());
        fields.put("notes", transaction.getNotes());
        fields.put("receiptPublicId", transaction.getReceiptPublicId());
        if (create) {
            fields.put("splitExpenseId", transaction.getSplitExpenseId());
        }
        return fields;
    }

    /** The fields a superseded PATCH tried to set, as sent (ADR 0027 §6.3). */
    static Map<String, Object> attemptedFields(UpdateTransactionRequest request) {
        Map<String, Object> fields = new LinkedHashMap<>();
        if (request.getTitle() != null) {
            fields.put("title", request.getTitle().trim());
        }
        if (request.getAmount() != null) {
            fields.put("amount", request.getAmount());
        }
        if (request.getType() != null) {
            fields.put("type", request.getType());
        }
        if (request.getCategoryId() != null) {
            fields.put("categoryId", request.getCategoryId());
        }
        if (request.getTxnDate() != null) {
            fields.put("txnDate", request.getTxnDate());
        }
        if (request.getScope() != null) {
            fields.put("scope", request.getScope());
        }
        if (request.getGroupId() != null) {
            fields.put("groupId", request.getGroupId());
        }
        if (request.getPaymentMode() != null) {
            fields.put("paymentMode", request.getPaymentMode());
        }
        if (request.getCashAmount() != null) {
            fields.put("cashAmount", request.getCashAmount());
        }
        if (request.getOnlineAmount() != null) {
            fields.put("onlineAmount", request.getOnlineAmount());
        }
        if (request.hasNotes()) {
            fields.put("notes", request.getNotes());
        }
        if (request.hasReceiptPublicId()) {
            fields.put("receiptPublicId", request.getReceiptPublicId());
        }
        return fields;
    }

    /**
     * Maps a {@code transactions} integrity violation onto the exact code its
     * migration assigns it — {@code 409 RECEIPT_ALREADY_ATTACHED} for the receipt
     * uniqueness index (data-model.md Indexes, ADR 0020 §3) and
     * {@code 404 GROUP_NOT_FOUND} for {@code fk_transactions_group_id} (V10
     * contract item 1) — <strong>by constraint name, never by parsing driver
     * message text</strong>. Structurally the same translator
     * {@code GroupService#translateMembershipViolation} is, which is the shape to
     * copy if a third mapping is ever needed here.
     *
     * <p><strong>Null-safe by design, not by luck</strong> — the Database
     * Architect flagged this for Domain 3 and restated it for Domain 4. Not
     * every integrity error carries a constraint name: a plpgsql {@code RAISE}
     * has none (V6's {@code trg_categories_enforce_depth_one} is this schema's
     * live example), so {@code getConstraintName()} can be {@code null}. Folding
     * the case of that value without a guard would throw a
     * {@link NullPointerException} <em>inside</em> the handler for the original
     * failure — the worst place to throw, because the real error is replaced by
     * a confusing one. The guard is written generally rather than special-cased
     * for any one trigger, and the loop keeps walking the cause chain afterwards
     * in case a named violation sits deeper in it.
     *
     * <p>Anything unmatched is returned unchanged and becomes a logged
     * {@code 500}, which is the honest answer — see {@link #persist} for the
     * per-constraint reasoning.
     *
     * <p>The same shape exists in {@code CategoryService#isUniqueNameViolation}
     * and {@code GroupService#translateMembershipViolation}. The duplication is
     * three short methods matching different constraint sets on different
     * tables; extracting a shared helper would mean a utility whose only job is
     * to hide a {@code for} loop over names its callers do not share, which
     * constitution §3.5 and §25 both argue against.
     */
    private static RuntimeException translateWriteViolation(DataIntegrityViolationException ex) {
        for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException violation) {
                String constraintName = violation.getConstraintName();
                if (constraintName != null) {
                    String foldedName = constraintName.toLowerCase(Locale.ROOT);
                    if (RECEIPT_UNIQUE_CONSTRAINTS.stream().anyMatch(foldedName::contains)) {
                        return new ReceiptAlreadyAttachedException();
                    }
                    if (foldedName.contains(FK_TRANSACTIONS_GROUP)) {
                        return new GroupNotFoundException();
                    }
                    return ex;
                }
            }
        }
        return ex;
    }

    /**
     * A valid token whose user row no longer exists is a {@code 401}, not a
     * {@code 404} — the missing resource <em>is</em> the principal (same rule as
     * Domains 2 and 3).
     *
     * <p>This loads the row rather than calling {@code existsById} as Domains
     * 2/3 do, because {@link #getTransaction} needs {@code is_premium} from it
     * and one primary-key lookup is not worth two code paths. A {@code null}
     * principal is treated as {@code 401} rather than thrown past, so a
     * misconfigured {@code @CurrentUserId} resolver fails loudly but safely.
     */
    private User requireUser(UUID userId) {
        if (userId == null) {
            throw new UnauthorizedException();
        }
        return userRepository.findById(userId).orElseThrow(UnauthorizedException::new);
    }

    /**
     * The base {@code TransactionResponse} — used by the list, the create and
     * the update. The two single-resource enrichment fields are {@code null}
     * here and are therefore omitted from the JSON entirely
     * ({@code TransactionResponse}'s field-level
     * {@code @JsonInclude(NON_NULL)}), which is exactly what "present only on
     * {@code GET /transactions/{id}}" means (api-overview.md §4.1/§4.3).
     */
    private static TransactionResponse toResponse(Transaction transaction) {
        return toResponse(transaction, null);
    }

    /**
     * {@code GET /transactions/{id}} only — the base shape plus the
     * payment-method enrichment, gated on the caller's stored
     * {@code is_premium}.
     */
    private static TransactionResponse toDetailResponse(Transaction transaction, boolean premium) {
        return toResponse(transaction, paymentMethodDisplay(transaction.getPaymentMode(), premium));
    }

    private static TransactionResponse toResponse(Transaction transaction, String paymentMethodDisplay) {
        return new TransactionResponse(
                transaction.getId(),
                transaction.getClientId(),
                transaction.getTitle(),
                transaction.getCategoryId(),
                transaction.getCategoryName(),
                transaction.getParentCategoryName(),
                transaction.getCategoryIconName(),
                transaction.getCategoryGlyph(),
                transaction.getCategoryTone(),
                transaction.getTxnDate(),
                TXN_TIME_FORMAT.format(transaction.getTxnTime()),
                transaction.getAmount(),
                transaction.getType().getValue(),
                transaction.getScope().getValue(),
                transaction.getGroupId(),
                transaction.getPaymentMode().getValue(),
                transaction.getCashAmount(),
                transaction.getOnlineAmount(),
                transaction.getSplitExpenseId(),
                transaction.getNotes(),
                transaction.getReceiptPublicId(),
                transaction.getVersion(),
                transaction.getCreatedAt(),
                transaction.getUpdatedAt(),
                paymentMethodDisplay,
                // paymentMethodUpiId — always null: there is no users.upi_id
                // column and inventing one is what constitution §15/§30
                // forbids. See TransactionResponse's own note; flagged for the
                // System/Database Architect in backend/README.md §13.
                null);
    }

    /**
     * The Payment Method card's primary line
     * (api-overview.md §4.3's table, docs/decisions/0007-transaction-detail-screen.md
     * §3.4).
     *
     * <p>Free tier: {@code "Cash"} / {@code "Online"} / {@code "Both"}. Premium
     * upgrades only the {@code online} line to
     * {@code "Unified Payments Interface"} — {@code cash} has no online
     * component to enrich, and {@code both} stays {@code "Both"} because that
     * table describes the premium {@code both} view as <em>two rows</em> the
     * client composes from the {@code cashAmount}/{@code onlineAmount} fields it
     * already has, and specifies no single replacement string. Flagged as a
     * derived reading in backend/README.md §13.
     *
     * <p>Decided server-side from {@code users.is_premium}, never from a
     * client-supplied premium flag (security-architecture.md §2).
     */
    private static String paymentMethodDisplay(PaymentMode paymentMode, boolean premium) {
        return switch (paymentMode) {
            case CASH -> "Cash";
            case ONLINE -> premium ? "Unified Payments Interface" : "Online";
            case BOTH -> "Both";
        };
    }
}
