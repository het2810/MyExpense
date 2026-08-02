package com.myexpense.backend.repository;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.Transaction;
import com.myexpense.backend.entity.TransactionScope;
import com.myexpense.backend.entity.TransactionType;

import jakarta.persistence.LockModeType;

/**
 * Persistence only (constitution §9). Every query here is either a Spring Data
 * derived method or JPQL with <strong>bound</strong> parameters — no native
 * SQL, no string concatenation, and nothing built from client input
 * (security-architecture.md §12).
 *
 * <p><strong>Every lookup takes {@code userId}.</strong> A transaction is
 * owner-scoped, so "fetch by id" must mean "fetch by id <em>belonging to the
 * caller</em>"; there is deliberately no bare {@code findById} usage in this
 * domain's service, or an id guessed from another account would be readable
 * (api-overview.md §4, security-architecture.md §2).
 *
 * <p><strong>Every read excludes soft-deleted rows</strong>
 * ({@code deleted_at is null}) — api-overview.md §4: a deleted transaction must
 * not appear in the list or in a single read. The one deliberate exception is
 * the receipt-uniqueness pre-check below, which spans deleted rows because a
 * soft-deleted transaction keeps its receipt reference and therefore keeps its
 * asset slot (ADR 0020 §3).
 *
 * <p><strong>The three bulk WRITES added for ADR 0021 are the mirror image of
 * that rule, on purpose</strong> — the two rename-propagation statements and
 * the delete reassignment carry <em>no</em> {@code deleted_at} clause, because a
 * soft-deleted transaction is still the user's data, still travels to clients
 * through {@code /sync/pull}, and (in the delete case) would otherwise be left
 * pointing at a category that has been deleted. Each method's own Javadoc says
 * so where it matters. The one read among the additions,
 * {@link #countByUserIdAndCategoryIdInAndDeletedAtIsNull}, follows the read rule
 * unchanged.
 *
 * <p><strong>Every clause over {@code Category} here also filters
 * {@code c.deletedAt is null}</strong> (ADR 0024 §4.2) — the {@code categoryId}
 * roll-up subquery in both halves of {@link #findFiltered}, and the join in
 * {@link #aggregateSpendByCategory}. A JPQL clause over {@code Category}
 * without that filter is a defect unless its Javadoc says why.
 */
public interface TransactionRepository extends JpaRepository<Transaction, UUID> {

    /**
     * {@code GET /api/v1/transactions/{id}} — owner-scoped, excluding
     * soft-deleted rows. An id belonging to another account, an unknown id and
     * a deleted id all resolve to empty, i.e. one identical
     * {@code 404 TRANSACTION_NOT_FOUND}.
     */
    Optional<Transaction> findByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    /**
     * The same owner-scoped fetch, but taking a row lock
     * ({@code SELECT ... FOR UPDATE}) — used by {@code PATCH} and
     * {@code DELETE}.
     *
     * <p><strong>This is what makes the optimistic-concurrency check actually
     * atomic.</strong> Without it, two concurrent {@code PATCH}es that both
     * read {@code version = 1} would both pass the service's comparison and one
     * would silently overwrite the other — precisely the outcome
     * {@code 409 VERSION_CONFLICT} exists to prevent
     * (security-architecture.md §9). With the lock, the second request blocks
     * until the first commits, then re-reads the row under PostgreSQL's
     * {@code READ COMMITTED} semantics, sees {@code version = 2}, and the
     * comparison fails cleanly.
     *
     * <p>Contention is effectively nil in practice (one user editing one of
     * their own rows, from at most a couple of devices), so this is not a
     * throughput concern — it is the cheapest way to make a two-statement
     * compare-and-write correct. Spring Data ignores the text between
     * {@code find} and {@code By}, so this derives exactly the same query as
     * {@link #findByIdAndUserIdAndDeletedAtIsNull} with a different lock mode.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Transaction> findForUpdateByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    /**
     * LWW-mode {@code PATCH} only (ADR 0027 §5.2/§5.4): the same owner-scoped,
     * write-locked fetch but <strong>including soft-deleted rows</strong>, so an
     * update to the caller's own deleted row is answered
     * {@code 409 WRITE_SUPERSEDED} (reason {@code deleted}) rather than
     * {@code 404}. Never used by a read.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Transaction> findForUpdateByIdAndUserId(UUID id, UUID userId);

    /**
     * {@code GET /api/v1/transactions} — paginated and filtered
     * (api-overview.md §4.1).
     *
     * <p><strong>One fixed, developer-written query shape; every filter is a
     * typed bound parameter</strong> (security-architecture.md §12.2, which
     * names this endpoint's filters as its own example). A {@code null}
     * parameter disables its clause. Nothing a client sends ever becomes a
     * field name, a table name or a SQL fragment, and there is no {@code sort}
     * parameter at all — the contract defines none, so the {@code ORDER BY} is
     * a literal in this file and cannot be influenced from outside.
     *
     * <p><strong>The {@code categoryId} filter rolls up</strong> (ADR 0019 §5,
     * data-model.md §2.2): a top-level id matches transactions tagged to it
     * <em>and</em> to any of its subcategories; a subcategory id matches that
     * subcategory alone, because a subcategory can have no children. The
     * roll-up is resolved from {@code categories} in a subquery rather than
     * from a denormalized column, exactly as the data model requires, and the
     * subquery is itself scoped to {@code :userId} so one account's category
     * tree can never widen another's results. Three correct consequences,
     * recorded so none of them is later filed as a gap:
     * <ul>
     *   <li>an <strong>income</strong> row never matches — {@code category_id}
     *       is {@code NULL} on every income row, and {@code NULL} satisfies
     *       neither the equality nor the {@code IN} (api-overview.md §4.1;
     *       {@code type=income} is the filter for that);</li>
     *   <li>an <strong>unknown or other-user</strong> {@code categoryId}
     *       matches nothing and yields an empty page rather than an error — the
     *       contract defines no error for this parameter, and a {@code 404}
     *       here would confirm to a non-owner whether a category id is real
     *       (security-architecture.md §2). The caller's transactions only ever
     *       reference the caller's own categories, so "matches nothing" is both
     *       the truthful and the leak-free answer;</li>
     *   <li>no {@code includeSubcategories} parameter exists — one documented
     *       behaviour, which is what the ADR chose;</li>
     *   <li><strong>the roll-up reads LIVE subcategories only</strong>
     *       ({@code c.deletedAt is null}, in <em>both</em> halves — ADR 0024
     *       §4.2). A soft-deleted category is indistinguishable from a
     *       non-existent one, so filtering by a deleted id matches nothing:
     *       every transaction it or its children carried was reassigned to
     *       {@code Misc} by the delete.</li>
     * </ul>
     *
     * <p><strong>Ordering is newest-first and fully deterministic:</strong>
     * {@code txn_date desc, txn_time desc, created_at desc, id desc}. The
     * contract specifies no order, and <em>some</em> total order is mandatory
     * for pagination to be stable across pages — two rows sharing a date, a
     * time and a creation instant would otherwise be free to swap pages between
     * requests. Date-then-time-descending matches the Dashboard's own
     * presentation and the leading columns of the
     * {@code transactions(user_id, txn_date)} index (data-model.md Indexes);
     * {@code id} is the final tie-break and guarantees totality.
     *
     * <p>The {@code countQuery} is supplied explicitly rather than left to
     * Spring Data's derivation: the main query carries a correlated subquery,
     * and an explicit count removes any question about how that is rewritten.
     * Both halves must keep the same {@code WHERE} clause — change them
     * together.
     *
     * <h2>Why the two date bounds use {@code coalesce} and the other filters do
     * not — A FIXED BUG, not a style choice</h2>
     *
     * <p>The date bounds were originally written in the same
     * {@code (:param is null or column >= :param)} shape that {@code scope},
     * {@code type} and {@code categoryId} still use. On 2026-10-29 that shape
     * was confirmed to make this endpoint return {@code 500 INTERNAL_ERROR} for
     * <em>every</em> valid {@code dateFrom} or {@code dateTo}, with PostgreSQL
     * rejecting the statement at parse time:
     *
     * <pre>ERROR: could not determine data type of parameter $6</pre>
     *
     * <p><strong>Cause.</strong> The idiom makes Hibernate emit one named
     * parameter as <strong>two</strong> JDBC placeholders, and the occurrence
     * inside {@code is null} has no surrounding expression to take a type from.
     * That is fatal for date and time parameters specifically: the PostgreSQL
     * JDBC driver binds {@code date}/{@code time}/{@code timestamp} values as
     * strings with an <em>unspecified</em> type OID deliberately, leaving the
     * server to infer the type from context — and in {@code $6 is null} there is
     * no context. A {@link UUID}, a {@link String} and an
     * {@code AttributeConverter}-backed enum are each bound with a concrete type
     * OID instead, which is why {@code scope}, {@code type} and
     * {@code categoryId} survive the idiom and the dates cannot. It is also why
     * the failure looked like a date-<em>parsing</em> problem at first: sending
     * neither bound worked, because a null bind goes through
     * {@code setNull(..., Types.DATE)}, which <em>is</em> typed.
     *
     * <p><strong>Fix.</strong> {@code t.txnDate >= coalesce(:dateFrom, t.txnDate)}.
     * The parameter is bound <strong>once</strong>, inside an expression that
     * fixes its type from the column beside it, so no untyped placeholder is left
     * to fail on. The filter semantics are unchanged, and that rests on a schema
     * guarantee rather than on luck: {@code txn_date} is {@code DATE NOT NULL}
     * ({@code V7__transactions.sql}), so an omitted bound degrades to
     * {@code txn_date >= txn_date} — always true, i.e. the clause is disabled
     * exactly as {@code null} disabled it before. An inclusive bound stays
     * inclusive, and a reversed range stays a legal empty range (§4.1 defines no
     * error for it).
     *
     * <p><strong>Rule for this file and every other repository:</strong> never
     * place a {@code LocalDate}, {@code LocalTime}, {@code OffsetDateTime} or
     * {@code Instant} parameter inside an {@code is null} check. Use this
     * {@code coalesce} form. The incident and the two rejected alternatives are
     * recorded in backend/README.md §13.11.
     */
    @Query(value = """
            select t from Transaction t
            where t.userId = :userId
              and t.deletedAt is null
              and (:scope is null or t.scope = :scope)
              and (:type is null or t.type = :type)
              and t.txnDate >= coalesce(:dateFrom, t.txnDate)
              and t.txnDate <= coalesce(:dateTo, t.txnDate)
              and (:categoryId is null
                   or t.categoryId = :categoryId
                   or t.categoryId in (select c.id from Category c
                                       where c.userId = :userId
                                         and c.parentCategoryId = :categoryId
                                         and c.deletedAt is null))
            order by t.txnDate desc, t.txnTime desc, t.createdAt desc, t.id desc
            """,
            countQuery = """
            select count(t) from Transaction t
            where t.userId = :userId
              and t.deletedAt is null
              and (:scope is null or t.scope = :scope)
              and (:type is null or t.type = :type)
              and t.txnDate >= coalesce(:dateFrom, t.txnDate)
              and t.txnDate <= coalesce(:dateTo, t.txnDate)
              and (:categoryId is null
                   or t.categoryId = :categoryId
                   or t.categoryId in (select c.id from Category c
                                       where c.userId = :userId
                                         and c.parentCategoryId = :categoryId
                                         and c.deletedAt is null))
            """)
    Page<Transaction> findFiltered(
            @Param("userId") UUID userId,
            @Param("scope") TransactionScope scope,
            @Param("type") TransactionType type,
            @Param("categoryId") UUID categoryId,
            @Param("dateFrom") LocalDate dateFrom,
            @Param("dateTo") LocalDate dateTo,
            Pageable pageable);

    /**
     * Friendly pre-check for {@code 409 RECEIPT_ALREADY_ATTACHED} on
     * {@code POST /transactions} (api-overview.md §4.2, rule 4).
     *
     * <p><strong>Deliberately not scoped to the caller, and deliberately not
     * excluding soft-deleted rows.</strong> The partial unique index on
     * {@code transactions(receipt_public_id)} is global for both reasons: one
     * Cloudinary asset belongs to exactly one transaction, and a soft-deleted
     * transaction still references its asset so it still holds the slot
     * (ADR 0020 §3, data-model.md Indexes). Cross-user scoping is unnecessary
     * in the key because the {@code public_id} embeds the owner's id and
     * {@code ReceiptPublicIdPolicy} re-checks it on every write — so a value
     * that passes that check can only ever collide with the caller's own row.
     *
     * <p>This returns a boolean and nothing else, so it reveals no information
     * about any other account even in the impossible case.
     *
     * <p>As with Domain 3's name pre-check, the index — not this query — is the
     * guarantee: two concurrent creates can both pass, and the loser must still
     * get the contract's {@code 409}. Both halves are kept on purpose.
     */
    boolean existsByReceiptPublicId(String receiptPublicId);

    /**
     * The same pre-check for {@code PATCH /transactions/{id}}, excluding the
     * row being updated — so re-sending a transaction's own current
     * {@code receiptPublicId} is never a conflict.
     */
    boolean existsByReceiptPublicIdAndIdNot(String receiptPublicId, UUID id);

    /**
     * {@code GET /api/v1/statistics/categories} — the caller's expense total
     * per <strong>leaf</strong> category for an optional, inclusive date range
     * (api-overview.md §14.1).
     *
     * <p><strong>This is the whole aggregation, and it is SQL</strong>
     * (ADR 0022 §8, restated as an implementation constraint in §14.1). One
     * {@code GROUP BY} over the caller's rows; the service folds the result into
     * parents and sorts it, and <em>computes no sum of its own</em>. Explicitly
     * not how this is done: fetching pages of transactions and adding them up in
     * Java, or issuing a query per category (constitution §10's no-N+1 rule,
     * restated in {@code V7__transactions.sql}'s own contract block).
     *
     * <h2>Expenses only — STRUCTURALLY, with no {@code type} clause at all</h2>
     *
     * <p>Note what this query does <strong>not</strong> contain: any mention of
     * {@code t.type}. Income is excluded because it <em>cannot be reached</em>,
     * not because a predicate filters it out (ADR 0022 §1, api-overview.md
     * §14.1).
     *
     * <p>The mechanism is the join to {@code Category}. Every income row carries
     * {@code category_id = NULL} (ADR 0018 §3 — income is not a category, so an
     * income transaction references no category row), and {@code NULL} satisfies
     * {@code c.id = t.categoryId} for no {@code c} whatsoever, so an income row
     * contributes to no group. The join is not an optimization that could be
     * dropped: §14.1 requires every emitted category to be a real, current,
     * caller-owned {@code categories} row, so the join is what the response is
     * built from.
     *
     * <p><strong>Why this matters more than it looks:</strong> ADR 0022 §1 chose
     * structure over discipline deliberately. A {@code where t.type = 'expense'}
     * clause — or worse, a {@code :type} parameter — would be the one line a
     * future reader could relax, parameterise, or delete while "generalising"
     * this endpoint, and the result would be a chart of income-by-category that
     * can only ever render one 100% slice labelled {@code Income}. There is no
     * such clause here to weaken. <strong>Do not add one, in either
     * direction.</strong>
     *
     * <p>Two further exclusions, both part of the contract:
     * <ul>
     *   <li><strong>soft-deleted rows</strong> ({@code t.deletedAt is null}) —
     *       consistent with every other read in this API (api-overview.md
     *       §14.1);</li>
     *   <li><strong>a soft-deleted category</strong> ({@code c.deletedAt is null},
     *       ADR 0024 §4.2) — §14.1 requires every emitted category to be a
     *       real, current category. No transaction normally points at one,
     *       because the delete reassigns them all to {@code Misc} in the same
     *       transaction, so this clause excludes only what direct SQL could
     *       leave behind;</li>
     *   <li><strong>an expense row whose {@code category_id} is {@code NULL}</strong>
     *       — the same join excludes it. This API cannot produce such a row
     *       (§3.4 reassigns on delete rather than nulling, and since ADR 0024
     *       categories are never hard-deleted, so
     *       {@code fk_transactions_category_id}'s {@code ON DELETE SET NULL} is
     *       dormant); only direct SQL can. Excluding it is what keeps
     *       {@code totalSpent = Σ slices} true <em>by construction</em>, which
     *       every client-side percentage rests on (ADR 0022 §4/§5). If such a
     *       row is ever observed, the fix is a residual slice in the response,
     *       not continued silent exclusion — and its existence is a signal about
     *       the category-delete path.</li>
     * </ul>
     *
     * <h2>Owner scoping and injection hardening</h2>
     *
     * <p>{@code :userId} is bound <strong>twice</strong>, on purpose: once for
     * the transactions and once for the categories they join to. The second is
     * not redundant — {@code fk_transactions_category_id} guarantees the
     * category <em>exists</em>, not that the caller owns it
     * ({@code V7__transactions.sql}'s own note), so without
     * {@code c.userId = :userId} one account's category row could supply the
     * grouping key for another's spend. {@code :userId} itself always comes from
     * the verified JWT via {@code @CurrentUserId}, never from a request
     * parameter (security-architecture.md §2).
     *
     * <p>One fixed, developer-written query; both date bounds are typed bound
     * parameters, and an omitted bound disables its clause. No native SQL, no
     * string concatenation, nothing from client input becoming a field or table
     * name, and <strong>no {@code sort} parameter anywhere in this endpoint</strong>
     * — the contract's ordering is applied after the roll-up and cannot be
     * influenced from outside (security-architecture.md §12).
     *
     * <h2>The date bounds use {@code coalesce} — A FIXED BUG, do not revert</h2>
     *
     * <p>These two clauses were written as
     * {@code (:dateFrom is null or t.txnDate >= :dateFrom)} and made this
     * endpoint return {@code 500 INTERNAL_ERROR} for every valid date range,
     * PostgreSQL rejecting the statement at parse time with
     * {@code ERROR: could not determine data type of parameter $3}. The cause
     * (one named parameter emitted as two placeholders, the one inside
     * {@code is null} having no type context, which only date/time parameters
     * cannot survive) and the reasoning behind this form are recorded in full on
     * {@link #findFiltered}, which had the identical defect, and in
     * backend/README.md §13.11.
     *
     * <p>Semantics are unchanged: {@code txn_date} is {@code DATE NOT NULL}
     * ({@code V7__transactions.sql}), so an omitted bound degrades to
     * {@code txn_date >= txn_date} — always true — and both bounds stay
     * inclusive. <strong>Never put a date or time parameter inside an
     * {@code is null} check.</strong>
     *
     * <h2>Why there is no {@code ORDER BY} here</h2>
     *
     * <p>§14.1's ordering ({@code amount} descending, ties by
     * {@code categoryName} ascending) is defined over <em>rolled-up parent</em>
     * amounts, and a parent's amount is not known until its children have been
     * folded in. Ordering these leaf-level groups would therefore be a sort whose
     * result the service has to discard. The contract's order is applied once, in
     * {@code StatisticsService}, as a total order.
     *
     * <h2>The index this will eventually want</h2>
     *
     * <p>{@code transactions(user_id, category_id, txn_date)} — named as a
     * deliberate deferral in {@code V7__transactions.sql}'s
     * "indexes deliberately not created" block, for this query and Domain 5's.
     * It is <strong>not</strong> requested yet: ADR 0022 §8 requires an
     * {@code EXPLAIN ANALYZE} against realistic row counts first, and it is one
     * migration coordinated with the Database Architect when the measurement
     * says so (constitution §11). Today's read walks one user's rows, which
     * {@code idx_transactions_user_id_txn_date} already narrows.
     */
    @Query("""
            select new com.myexpense.backend.repository.CategorySpendRow(
                       t.categoryId, sum(t.amount))
            from Transaction t, Category c
            where c.id = t.categoryId
              and c.userId = :userId
              and c.deletedAt is null
              and t.userId = :userId
              and t.deletedAt is null
              and t.txnDate >= coalesce(:dateFrom, t.txnDate)
              and t.txnDate <= coalesce(:dateTo, t.txnDate)
            group by t.categoryId
            """)
    List<CategorySpendRow> aggregateSpendByCategory(
            @Param("userId") UUID userId,
            @Param("dateFrom") LocalDate dateFrom,
            @Param("dateTo") LocalDate dateTo);

    /**
     * {@code GET /api/v1/categories/{id}/usage} — the {@code transactionCount}
     * half (api-overview.md §3.5, ADR 0021 §2.2).
     *
     * <p>Counted over the <strong>rolled-up</strong> id set the caller resolved
     * ({@code id} plus its subcategory ids when {@code id} is top-level), which
     * is the same set §3.4's reassignment writes and the same semantics as
     * §4.1's {@code categoryId} filter — so a user cannot be warned about one
     * number and have a different one happen.
     *
     * <p><strong>Soft-deleted rows are excluded, and the delete's own count
     * deliberately does not exclude them.</strong> This number describes what
     * the <em>user</em> will see change, and a soft-deleted transaction appears
     * in no read. {@code reassignedTransactionCount} is the reassigning
     * UPDATE's affected-row count instead, and that write covers soft-deleted
     * rows on purpose (they are still the user's data and still reach clients
     * through {@code /sync/pull}). The asymmetry is recorded rather than
     * accidental: §3.5's count is explicitly advisory.
     *
     * <p><strong>Income rows cannot match</strong> — every income row carries
     * {@code category_id = NULL} and {@code NULL} satisfies no {@code in}
     * predicate (ADR 0018 §3). There is no {@code type} clause here and none is
     * to be added (ADR 0021 §1.4): a clause that <em>looks</em> like it protects
     * income would be the first place a future reader could weaken it.
     *
     * <p>A derived count rather than JPQL: the predicate needs no expression
     * the keywords cannot express, and the collection parameter is bound.
     */
    long countByUserIdAndCategoryIdInAndDeletedAtIsNull(UUID userId, Collection<UUID> categoryIds);

    /**
     * <strong>RENAME PROPAGATION, UPDATE 1 of 2</strong> — refreshes the leaf
     * snapshot on every row tagged to the renamed/re-iconed/re-glyphed category
     * itself (api-overview.md §3.3, ADR 0021 §1.2).
     *
     * <p><strong>This is a deliberate reversal, not a bug.</strong> ADR 0018 and
     * data-model.md §2.2 froze these columns so that "renaming a category later
     * must not rewrite transaction history". The Project Owner ruled the
     * opposite on 2026-10-25: a rename <em>must</em> appear on that category's
     * existing transactions. The columns <strong>stay</strong> — they have two
     * other jobs (rendering a transaction whose category is gone, and keeping
     * income rows join-free) and {@code GET /transactions} still joins nothing.
     * So "frozen forever" became <strong>"frozen until the category itself
     * changes, then refreshed"</strong>. <em>Any test asserting that a
     * transaction keeps its OLD category name after a rename is now
     * inverted.</em>
     *
     * <p><strong>{@code updatedAt} is set EXPLICITLY, and that is load-bearing.</strong>
     * A bulk JPQL update bypasses the persistence context entirely, so
     * {@code @UpdateTimestamp} never runs and the schema has no trigger for it
     * either ({@code V7}'s own contract item 2). {@code updated_at} is the
     * confirmed last-write-wins / sync-cursor column, so without the explicit
     * assignment a rename would reach <strong>no offline client</strong> through
     * {@code /sync/pull} until some unrelated edit happened to touch each row —
     * i.e. the feature would silently not work on the one platform this app is
     * built for.
     *
     * <p><strong>{@code version} is NOT in the SET list, equally deliberately</strong>
     * (ADR 0021 §1.5). {@code version} guards <em>client-authored</em> field
     * edits ({@code 409 VERSION_CONFLICT}, §4.4), and all five snapshot values
     * are server-authoritative and never request fields — so a client's
     * in-flight {@code PATCH /transactions/{id}} cannot be in conflict with this
     * change: there is nothing for it to re-fetch and nothing of the user's to
     * lose. Bumping it would reject a user's unrelated edit, which is real lost
     * work, to protect a value the client cannot send.
     *
     * <p><strong>{@code category_tone} is not in the SET list either</strong> —
     * it is derived from {@code type} alone and no category carries one
     * (ADR 0018 §3.3), so there is nothing on the category row for it to follow.
     *
     * <p><strong>Income rows are unreachable structurally</strong>: the
     * predicate keys on {@code category_id}, and every income row has
     * {@code NULL} there. <strong>No {@code type} filter is added and none
     * should be</strong> (ADR 0021 §1.4) — see
     * {@link #countByUserIdAndCategoryIdInAndDeletedAtIsNull}.
     *
     * <p><strong>Soft-deleted rows are intentionally included.</strong> There is
     * no {@code deletedAt is null} clause: a soft-deleted transaction is still
     * the user's data and still travels to clients through {@code /sync/pull},
     * so leaving it with a stale name while its category reads something else
     * would be the same inconsistency this propagation exists to remove.
     *
     * <p>{@code userId} scopes the write as defence in depth. It cannot change
     * the result — a category is owner-scoped and {@code PATCH} has already
     * {@code 404}ed on a row the caller does not own — but a bulk UPDATE on a
     * financial table is exactly where an unscoped {@code WHERE} is most
     * expensive to get wrong (security-architecture.md §2/§3).
     *
     * <p>{@code flushAutomatically} so the category row's own update is in the
     * database first. <strong>No {@code clearAutomatically}</strong>: no
     * {@code Transaction} entity is loaded anywhere in the Categories domain's
     * persistence context, so there is nothing to go stale, and clearing it
     * would detach the {@code Category} instance the response is built from.
     *
     * @return how many transaction rows were refreshed; {@code 0} is normal
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            update Transaction t
               set t.categoryName = :categoryName,
                   t.categoryIconName = :categoryIconName,
                   t.categoryGlyph = :categoryGlyph,
                   t.updatedAt = :updatedAt
             where t.userId = :userId
               and t.categoryId = :categoryId
            """)
    int refreshCategorySnapshot(
            @Param("userId") UUID userId,
            @Param("categoryId") UUID categoryId,
            @Param("categoryName") String categoryName,
            @Param("categoryIconName") String categoryIconName,
            @Param("categoryGlyph") String categoryGlyph,
            @Param("updatedAt") OffsetDateTime updatedAt);

    /**
     * <strong>RENAME PROPAGATION, UPDATE 2 of 2 — the one that gets missed</strong>
     * (api-overview.md §3.3, ADR 0021 §1.2). Refreshes
     * {@code parent_category_name} on every row tagged to one of the renamed
     * category's <strong>children</strong>.
     *
     * <p><strong>Why it is not optional, stated as the failure it prevents:</strong>
     * a transaction tagged to {@code Food › Lunch} carries <em>Lunch's</em> id
     * in {@code category_id}, not Food's. Renaming {@code Food} therefore
     * matches <strong>zero</strong> rows in
     * {@link #refreshCategorySnapshot}. Without this second statement that row
     * renders {@code OldFoodName › Lunch} — a stale parent beside a correct
     * leaf, in one string, which reads as data corruption rather than as a
     * missed propagation. ADR 0019 §5 chose two snapshot columns over one
     * composed path precisely so the parent is a separate recoverable fact; the
     * cost of that choice is exactly this write.
     *
     * <p><strong>It carries the NAME only, and that is structural.</strong>
     * There is no {@code parent_category_icon_name} or
     * {@code parent_category_glyph} column anywhere — only the parent's
     * <em>name</em> is snapshotted — so an icon-only or glyph-only change must
     * <strong>not</strong> run this statement at all. The caller enforces that;
     * there is nothing here for an icon to be written into.
     *
     * <p><strong>Renaming a SUBCATEGORY never reaches this method.</strong> A
     * subcategory cannot have children (ADR 0019 §2), so the resolved id set is
     * empty — guaranteed by the one-level rule rather than by a filter. The
     * caller skips the call rather than binding an empty collection, which no
     * SQL dialect accepts in an {@code in} predicate.
     *
     * <p>{@code updatedAt} explicit, {@code version} untouched,
     * {@code category_tone} untouched, income unreachable, soft-deleted rows
     * included, {@code userId}-scoped — all for the reasons
     * {@link #refreshCategorySnapshot} records in full.
     *
     * @return how many transaction rows were refreshed
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            update Transaction t
               set t.parentCategoryName = :parentCategoryName,
                   t.updatedAt = :updatedAt
             where t.userId = :userId
               and t.categoryId in :subcategoryIds
            """)
    int refreshParentCategorySnapshot(
            @Param("userId") UUID userId,
            @Param("subcategoryIds") Collection<UUID> subcategoryIds,
            @Param("parentCategoryName") String parentCategoryName,
            @Param("updatedAt") OffsetDateTime updatedAt);

    /**
     * <strong>DELETE REASSIGNMENT</strong> — moves every transaction tagged to
     * a category being deleted (or to one of its cascaded subcategories) onto
     * the caller's protected {@code Misc} row (api-overview.md §3.4 step 3,
     * ADR 0021 §2.4).
     *
     * <p><strong>One statement here, two on rename, and the asymmetry has a
     * reason:</strong> the reassignment target is a single top-level row, so
     * every affected transaction ends up with the same four values and a
     * {@code NULL} parent <em>whatever level it was tagged at</em>. The rename
     * case needs two statements because it changes <em>different columns</em> on
     * <em>different row sets</em>.
     *
     * <p><strong>{@code parentCategoryName} is set to {@code NULL} with no
     * branch</strong>, which is safe only because the protected row is
     * guaranteed top-level by {@code chk_categories_protected_is_top_level}
     * ({@code V8} STEP 2). That constraint exists for this line.
     *
     * <p><strong>Transactions tagged to a cascaded SUBCATEGORY land on
     * {@code Misc} too — not on the surviving parent.</strong> In a cascade
     * there is no surviving parent, and applying a different rule to a child
     * deleted on its own would give one user action two outcomes they cannot
     * predict. One rule, both levels.
     *
     * <p><strong>Soft-deleted rows are included, deliberately.</strong> Since
     * ADR 0024 the category itself is only soft-deleted, so no FK action would
     * null a row left out — but a row left out would still point at a hidden
     * category with a snapshot naming it, and would re-appear wrongly tagged if
     * the transaction were ever un-deleted. Including every row is what makes
     * §3.4 "reassign on delete" true of the whole table — the property
     * ADR 0022's statistics query explicitly relies on.
     *
     * <p><strong>The restore marker is written in the same statement</strong>
     * (ADR 0024 §4.3 step 5, §6.2): {@code reassignedFromCategoryId} ← the row's
     * {@code category_id} as it was immediately before this write (the leaf).
     * PostgreSQL evaluates every right-hand side of an {@code UPDATE} against the
     * <em>old</em> row, so this reads the pre-reassignment value regardless of
     * the order of the assignments; it is listed first only for readability.
     * The marker is internal and never leaves the server.
     *
     * <p>{@code updatedAt} explicit (a bulk update bypasses
     * {@code @UpdateTimestamp}), {@code version} untouched,
     * {@code category_tone} untouched (it follows {@code type}, and a reassigned
     * expense is already {@code neutral} — which is also why {@code categories}
     * needs no tone column), income unreachable via {@code category_id},
     * {@code userId}-scoped as defence in depth. Same reasoning as
     * {@link #refreshCategorySnapshot}.
     *
     * @return how many transaction rows were reassigned — returned to the client
     *         as {@code reassignedTransactionCount} so it can invalidate exactly
     *         what changed
     */
    @Modifying(flushAutomatically = true)
    @Query("""
            update Transaction t
               set t.reassignedFromCategoryId = t.categoryId,
                   t.categoryId = :fallbackCategoryId,
                   t.categoryName = :categoryName,
                   t.parentCategoryName = null,
                   t.categoryIconName = :categoryIconName,
                   t.categoryGlyph = :categoryGlyph,
                   t.updatedAt = :updatedAt
             where t.userId = :userId
               and t.categoryId in :categoryIds
            """)
    int reassignToFallbackCategory(
            @Param("userId") UUID userId,
            @Param("categoryIds") Collection<UUID> categoryIds,
            @Param("fallbackCategoryId") UUID fallbackCategoryId,
            @Param("categoryName") String categoryName,
            @Param("categoryIconName") String categoryIconName,
            @Param("categoryGlyph") String categoryGlyph,
            @Param("updatedAt") OffsetDateTime updatedAt);

    /**
     * ADR 0028 §5.2/§5.3: soft-deletes a split's consumption-share transaction
     * with an <strong>exact instant</strong> — the split's deletion instant on a
     * split delete, so a future restore can treat the two as one unit (ADR 0024
     * §6.1). A server propagation: {@code version} and
     * {@code last_client_write_at} are untouched; {@code updated_at} is set
     * explicitly because a bulk update bypasses {@code @UpdateTimestamp}. Live
     * rows only — an already-deleted transaction is never touched, never
     * resurrected.
     *
     * @return {@code 1} when the live row was deleted, {@code 0} when it was already deleted
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update Transaction t
               set t.deletedAt = :now, t.updatedAt = :now
             where t.id = :id
               and t.deletedAt is null
            """)
    int softDeleteSplitShare(@Param("id") UUID id, @Param("now") OffsetDateTime now);
}
