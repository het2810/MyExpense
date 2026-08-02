package com.myexpense.backend.repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.SplitExpenseParticipant;

/**
 * Persistence only (constitution §9) for {@code split_expense_participants}.
 *
 * <p><strong>The batch finder is the whole point of this interface.</strong>
 * {@code V11} contract item 7 names the alternative as a specific trap:
 * "participants for a list of split expenses must load in ONE query
 * ({@code WHERE split_expense_id = ANY(?)})". A per-row participant read would be
 * an N+1 over a group's entire history (constitution §10).
 *
 * <h2>The revision read rule (ADR 0028 §3.3, V19 CONTRACT item 3) — binding</h2>
 *
 * <p>Since V19 a split can have several revisions of participant rows, and only
 * the rows whose {@code revision} equals {@code split_expenses.revision} are
 * current. <strong>Every finder here either joins the parent on its current
 * revision, or takes an explicit revision and says so in its name.</strong> An
 * unfiltered read would return every historical revision at once and double
 * every share.
 *
 * <p>Both finders are served by
 * {@code uq_split_expense_participants_expense_revision_user}'s btree, which leads
 * with {@code (split_expense_id, revision)} and — being a plain non-partial
 * {@code UNIQUE} — covers contact-participant rows too. That unique (and its
 * {@code ..._expense_revision_contact} sibling) guarantees one row per identity
 * <em>per split revision</em>, not per split.
 *
 * <p>No membership check here: callers prove the viewer's membership of the
 * parent split's target before loading participants.
 */
public interface SplitExpenseParticipantRepository extends JpaRepository<SplitExpenseParticipant, UUID> {

    /**
     * The <strong>current-revision</strong> participants of a batch of split
     * expenses, in <strong>one</strong> query.
     *
     * <p>Ordered by {@code created_at, id}: every participant of one revision is
     * written in a single batch insert and therefore shares a timestamp, so
     * {@code id} is the tie-break that makes the order total and the response
     * stable across requests.
     */
    @Query("""
            select p from SplitExpenseParticipant p
              join SplitExpense s on s.id = p.splitExpenseId
             where p.splitExpenseId in :splitExpenseIds
               and p.revision = s.revision
             order by p.createdAt asc, p.id asc
            """)
    List<SplitExpenseParticipant> findCurrentBySplitExpenseIdIn(
            @Param("splitExpenseIds") Collection<UUID> splitExpenseIds);

    /**
     * One split's participants <strong>at an explicit revision</strong> — the
     * edit and delete paths read revision {@code r} (the one being reversed)
     * while holding the split row lock, so they name it rather than join on it.
     * May read history by design.
     */
    List<SplitExpenseParticipant> findBySplitExpenseIdAndRevisionOrderByCreatedAtAscIdAsc(
            UUID splitExpenseId, int revision);
}
