package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.entity.PaymentMode;
import com.myexpense.backend.entity.Transaction;
import com.myexpense.backend.repository.TransactionRepository;
import com.myexpense.backend.sync.ChangeLogEntityTypes;
import com.myexpense.backend.sync.ChangeSets;
import com.myexpense.backend.sync.WriteContext;

/**
 * ADR 0028 §5 — the creator's linked consumption-share transaction after a split
 * edit or delete.
 *
 * <p><strong>Principle:</strong> the transaction is the creator's private record.
 * It is derived from the split, but the creator may have edited or deleted it
 * since. The server must not overwrite a deliberate change and must never
 * resurrect a deleted row.
 *
 * <h2>Edit — field-level follow (§5.2)</h2>
 * <table border="1">
 *   <caption>Each field follows only while it still equals the split's old value</caption>
 *   <tr><td>{@code title}</td><td>equals the old split title</td></tr>
 *   <tr><td>{@code txn_date}</td><td>equals the old {@code split_date}</td></tr>
 *   <tr><td>{@code category_id} + snapshot</td><td>equals the old split category</td></tr>
 *   <tr><td>{@code amount}</td><td>equals the creator's old share AND
 *       {@code payment_mode <> 'both'}</td></tr>
 * </table>
 * <p>A new creator share of 0 where the amount would follow soft-deletes the
 * transaction. A follow is a <strong>server propagation</strong>: it bumps
 * {@code updated_at} and never touches {@code version} or
 * {@code last_client_write_at}. {@code scope} and {@code group_id} never change.
 *
 * <h2>Delete (§5.3)</h2>
 * <p>A live transaction is soft-deleted with the split's deletion instant,
 * whether or not the user edited it. An already-deleted one is untouched.
 *
 * <h2>Logging (§5.4)</h2>
 * <p>When the actor is the creator, one secondary {@code change_log} row
 * ({@code idempotency_key = NULL}). When another member acted, no row — the
 * caller appends §5.4's clause to the creator's notification instead.
 */
@Service
public class PersonalShareTransactionSync {

    /** What happened to the transaction. */
    public enum Outcome { UNCHANGED, UPDATED, DELETED }

    /** The split values the follow rule compares against. {@code creatorShare} is {@code share(k)}. */
    record SplitValues(String title, LocalDate date, UUID categoryId, BigDecimal creatorShare) {
    }

    /** Which fields follow, decided from values only — pinned by unit tests. */
    record FollowPlan(boolean title, boolean date, boolean category, boolean amount, boolean softDelete) {

        static final FollowPlan NONE = new FollowPlan(false, false, false, false, false);

        boolean changesAnything() {
            return title || date || category || amount || softDelete;
        }
    }

    private final TransactionRepository transactionRepository;
    private final ChangeLogWriter changeLogWriter;

    public PersonalShareTransactionSync(TransactionRepository transactionRepository, ChangeLogWriter changeLogWriter) {
        this.transactionRepository = transactionRepository;
        this.changeLogWriter = changeLogWriter;
    }

    /**
     * §5.2 as a pure function. {@code categoryChanged} is whether the split's
     * category actually changed in this edit.
     */
    static FollowPlan plan(Transaction transaction, SplitValues before, SplitValues after) {
        if (transaction == null || transaction.getDeletedAt() != null) {
            return FollowPlan.NONE;
        }
        boolean amountFollows = transaction.getAmount() != null
                && transaction.getAmount().compareTo(before.creatorShare()) == 0
                && transaction.getPaymentMode() != PaymentMode.BOTH;
        if (amountFollows && after.creatorShare().signum() == 0) {
            return new FollowPlan(false, false, false, false, true);
        }
        boolean title = Objects.equals(transaction.getTitle(), before.title())
                && !Objects.equals(before.title(), after.title());
        boolean date = Objects.equals(transaction.getTxnDate(), before.date())
                && !Objects.equals(before.date(), after.date());
        boolean category = Objects.equals(transaction.getCategoryId(), before.categoryId())
                && !Objects.equals(before.categoryId(), after.categoryId());
        boolean amount = amountFollows && before.creatorShare().compareTo(after.creatorShare()) != 0;
        return new FollowPlan(title, date, category, amount, false);
    }

    /**
     * §5.2 — applies the plan to the (already {@code FOR UPDATE}-locked)
     * transaction.
     *
     * @param newCategory the split's new category snapshot when it changed, else {@code null}
     * @param actorIsCreator whether to write §5.4's secondary change-log row
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Outcome followEdit(Transaction transaction, SplitValues before, SplitValues after,
            CategorySnapshot newCategory, boolean actorIsCreator, WriteContext context,
            OffsetDateTime effectiveWriteAt, OffsetDateTime now) {
        FollowPlan plan = plan(transaction, before, after);
        if (!plan.changesAnything()) {
            return Outcome.UNCHANGED;
        }
        if (plan.softDelete()) {
            return softDelete(transaction, actorIsCreator, context, effectiveWriteAt, now)
                    ? Outcome.DELETED : Outcome.UNCHANGED;
        }
        Map<String, Object> beforeFields = TransactionService.loggedFields(transaction, false);
        if (plan.title()) {
            transaction.setTitle(after.title());
        }
        if (plan.date()) {
            transaction.setTxnDate(after.date());
        }
        if (plan.category() && newCategory != null) {
            // ADR 0024 §6.2: a write that changes category_id clears the marker.
            transaction.setReassignedFromCategoryId(null);
            newCategory.applyTo(transaction);
        }
        if (plan.amount()) {
            transaction.setAmount(after.creatorShare());
        }
        // Server propagation: version and last_client_write_at untouched;
        // @UpdateTimestamp bumps updated_at.
        Transaction saved = transactionRepository.saveAndFlush(transaction);
        if (actorIsCreator) {
            changeLogWriter.logApplied(saved.getUserId(), ChangeLogEntityTypes.TRANSACTION, saved.getId(),
                    ChangeLog.OPERATION_UPDATE,
                    ChangeSets.update(beforeFields, TransactionService.loggedFields(saved, false)),
                    context, effectiveWriteAt, false);
        }
        return Outcome.UPDATED;
    }

    /**
     * §5.3 — soft-deletes the live transaction with exactly {@code instant}
     * (the split's deletion instant on a split delete).
     *
     * @return {@code true} when a live row was deleted
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean softDelete(Transaction transaction, boolean actorIsCreator, WriteContext context,
            OffsetDateTime effectiveWriteAt, OffsetDateTime instant) {
        if (transaction == null || transaction.getDeletedAt() != null) {
            return false;
        }
        Map<String, Object> lastValues = TransactionService.loggedFields(transaction, false);
        if (transactionRepository.softDeleteSplitShare(transaction.getId(), instant) != 1) {
            return false;
        }
        if (actorIsCreator) {
            changeLogWriter.logApplied(transaction.getUserId(), ChangeLogEntityTypes.TRANSACTION,
                    transaction.getId(), ChangeLog.OPERATION_DELETE,
                    ChangeSets.delete(lastValues, instant, Map.of()), context, effectiveWriteAt, false);
        }
        return true;
    }
}
