package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.entity.Activity;
import com.myexpense.backend.entity.Notification;
import com.myexpense.backend.repository.ActivityRepository;
import com.myexpense.backend.repository.NotificationRepository;

/**
 * <strong>The Domain 7 fan-out — the only writer of {@code activities} and
 * {@code notifications}</strong> (api-overview.md §9.1 step 4 and §10.1 step 5,
 * data-model.md §5.1/§5.2, ADR 0014 §2 Consequence 3).
 *
 * <h2>Why this exists in Domain 6 at all</h2>
 *
 * <p>{@code V13} created both tables ahead of their own domain for exactly this
 * reason, in its own words: "§9.1 step 4 and §10.1 step 5 both require an
 * activities row AND a notifications row for every other affected member, IN THE
 * SAME TRANSACTION as the split save or the settlement and its balance
 * recalculation. That is not an 'add it later' feature ... because the write
 * path's transaction boundary is what makes the fan-out atomic with the balance it
 * describes." Both methods here are {@code MANDATORY}, so neither can start a
 * transaction of its own and neither can commit independently of the ledger write
 * that caused it.
 *
 * <h2>The four rules {@code V13} contract item 2 fixes, and where each lands</h2>
 *
 * <ol>
 *   <li><strong>One row per affected member, in both tables.</strong> The
 *       recipient set is computed by the caller from the balance rows it just
 *       moved — never from the request body.</li>
 *   <li><strong>{@code activities} gets a row for the ACTOR too;
 *       {@code notifications} go to every OTHER affected member.</strong> You do
 *       not notify someone of their own action. {@link #notificationRecipients}
 *       is the single place that subtraction happens.</li>
 *   <li><strong>One multi-row INSERT per table per event.</strong> See the note
 *       below on why {@code activities} legitimately takes two statements and
 *       {@code notifications} takes one.</li>
 *   <li><strong>Order by the {@code activity_date}/{@code activity_time}
 *       pair.</strong> Not this class's job — it is the read path's — but both
 *       values are written here, from one instant, so the pair can never disagree
 *       with {@code created_at} (the inconsistency {@code V13} FLAG 2 warns
 *       about).</li>
 * </ol>
 *
 * <h2>Why {@code activities} is TWO statements and not one</h2>
 *
 * <p>Because the sentence genuinely differs by recipient: ADR 0008 §2.2's four
 * templates are <em>viewer-relative</em>, so the member who paid reads "You paid
 * ₹X…" while everyone else reads "{payer} paid ₹X…", and on an individual split
 * even {@code entity_name} differs because each side's highlighted name is the
 * <em>other</em> party. Two statements is <strong>two regardless of how many
 * members there are</strong>, which is what item 2 is guarding against ("a
 * five-member group settlement is two INSERTs, not ten") — the identical
 * trade-off {@code GroupMemberBalanceRepository} documents for its two
 * per-member-kind upserts. A notification needs only one statement because it
 * never goes to the actor and its subject is the actor, not the payer.
 *
 * <p>So a split save is <strong>three</strong> statements in the common case
 * (payer activities, other activities, notifications) and <strong>four</strong> in
 * the one case where the actor recorded a split somebody else paid for — because
 * {@code related_transaction_id} must land on the actor's row and on nobody else's
 * (see {@link #fanOutSplitSaved}). A settlement is always
 * <strong>three</strong>. Every count is independent of member count, which is
 * what item 2 is about.
 *
 * <p><strong>Multi-payer splits (ADR 0025 §6.3)</strong> take one activity
 * INSERT per registered payer recipient, because each payer reads the payer list
 * with themselves as {@code You}. The count then grows with the number of
 * registered payers (at most 50, typically 2-3), still never with group size.
 * ADR 0025 records this as an accepted relaxation. Single-payer splits are
 * unchanged.
 *
 * <p><strong>Multi-contact individual splits (ADR 0026 §6.4)</strong> take one
 * activity INSERT and one notification INSERT per registered recipient (at most
 * 50), because each recipient reads a different counterpart list. Recorded and
 * accepted in that ADR. One-counterpart splits are unchanged.
 *
 * <h2>{@code group_created} is deliberately NOT written here</h2>
 *
 * <p>§7.2/§7.4 ask for no fan-out, data-model.md §5.1/§5.2 scope the requirement
 * to "the {@code split_expenses}/{@code settlements} write path", and a
 * {@code group_created} activity would need its sentence, icon, glyph, tone and
 * recipient rule — none of which a backend contract states. That gap is a known
 * System Architect decision (backend/README.md §15.8) and stays out of scope.
 *
 * <h2>Rollback</h2>
 *
 * <p>No {@code noRollbackFor}: this class writes and never throws anything a
 * client could act on. Its only throw is a count mismatch, which means the
 * recipient set and the {@code users} table disagree — a server bug where rolling
 * back is strictly better than committing a half-delivered fan-out.
 */
@Service
public class ActivityFanoutService {

    private static final Logger log = LoggerFactory.getLogger(ActivityFanoutService.class);

    private final ActivityRepository activityRepository;
    private final NotificationRepository notificationRepository;

    public ActivityFanoutService(
            ActivityRepository activityRepository,
            NotificationRepository notificationRepository) {
        this.activityRepository = activityRepository;
        this.notificationRepository = notificationRepository;
    }

    /**
     * Everything one {@code split_saved} fan-out needs, gathered by
     * {@code SplitExpenseService} from rows it has already written or resolved.
     *
     * <p>{@code recipients} is <strong>the registered users whose balance this
     * write moved, plus the actor</strong> — flagged in backend/README.md §16.6 as
     * this implementation's reading of "every affected member". An
     * <em>unregistered</em> member can never be a recipient: both
     * {@code activities.user_id} and {@code notifications.user_id} are
     * {@code NOT NULL} foreign keys to {@code users}, so a contact placeholder has
     * nowhere to receive anything. That is structural, not an omission.
     *
     * @param payers every payer, in ADR 0025 §5.2's response order (primary first,
     *               then amount descending, ties by id) — never empty. A payer's
     *               {@code userId} is {@code null} when an unregistered contact
     *               paid. With one payer the sentences are byte-identical to the
     *               pre-ADR-0025 ones; with two or more, ADR 0025 §6.2 applies.
     * @param otherPartyName individual mode, single payer only — the non-payer
     *                       party's name, which is what the payer's own row
     *                       highlights
     * @param counterparts   individual mode: every counterpart in REQUEST order
     *                       (ADR 0026 §6.4), never empty. Group mode: empty. With
     *                       exactly one counterpart the pre-ADR-0026 sentences are
     *                       written unchanged; with two or more, ADR 0026 §6.3's
     *                       creator-subject sentences are
     */
    public record SplitSavedFanout(
            boolean groupMode,
            UUID actorUserId,
            String actorName,
            List<Payer> payers,
            String otherPartyName,
            List<Counterpart> counterparts,
            String groupName,
            UUID relatedGroupId,
            UUID relatedContactId,
            UUID relatedSplitExpenseId,
            UUID relatedTransactionId,
            String title,
            BigDecimal amount,
            Set<UUID> recipients,
            UUID actorChangeLogId,
            /*
             * ADR 0028 §9.4: each recipient's exact effect clause (" You lent
             * ₹300." etc.), appended to that recipient's activity suffix and
             * notification. "" or absent = no clause. The prefix and entity name
             * stay exactly as before; only the clause is appended.
             */
            Map<UUID, String> effectClauses) {

        String clauseFor(UUID recipient) {
            return effectClauses == null ? "" : effectClauses.getOrDefault(recipient, "");
        }
    }

    /**
     * One payer as a fan-out sentence needs them: the account to match recipients
     * against ({@code null} for a contact placeholder) and the display name.
     */
    public record Payer(UUID userId, String name) {
    }

    /**
     * One counterpart of an individual split, as the fan-out needs them: the
     * account to deliver to ({@code null} for an unregistered contact, who
     * receives nothing) and the display name.
     */
    public record Counterpart(UUID userId, String name) {
    }

    /**
     * Everything one {@code settlement} fan-out needs (ADR 0028 §9.3: sentences
     * name payer and payee).
     *
     * @param payerUserId          {@code null} when an unregistered contact paid
     * @param payeeUserId          {@code null} when an unregistered contact was paid
     * @param remainingByRecipient individual mode: the pair balance after the
     *                             write, oriented to each recipient; group mode:
     *                             unused (may be empty)
     */
    public record SettlementFanout(
            boolean groupMode,
            UUID actorUserId,
            UUID payerUserId,
            String payerName,
            UUID payeeUserId,
            String payeeName,
            String groupName,
            UUID relatedGroupId,
            UUID relatedContactId,
            BigDecimal amount,
            Set<UUID> recipients,
            UUID actorChangeLogId,
            Map<UUID, BigDecimal> remainingByRecipient) {
    }

    /**
     * Everything one {@code split_edited} / {@code split_deleted} fan-out needs
     * (ADR 0028 §9.4).
     *
     * @param counterpartList  individual mode: ADR 0026 §6.3's Q for the actor's row
     * @param recipients       the actor plus every registered identity involved
     *                         (and the creator when their transaction changed)
     * @param effectClauses    per recipient, "" for none
     * @param creatorTransactionClause appended to the creator's notification when
     *                         the actor is not the creator and their personal
     *                         transaction changed (§5.4); {@code null} otherwise
     */
    public record SplitChangedFanout(
            boolean deleted,
            boolean groupMode,
            UUID actorUserId,
            String actorName,
            String title,
            String groupName,
            String counterpartList,
            UUID relatedGroupId,
            UUID relatedSplitExpenseId,
            UUID actorChangeLogId,
            Set<UUID> recipients,
            Map<UUID, String> effectClauses,
            UUID creatorUserId,
            String creatorTransactionClause) {
    }

    /** {@code split_edited}: {@code create-outline} / {@code E} / {@code neutral} (ADR 0028 §9.4). */
    static final String SPLIT_EDITED_ICON = "create-outline";
    static final String SPLIT_EDITED_GLYPH = "E";
    static final String SPLIT_EDITED_TONE = "neutral";

    /** {@code split_deleted}: {@code trash-outline} / {@code D} / {@code negative} (ADR 0028 §9.4). */
    static final String SPLIT_DELETED_ICON = "trash-outline";
    static final String SPLIT_DELETED_GLYPH = "D";
    static final String SPLIT_DELETED_TONE = "negative";

    /**
     * §9.1 step 4 — {@code split_saved}.
     *
     * <p>Three statements in the common case — the payer's activity row, everyone
     * else's activity rows, and one notification insert for every recipient except
     * the actor — and four when the actor did not pay, for the
     * {@code related_transaction_id} reason spelled out inline below.
     *
     * <p>{@code related_contact_id} is populated on <strong>every</strong> row of an
     * individual split, not only the actor's. It is the actor's own contact for the
     * other party (ADR 0008 §2.2: "{@code relatedContactId} = the other
     * participant's {@code participantId}, Individual mode only"), so the
     * counterpart's row references a contact owned by someone else — which
     * {@code V13} explicitly sanctions at
     * {@code fk_activities_related_contact_id}: "a fanned-out row may legitimately
     * reference a contact owned by a DIFFERENT member". The four
     * {@code related_*} columns are navigation only, so the worst case is a link
     * that resolves to nothing for that reader. Noted in backend/README.md §16.6
     * rather than silently narrowed, because the alternative (null on everyone
     * else's row) would need a third statement to express.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void fanOutSplitSaved(SplitSavedFanout event) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        LocalDate date = now.toLocalDate();
        LocalTime time = now.toLocalTime();

        if (!event.groupMode() && event.counterparts().size() > 1) {
            fanOutMultiContactSplit(event, date, time, now);
            return;
        }

        if (event.payers().size() == 1) {
            insertSinglePayerActivities(event, date, time, now);
        } else {
            insertMultiPayerActivities(event, date, time, now);
        }

        Set<UUID> notified = notificationRecipients(event.recipients(), event.actorUserId());
        if (!notified.isEmpty()) {
            // Unchanged by ADR 0025 §6.3: a notification names the ACTOR, not the
            // payer, so the number of payers does not affect it.
            String message = ActivitySentences.splitSavedNotification(
                    event.groupMode(), event.groupName(), event.actorName(),
                    event.amount(), event.title());
            // ADR 0028 §9.4: each recipient's effect clause is appended.
            for (Map.Entry<String, Set<UUID>> byClause : groupByClause(notified, event::clauseFor).entrySet()) {
                insertNotifications(Notification.TYPE_GROUP_EXPENSE, byClause.getValue(),
                        message + byClause.getKey(), date, time, now);
            }
        }

        log.info("Split-saved fan-out for split expense {}: {} activity row(s), {} notification(s)",
                event.relatedSplitExpenseId(), event.recipients().size(), notified.size());
    }

    /**
     * The pre-ADR-0025 activity rows, <strong>unchanged</strong>: a single-payer
     * split must produce byte-identical sentences and the same statement count
     * (ADR 0025 §6).
     */
    private void insertSinglePayerActivities(
            SplitSavedFanout event, LocalDate date, LocalTime time, OffsetDateTime now) {
        UUID payerUserId = event.payers().get(0).userId();
        String payerName = event.payers().get(0).name();

        boolean actorPaid = event.actorUserId().equals(payerUserId);

        // Up to three recipient classes, and TWO in the common case. The split is
        // by SENTENCE first (the payer reads "You paid", everyone else reads
        // "{payer} paid" — ADR 0008 §2.2's templates are viewer-relative), with the
        // actor peeled off separately only when they did not pay, because of
        // related_transaction_id:
        //
        // *** THE CONSUMPTION-SHARE TRANSACTION ID MUST APPEAR ON THE ACTOR'S ROW
        // *** AND ON NOBODY ELSE'S. *** transactions are OWNER-scoped, not
        // membership-gated — unlike groups, contacts and split expenses, which is
        // why V13's "a fanned-out row may legitimately reference a contact owned by
        // a DIFFERENT member" sanction does not extend to this one column. A link
        // to another user's transaction resolves to a 404 for that reader and
        // exposes an id they have no business holding.
        Set<UUID> payerRecipients = intersect(event.recipients(), payerUserId);
        Set<UUID> actorOnly = actorPaid ? Set.of() : intersect(event.recipients(), event.actorUserId());
        Set<UUID> otherRecipients =
                exclude(exclude(event.recipients(), payerUserId), event.actorUserId());

        if (!payerRecipients.isEmpty()) {
            ActivitySentences.Sentence sentence = ActivitySentences.splitSavedForPayer(
                    event.groupMode(),
                    event.groupMode() ? event.groupName() : event.otherPartyName(),
                    event.amount(),
                    event.title());
            insertSplitSavedActivities(event,payerRecipients, sentence, date, time,
                    actorPaid ? event.relatedTransactionId() : null,
                    event.relatedGroupId(), event.relatedContactId(),
                    event.relatedSplitExpenseId(), actorPaid ? event.actorChangeLogId() : null, now);
        }

        ActivitySentences.Sentence otherSentence = ActivitySentences.splitSavedForOther(
                event.groupMode(),
                event.groupName(),
                payerName,
                event.amount(),
                event.title());

        if (!actorOnly.isEmpty()) {
            // One row, and only when the actor recorded a split somebody else
            // paid for. Without this statement the actor's own feed entry would
            // lose the link to the transaction this request just created for them.
            insertSplitSavedActivities(event,actorOnly, otherSentence, date, time,
                    event.relatedTransactionId(), event.relatedGroupId(), event.relatedContactId(),
                    event.relatedSplitExpenseId(), event.actorChangeLogId(), now);
        }

        if (!otherRecipients.isEmpty()) {
            insertSplitSavedActivities(event,otherRecipients, otherSentence, date, time,
                    null, event.relatedGroupId(), event.relatedContactId(),
                    event.relatedSplitExpenseId(), null, now);
        }
    }

    /**
     * ADR 0025 §6.2/§6.3 — a split with <strong>two or more payers</strong>.
     *
     * <p><strong>One INSERT per registered payer recipient.</strong> Each payer
     * reads a different payer list, because each sees themselves as {@code You},
     * first. That is the accepted relaxation of the constant-statement property
     * recorded in ADR 0025 §6.3: the count grows with the number of registered
     * payers (at most 50, typically 2-3), never with group size. Non-payers still
     * share one sentence, split only so {@code related_transaction_id} lands on the
     * actor's row and on nobody else's, exactly as in the single-payer path.
     *
     * <p>"Has paid" means any registered payer, not only the primary
     * (ADR 0025 §6.3).
     */
    private void insertMultiPayerActivities(
            SplitSavedFanout event, LocalDate date, LocalTime time, OffsetDateTime now) {
        Set<UUID> payerUserIds = new LinkedHashSet<>();
        for (Payer payer : event.payers()) {
            if (payer.userId() != null) {
                payerUserIds.add(payer.userId());
            }
        }

        for (UUID recipient : event.recipients()) {
            if (!payerUserIds.contains(recipient)) {
                continue;
            }
            ActivitySentences.Sentence sentence = event.groupMode()
                    ? ActivitySentences.splitSavedMultiPayerInGroup(
                            ActivitySentences.joinPayerLabels(labelsFor(event.payers(), recipient)),
                            event.groupName(), event.amount(), event.title())
                    : ActivitySentences.splitSavedMultiPayerForPair(
                            otherPayerName(event.payers(), recipient), event.amount(), event.title());
            insertSplitSavedActivities(event,Set.of(recipient), sentence, date, time,
                    recipient.equals(event.actorUserId()) ? event.relatedTransactionId() : null,
                    event.relatedGroupId(), event.relatedContactId(),
                    event.relatedSplitExpenseId(),
                    recipient.equals(event.actorUserId()) ? event.actorChangeLogId() : null, now);
        }

        Set<UUID> nonPayers = new LinkedHashSet<>(event.recipients());
        nonPayers.removeAll(payerUserIds);
        if (nonPayers.isEmpty()) {
            return;
        }
        if (!event.groupMode()) {
            // Two payers on a pair means both parties paid (R3 + R7), so every
            // registered recipient is a payer. Reaching this is a service bug.
            throw new IllegalStateException(
                    "Individual split " + event.relatedSplitExpenseId()
                            + " has a non-payer recipient with multiple payers");
        }

        ActivitySentences.Sentence otherSentence = ActivitySentences.splitSavedMultiPayerInGroup(
                ActivitySentences.joinPayerLabels(labelsFor(event.payers(), null)),
                event.groupName(), event.amount(), event.title());
        Set<UUID> actorOnly = intersect(nonPayers, event.actorUserId());
        Set<UUID> otherRecipients = exclude(nonPayers, event.actorUserId());
        if (!actorOnly.isEmpty()) {
            insertSplitSavedActivities(event,actorOnly, otherSentence, date, time,
                    event.relatedTransactionId(), event.relatedGroupId(), event.relatedContactId(),
                    event.relatedSplitExpenseId(), event.actorChangeLogId(), now);
        }
        if (!otherRecipients.isEmpty()) {
            insertSplitSavedActivities(event,otherRecipients, otherSentence, date, time,
                    null, event.relatedGroupId(), event.relatedContactId(),
                    event.relatedSplitExpenseId(), null, now);
        }
    }

    /**
     * ADR 0026 §6 — an individual split with <strong>two or more
     * counterparts</strong>.
     *
     * <p>Every recipient's balance moves against the creator, whoever paid, so
     * every sentence names the <strong>creator</strong> and lists who the bill was
     * shared with (§6.2). Recipients are the creator plus every registered
     * counterpart; unregistered contacts receive nothing.
     *
     * <p><strong>One activity INSERT and one notification INSERT per registered
     * recipient</strong>, because each reads a different list (§6.4, at most 50 by
     * the request bound). {@code related_contact_id} is {@code null} on every row:
     * no single contact is the subject. {@code related_transaction_id} lands on the
     * creator's row only, exactly as in the other paths.
     */
    private void fanOutMultiContactSplit(
            SplitSavedFanout event, LocalDate date, LocalTime time, OffsetDateTime now) {
        List<Counterpart> counterparts = event.counterparts();
        int activityRows = 0;
        int notificationRows = 0;

        if (event.recipients().contains(event.actorUserId())) {
            ActivitySentences.Sentence sentence = ActivitySentences.splitSavedMultiContactForCreator(
                    ActivitySentences.joinPayerLabels(counterpartLabels(counterparts, -1)),
                    event.amount(), event.title());
            insertSplitSavedActivities(event,Set.of(event.actorUserId()), sentence, date, time,
                    event.relatedTransactionId(), null, null, event.relatedSplitExpenseId(),
                    event.actorChangeLogId(), now);
            activityRows++;
        }

        for (int i = 0; i < counterparts.size(); i++) {
            UUID recipient = counterparts.get(i).userId();
            if (recipient == null
                    || recipient.equals(event.actorUserId())
                    || !event.recipients().contains(recipient)) {
                continue;
            }
            String joined = ActivitySentences.joinPayerLabels(counterpartLabels(counterparts, i));
            ActivitySentences.Sentence sentence = ActivitySentences.splitSavedMultiContactForCounterpart(
                    event.actorName(), joined, event.amount(), event.title());
            insertSplitSavedActivities(event,Set.of(recipient), sentence, date, time,
                    null, null, null, event.relatedSplitExpenseId(), null, now);
            activityRows++;

            String message = ActivitySentences.splitSavedMultiContactNotification(
                    event.actorName(), joined, event.amount(), event.title()) + event.clauseFor(recipient);
            insertNotifications(Notification.TYPE_GROUP_EXPENSE, Set.of(recipient), message, date, time, now);
            notificationRows++;
        }

        log.info("Split-saved fan-out for multi-contact split expense {}: {} activity row(s), "
                        + "{} notification(s)",
                event.relatedSplitExpenseId(), activityRows, notificationRows);
    }

    /**
     * ADR 0026 §6.3's list for one recipient, in request order: every
     * counterpart's name for the creator ({@code recipientIndex = -1}), or
     * {@code you} followed by every OTHER counterpart's name for counterpart
     * {@code recipientIndex}.
     */
    static List<String> counterpartLabels(List<Counterpart> counterparts, int recipientIndex) {
        List<String> labels = new ArrayList<>(counterparts.size());
        if (recipientIndex >= 0) {
            labels.add("you");
        }
        for (int i = 0; i < counterparts.size(); i++) {
            if (i != recipientIndex) {
                labels.add(counterparts.get(i).name());
            }
        }
        return labels;
    }

    /**
     * ADR 0025 §6.1's label order for one recipient: {@code You} first if the
     * recipient paid, then every other payer in response order.
     *
     * @param recipient {@code null} for a recipient who did not pay
     */
    private static List<String> labelsFor(List<Payer> payers, UUID recipient) {
        List<String> labels = new ArrayList<>(payers.size());
        if (recipient != null) {
            labels.add("You");
        }
        for (Payer payer : payers) {
            if (recipient == null || !recipient.equals(payer.userId())) {
                labels.add(payer.name());
            }
        }
        return labels;
    }

    /** Individual mode: the name of the payer who is not this recipient. */
    private static String otherPayerName(List<Payer> payers, UUID recipient) {
        for (Payer payer : payers) {
            if (!recipient.equals(payer.userId())) {
                return payer.name();
            }
        }
        return "";
    }

    /**
     * §10.1 step 5 — {@code settlement}.
     *
     * <p><strong>ADR 0028 §9.3 (2026-11-12):</strong> the sentences now name the
     * payer and the payee, from each recipient's side, and an individual
     * settlement appends the pair's remaining balance as that recipient sees it.
     * Recipients are unchanged (the actor plus a registered counterpart). Each
     * recipient reads a different sentence, so this is one activity INSERT per
     * recipient (at most two today) and one notification INSERT per non-actor
     * recipient; legacy rows written before this change are untouched.
     *
     * <p>{@code relatedTransactionId} and {@code relatedSplitExpenseId} are
     * <strong>always null</strong> here, and both are confirmed rather than
     * incidental (ADR 0009 §6.3): a settlement creates no transaction, and it
     * resolves the <em>aggregate</em> balance rather than any one split expense, so
     * there is nothing single to link back to. {@code V13} FLAG 1 records the
     * consequence — with no {@code related_settlement_id} column, a settlement
     * activity cannot be navigated to its own settlement row.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void fanOutSettlement(SettlementFanout event) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        LocalDate date = now.toLocalDate();
        LocalTime time = now.toLocalTime();

        Set<UUID> otherRecipients = exclude(event.recipients(), event.actorUserId());

        for (UUID recipient : event.recipients()) {
            ActivitySentences.Sentence sentence = settlementSentenceFor(event, recipient);
            boolean actor = recipient.equals(event.actorUserId());
            insertActivities(Activity.TYPE_SETTLEMENT, Set.of(recipient), sentence, date, time,
                    null, event.relatedGroupId(), event.relatedContactId(), null,
                    actor ? event.actorChangeLogId() : null, now);
            if (!actor) {
                insertNotifications(Notification.TYPE_SETTLEMENT, Set.of(recipient),
                        ActivitySentences.flatten(sentence), date, time, now);
            }
        }

        log.info("Settlement fan-out for group {}: {} activity row(s), {} notification(s)",
                event.relatedGroupId(), event.recipients().size(), otherRecipients.size());
    }

    /** ADR 0028 §9.3's sentence for one recipient. */
    static ActivitySentences.Sentence settlementSentenceFor(SettlementFanout event, UUID recipient) {
        boolean recipientPaid = recipient.equals(event.payerUserId());
        boolean recipientReceived = recipient.equals(event.payeeUserId());
        if (event.groupMode()) {
            return ActivitySentences.groupSettlement(
                    recipientPaid ? null : event.payerName(),
                    recipientReceived ? null : event.payeeName(),
                    event.amount(), event.groupName());
        }
        BigDecimal remaining = event.remainingByRecipient() == null
                ? null : event.remainingByRecipient().get(recipient);
        return ActivitySentences.pairSettlement(
                recipientPaid, recipientPaid ? event.payeeName() : event.payerName(), event.amount(), remaining);
    }

    /**
     * ADR 0028 §9.4 — {@code split_edited} / {@code split_deleted}.
     *
     * <p>One activity INSERT per recipient, because every recipient reads their
     * own effect clause; one notification INSERT per non-actor recipient, type
     * {@code group_expense} (the type the create path uses), carrying the same
     * sentence flattened, plus §5.4's clause for the creator when the actor
     * changed their personal transaction. {@code related_split_expense_id} on
     * every row, {@code related_group_id} in group mode, and
     * {@code related_change_log_id} on the actor's row only. Bounded by the
     * recipient count (at most 50 by the request bounds).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void fanOutSplitChanged(SplitChangedFanout event) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        LocalDate date = now.toLocalDate();
        LocalTime time = now.toLocalTime();
        String verb = event.deleted() ? "deleted" : "edited";
        String type = event.deleted() ? Activity.TYPE_SPLIT_DELETED : Activity.TYPE_SPLIT_EDITED;
        String icon = event.deleted() ? SPLIT_DELETED_ICON : SPLIT_EDITED_ICON;
        String glyph = event.deleted() ? SPLIT_DELETED_GLYPH : SPLIT_EDITED_GLYPH;
        String tone = event.deleted() ? SPLIT_DELETED_TONE : SPLIT_EDITED_TONE;
        int notified = 0;

        for (UUID recipient : event.recipients()) {
            boolean actor = recipient.equals(event.actorUserId());
            String clause = event.effectClauses() == null ? "" : event.effectClauses().getOrDefault(recipient, "");
            ActivitySentences.Sentence sentence = ActivitySentences.splitChanged(
                    verb, event.groupMode(), actor ? null : event.actorName(), event.title(),
                    event.groupName(), event.counterpartList(), clause);
            insertActivitiesWithIcon(type, Set.of(recipient), sentence, date, time,
                    null, event.relatedGroupId(), null, event.relatedSplitExpenseId(),
                    actor ? event.actorChangeLogId() : null, icon, glyph, tone, now);
            if (actor) {
                continue;
            }
            String message = ActivitySentences.flatten(sentence);
            if (event.creatorTransactionClause() != null && recipient.equals(event.creatorUserId())) {
                message = message + event.creatorTransactionClause();
            }
            insertNotifications(Notification.TYPE_GROUP_EXPENSE, Set.of(recipient), message, date, time, now);
            notified++;
        }

        log.info("Split-{} fan-out for split expense {}: {} activity row(s), {} notification(s)",
                verb, event.relatedSplitExpenseId(), event.recipients().size(), notified);
    }

    /**
     * Split-saved activity rows with each recipient's ADR 0028 §9.4 effect clause
     * appended to the suffix. Recipients sharing a clause share one statement.
     */
    private void insertSplitSavedActivities(
            SplitSavedFanout event,
            Set<UUID> recipients,
            ActivitySentences.Sentence sentence,
            LocalDate date,
            LocalTime time,
            UUID relatedTransactionId,
            UUID relatedGroupId,
            UUID relatedContactId,
            UUID relatedSplitExpenseId,
            UUID relatedChangeLogId,
            OffsetDateTime now) {
        for (Map.Entry<String, Set<UUID>> byClause : groupByClause(recipients, event::clauseFor).entrySet()) {
            ActivitySentences.Sentence withClause = new ActivitySentences.Sentence(
                    sentence.prefix(), sentence.entityName(), sentence.suffix() + byClause.getKey());
            insertActivities(Activity.TYPE_SPLIT_SAVED, byClause.getValue(), withClause, date, time,
                    relatedTransactionId, relatedGroupId, relatedContactId, relatedSplitExpenseId,
                    relatedChangeLogId, now);
        }
    }

    /** Recipients grouped by their clause, order-preserving. */
    private static Map<String, Set<UUID>> groupByClause(Set<UUID> recipients, Function<UUID, String> clauseFor) {
        Map<String, Set<UUID>> grouped = new LinkedHashMap<>();
        for (UUID recipient : recipients) {
            grouped.computeIfAbsent(clauseFor.apply(recipient), clause -> new LinkedHashSet<>()).add(recipient);
        }
        return grouped;
    }

    /**
     * Every affected member except the actor —
     * <strong>{@code notifications}' recipient rule, in one place</strong>
     * ({@code V13} contract item 2). Public and static so a reader checking the
     * rule finds one method rather than two set subtractions in two write paths.
     */
    public static Set<UUID> notificationRecipients(Set<UUID> affected, UUID actorUserId) {
        return exclude(affected, actorUserId);
    }

    private void insertActivities(
            String type,
            Set<UUID> recipients,
            ActivitySentences.Sentence sentence,
            LocalDate date,
            LocalTime time,
            UUID relatedTransactionId,
            UUID relatedGroupId,
            UUID relatedContactId,
            UUID relatedSplitExpenseId,
            UUID relatedChangeLogId,
            OffsetDateTime now) {
        insertActivitiesWithIcon(type, recipients, sentence, date, time,
                relatedTransactionId, relatedGroupId, relatedContactId, relatedSplitExpenseId,
                relatedChangeLogId,
                ActivitySentences.MONEY_MOVEMENT_ICON,
                ActivitySentences.MONEY_MOVEMENT_GLYPH,
                ActivitySentences.MONEY_MOVEMENT_TONE,
                now);
    }

    private void insertActivitiesWithIcon(
            String type,
            Set<UUID> recipients,
            ActivitySentences.Sentence sentence,
            LocalDate date,
            LocalTime time,
            UUID relatedTransactionId,
            UUID relatedGroupId,
            UUID relatedContactId,
            UUID relatedSplitExpenseId,
            UUID relatedChangeLogId,
            String iconName,
            String glyph,
            String tone,
            OffsetDateTime now) {
        int inserted = activityRepository.insertFanout(
                recipients, type, date, time,
                sentence.prefix(), sentence.entityName(), sentence.suffix(),
                relatedTransactionId, relatedGroupId, relatedContactId, relatedSplitExpenseId,
                relatedChangeLogId, iconName, glyph, tone, now);
        requireFullFanout("activities", recipients.size(), inserted);
    }

    private void insertNotifications(
            String type,
            Set<UUID> recipients,
            String message,
            LocalDate date,
            LocalTime time,
            OffsetDateTime now) {
        int inserted = notificationRepository.insertFanout(recipients, type, message, date, time, now);
        requireFullFanout("notifications", recipients.size(), inserted);
    }

    /**
     * A partial fan-out is a bug, not a degraded success.
     *
     * <p>Both inserts are driven by {@code FROM users WHERE id IN (...)}, so a
     * short count means a recipient id is not a real account — i.e. the membership
     * read and the insert disagree, which is exactly the condition {@code V13}
     * contract item 1 says to treat as "a 500 and a bug worth logging loudly". The
     * rollback that follows is the point: an event half the group heard about is
     * worse than one nobody heard about, because only the former is invisible.
     */
    private static void requireFullFanout(String table, int expected, int inserted) {
        if (inserted != expected) {
            log.error("FAN-OUT INCOMPLETE on {}: expected {} row(s), inserted {}. A recipient id "
                    + "does not resolve to a users row, so the membership read and the insert "
                    + "disagree.", table, expected, inserted);
            throw new IllegalStateException(
                    "Fan-out to " + table + " inserted " + inserted + " of " + expected + " rows");
        }
    }

    /** {@code {candidate}} if it is in {@code source}, else empty. Never a null element. */
    private static Set<UUID> intersect(Set<UUID> source, UUID candidate) {
        return candidate != null && source.contains(candidate) ? Set.of(candidate) : Set.of();
    }

    /**
     * {@code source} without {@code excluded}, order-preserving so the two
     * statements of one event bind their id lists deterministically — which makes
     * a failure reproducible.
     */
    private static Set<UUID> exclude(Set<UUID> source, UUID excluded) {
        Set<UUID> result = new LinkedHashSet<>(source);
        if (excluded != null) {
            result.remove(excluded);
        }
        return result;
    }
}
