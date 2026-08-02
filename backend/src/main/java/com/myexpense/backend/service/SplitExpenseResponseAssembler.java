package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.myexpense.backend.dto.response.SplitCounterpartSummary;
import com.myexpense.backend.dto.response.SplitExpenseResponse;
import com.myexpense.backend.dto.response.SplitParticipantSummary;
import com.myexpense.backend.dto.response.SplitPayerSummary;
import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.entity.SplitExpense;
import com.myexpense.backend.entity.SplitExpenseIndividualBalance;
import com.myexpense.backend.entity.SplitExpenseParticipant;
import com.myexpense.backend.entity.SplitExpensePayer;
import com.myexpense.backend.entity.SplitMode;
import com.myexpense.backend.repository.ContactRepository;
import com.myexpense.backend.repository.IndividualBalanceRepository;
import com.myexpense.backend.repository.MemberNameRow;
import com.myexpense.backend.repository.SplitExpenseIndividualBalanceRepository;
import com.myexpense.backend.repository.SplitExpenseParticipantRepository;
import com.myexpense.backend.repository.SplitExpensePayerRepository;
import com.myexpense.backend.repository.UserRepository;

/**
 * Composes {@code SplitExpenseResponse} (api-overview.md §9.3) from rows —
 * <strong>without an N+1, for any number of split expenses</strong>.
 *
 * <p>Extracted from {@code SplitExpenseService} for the same reason
 * {@code GroupResponseAssembler} was extracted from {@code GroupService}: three
 * endpoints need the identical composition ({@code POST /split-expenses},
 * {@code GET /split-expenses/{id}}, {@code GET /split-expenses}), and two of
 * §9.3's fields are not columns of this table — {@code participants[]} is another
 * table and {@code paidByName} is a cross-table resolution.
 *
 * <p><strong>The query budget is fixed at six, whatever the list length:</strong>
 * one for every participant of every split ({@code WHERE split_expense_id = ANY
 * (?)}, which {@code V11} contract item 7 names as a specific trap if done per
 * row), one for every payer of every split (ADR 0025 §5.2, the same shape over
 * {@code split_expense_payers}), one for every pair link of every split and one
 * for every linked pair row (ADR 0026 §5.2, the latter skipped for a page of
 * group splits), plus one name lookup per source table over every payer and
 * counterpart id in the page. Each name lookup is skipped entirely when its id
 * set is empty.
 *
 * <p><strong>{@code participants[].name} costs no query at all</strong>, and that
 * is the whole point of the column: {@code split_expense_participants.name} is a
 * frozen snapshot, so the response reads it off the row it already loaded
 * ({@code V11} contract item 7: "the participant name is already snapshotted on
 * the row — use it"). The five category fields are the same deal: they exist
 * "precisely so rendering needs no join to {@code categories}".
 *
 * <p>{@code payers[].name} and the deprecated {@code paidByName} are the names
 * that <em>are</em> resolved live, because neither §4.6 nor
 * {@code split_expense_payers} snapshots a payer name (ADR 0025 §2.2). The
 * asymmetry is the schema's, not this class's.
 *
 * <p><strong>No authorization happens here.</strong> This class composes what it
 * is given; the caller has already proved the viewer's membership of every split's
 * target. A composer that also decided access would be a second place to get the
 * membership rule right — the same disposition {@code GroupResponseAssembler}
 * takes.
 *
 * <p>The contact-name lookup is deliberately <strong>not</strong> owner-scoped: a
 * contact that paid for a group split may be owned by any member ({@code V11}'s
 * note on the single-column {@code fk_split_expenses_paid_by_contact_id}), and
 * §9.3 requires the name. Only names are read, never a phone, an email or a
 * {@code linkedUserId}.
 */
@Service
public class SplitExpenseResponseAssembler {

    private static final Logger log = LoggerFactory.getLogger(SplitExpenseResponseAssembler.class);

    /** {@code numeric(12,2)} zero, so a counterpart with no net renders {@code 0.00}. */
    private static final BigDecimal ZERO_AMOUNT = BigDecimal.ZERO.setScale(2);

    private final SplitExpenseParticipantRepository participantRepository;
    private final SplitExpensePayerRepository payerRepository;
    private final SplitExpenseIndividualBalanceRepository pairLinkRepository;
    private final IndividualBalanceRepository balanceRepository;
    private final UserRepository userRepository;
    private final ContactRepository contactRepository;

    public SplitExpenseResponseAssembler(
            SplitExpenseParticipantRepository participantRepository,
            SplitExpensePayerRepository payerRepository,
            SplitExpenseIndividualBalanceRepository pairLinkRepository,
            IndividualBalanceRepository balanceRepository,
            UserRepository userRepository,
            ContactRepository contactRepository) {
        this.participantRepository = participantRepository;
        this.payerRepository = payerRepository;
        this.pairLinkRepository = pairLinkRepository;
        this.balanceRepository = balanceRepository;
        this.userRepository = userRepository;
        this.contactRepository = contactRepository;
    }

    /** One response per split expense, in the order the rows were given. */
    public List<SplitExpenseResponse> assemble(List<SplitExpense> splits) {
        if (splits.isEmpty()) {
            return List.of();
        }

        List<UUID> splitIds = splits.stream().map(SplitExpense::getId).toList();
        // ADR 0028 §3.3: the CURRENT revision's rows only, in one query each.
        List<SplitExpenseParticipant> participants =
                participantRepository.findCurrentBySplitExpenseIdIn(splitIds);

        Map<UUID, List<SplitParticipantSummary>> participantsBySplitId = new HashMap<>();
        for (SplitExpenseParticipant participant : participants) {
            participantsBySplitId
                    .computeIfAbsent(participant.getSplitExpenseId(), id -> new ArrayList<>())
                    .add(new SplitParticipantSummary(
                            participant.getParticipantUserId(),
                            participant.getParticipantContactId(),
                            participant.getName(),
                            participant.getAmount()));
        }

        // ADR 0025 §5.2: every payer of every split in ONE query, then one name
        // lookup per source table over every payer id in the page.
        Map<UUID, List<SplitExpensePayer>> payersBySplitId = new HashMap<>();
        for (SplitExpensePayer payer : payerRepository.findCurrentBySplitExpenseIdIn(splitIds)) {
            payersBySplitId
                    .computeIfAbsent(payer.getSplitExpenseId(), id -> new ArrayList<>())
                    .add(payer);
        }
        for (SplitExpense split : splits) {
            if (!payersBySplitId.containsKey(split.getId())) {
                payersBySplitId.put(split.getId(), List.of(legacyPayerRow(split)));
            }
        }

        // ADR 0026 §5.2: every pair link of every split in ONE query, then every
        // referenced pair row in ONE query, to derive each counterpart relative to
        // the split's creator.
        Map<UUID, List<CounterpartRow>> counterpartsBySplitId = loadCounterparts(splits, splitIds);

        // One name lookup per source table for payers, counterparts, creators and
        // deleters together (ADR 0028 §6.4 adds the last two at no extra query).
        Set<UUID> userIds = payerUserIds(payersBySplitId);
        Set<UUID> contactIds = payerContactIds(payersBySplitId);
        for (SplitExpense split : splits) {
            userIds.add(split.getCreatedByUserId());
            if (split.getDeletedByUserId() != null) {
                userIds.add(split.getDeletedByUserId());
            }
        }
        for (List<CounterpartRow> rows : counterpartsBySplitId.values()) {
            for (CounterpartRow row : rows) {
                if (row.userId() != null) {
                    userIds.add(row.userId());
                } else {
                    contactIds.add(row.contactId());
                }
            }
        }
        Map<UUID, String> namesByUserId = resolveNames(userIds, userRepository::findMemberNamesByIdIn);
        Map<UUID, String> namesByContactId =
                resolveNames(contactIds, contactRepository::findMemberNamesByIdIn);

        List<SplitExpenseResponse> responses = new ArrayList<>(splits.size());
        for (SplitExpense split : splits) {
            // copyOf so the record handed to Jackson holds no reference to the
            // mutable accumulator above — the same sharp edge
            // GroupResponseAssembler avoids.
            List<SplitParticipantSummary> rows =
                    List.copyOf(participantsBySplitId.getOrDefault(split.getId(), List.of()));
            List<SplitExpensePayer> payerRows = payersBySplitId.get(split.getId());
            List<SplitPayerSummary> payers = toPayerSummaries(
                    orderForResponse(payerRows, split.getPaidByUserId(), split.getPaidByContactId()),
                    namesByUserId, namesByContactId);
            List<SplitCounterpartSummary> counterparts = toCounterpartSummaries(
                    split, counterpartsBySplitId.getOrDefault(split.getId(), List.of()),
                    payerRows, rows, namesByUserId, namesByContactId);
            responses.add(toResponse(split, rows, payers, counterparts, namesByUserId));
        }
        return List.copyOf(responses);
    }

    /**
     * Each split's counterparts, relative to its creator (ADR 0026 §2.2): on a
     * contact row, {@code counterpart_contact_id}; on a canonical user-pair row,
     * whichever of {@code user_id}/{@code counterpart_user_id} is not the creator.
     * Group splits get no entry.
     */
    private Map<UUID, List<CounterpartRow>> loadCounterparts(List<SplitExpense> splits, List<UUID> splitIds) {
        Map<UUID, List<UUID>> pairIdsBySplitId = new HashMap<>();
        for (SplitExpenseIndividualBalance link : pairLinkRepository.findBySplitExpenseIdIn(splitIds)) {
            pairIdsBySplitId
                    .computeIfAbsent(link.getSplitExpenseId(), id -> new ArrayList<>())
                    .add(link.getIndividualBalanceId());
        }
        for (SplitExpense split : splits) {
            if (split.getSplitMode() == SplitMode.INDIVIDUAL && !pairIdsBySplitId.containsKey(split.getId())) {
                pairIdsBySplitId.put(split.getId(), List.of(legacyPairId(split)));
            }
        }
        if (pairIdsBySplitId.isEmpty()) {
            return Map.of();
        }

        Set<UUID> pairIds = new HashSet<>();
        pairIdsBySplitId.values().forEach(pairIds::addAll);
        Map<UUID, IndividualBalance> pairsById = new HashMap<>();
        for (IndividualBalance pair : balanceRepository.findAllById(pairIds)) {
            pairsById.put(pair.getId(), pair);
        }

        Map<UUID, List<CounterpartRow>> result = new HashMap<>();
        for (SplitExpense split : splits) {
            List<UUID> ids = pairIdsBySplitId.get(split.getId());
            if (ids == null) {
                continue;
            }
            List<CounterpartRow> rows = new ArrayList<>(ids.size());
            for (UUID pairId : ids) {
                IndividualBalance pair = pairsById.get(pairId);
                if (pair == null) {
                    // Unreachable: fk_split_expense_individual_balances_individual_balance_id
                    // is NO ACTION and nothing is ever hard-deleted.
                    throw new IllegalStateException("Linked pair row " + pairId + " could not be read");
                }
                rows.add(new CounterpartRow(
                        pairId,
                        IndividualBalanceService.counterpartUserIdOf(pair, split.getCreatedByUserId()),
                        pair.getCounterpartContactId()));
            }
            result.put(split.getId(), rows);
        }
        return result;
    }

    /**
     * An individual split with <strong>no link row</strong>: one written by
     * pre-ADR-0026 code after V17 ran (V17's CONTRACT item 1 names the hazard).
     * It moved exactly its legacy pair, which is what V17's backfill would have
     * linked, so the response stays truthful and {@code counterparts[]} is never
     * empty. This is one of the two permitted reads of
     * {@code split_expenses.individual_balance_id} (ADR 0026 §3). Logged, because
     * it means V17 and the backend were not deployed together. Ids only.
     */
    private static UUID legacyPairId(SplitExpense split) {
        log.warn("Split expense {} has no split_expense_individual_balances row; answering from "
                + "individual_balance_id (V17 and the backend were not deployed together)", split.getId());
        return split.getIndividualBalanceId();
    }

    /**
     * ADR 0026 §5.2: the primary counterpart first (the link matching the legacy
     * {@code individual_balance_id}, the other permitted read of that column),
     * then {@code individualBalanceId} ascending in PostgreSQL's unsigned uuid
     * order ({@link IndividualBalanceService#compareCanonical}, never
     * {@link UUID#compareTo}). {@code netAmount} = {@code paid_c − share_c} from
     * this split's own payer and participant rows.
     */
    private static List<SplitCounterpartSummary> toCounterpartSummaries(
            SplitExpense split,
            List<CounterpartRow> rows,
            List<SplitExpensePayer> payerRows,
            List<SplitParticipantSummary> participants,
            Map<UUID, String> namesByUserId,
            Map<UUID, String> namesByContactId) {
        UUID primaryPairId = split.getIndividualBalanceId();
        List<CounterpartRow> ordered = new ArrayList<>(rows);
        ordered.sort(Comparator
                .comparing((CounterpartRow row) -> !row.individualBalanceId().equals(primaryPairId))
                .thenComparing(CounterpartRow::individualBalanceId, IndividualBalanceService::compareCanonical));

        List<SplitCounterpartSummary> summaries = new ArrayList<>(ordered.size());
        for (CounterpartRow row : ordered) {
            String name = row.userId() != null
                    ? namesByUserId.getOrDefault(row.userId(), "")
                    : namesByContactId.getOrDefault(row.contactId(), "");
            summaries.add(new SplitCounterpartSummary(
                    row.individualBalanceId(), row.userId(), row.contactId(), name,
                    netAmount(row, payerRows, participants)));
        }
        return List.copyOf(summaries);
    }

    /** {@code paid_c − share_c}, at the column's scale so an even split reads {@code 0.00}. */
    private static BigDecimal netAmount(
            CounterpartRow row, List<SplitExpensePayer> payerRows, List<SplitParticipantSummary> participants) {
        BigDecimal net = ZERO_AMOUNT;
        for (SplitExpensePayer payer : payerRows) {
            if (row.matches(payer.getPayerUserId(), payer.getPayerContactId())) {
                net = net.add(payer.getAmountPaid());
            }
        }
        for (SplitParticipantSummary participant : participants) {
            if (row.matches(participant.participantUserId(), participant.participantContactId())) {
                net = net.subtract(participant.amount());
            }
        }
        return net;
    }

    /** One counterpart of one split, relative to its creator. Exactly one id is non-null. */
    private record CounterpartRow(UUID individualBalanceId, UUID userId, UUID contactId) {

        boolean matches(UUID otherUserId, UUID otherContactId) {
            return userId != null
                    ? userId.equals(otherUserId)
                    : contactId != null && contactId.equals(otherContactId);
        }
    }

    /**
     * <strong>The one definition of §5.2's payer order</strong>, used by this
     * class for the response and by {@code SplitExpenseService} for the activity
     * label order (ADR 0025 §6.1), so the feed and the screen list payers the same
     * way.
     *
     * <p>Primary payer first (the row matching {@code split_expenses.paid_by_*}),
     * then {@code amount_paid} descending, then {@code id} ascending.
     *
     * <p><strong>The id tie-break uses PostgreSQL's UNSIGNED uuid order</strong>
     * ({@link IndividualBalanceService#compareCanonical}), never
     * {@link UUID#compareTo}, which compares signed longs and disagrees with
     * PostgreSQL for about half of all pairs — the trap backend/README.md §16.5
     * note 2 records. "Ties by id" means the database's order, so a future
     * {@code ORDER BY id} anywhere agrees with this.
     *
     * <p>Identifying the primary from {@code paid_by_*} is the one permitted read
     * of those columns: they exist to name the primary payer (ADR 0025 §3), and
     * the primary cannot be re-derived from the rows on a tie because request order
     * is not stored.
     */
    static List<SplitExpensePayer> orderForResponse(
            List<SplitExpensePayer> rows, UUID primaryUserId, UUID primaryContactId) {
        Comparator<SplitExpensePayer> order = Comparator
                .comparing((SplitExpensePayer row) -> !isPrimary(row, primaryUserId, primaryContactId))
                .thenComparing(SplitExpensePayer::getAmountPaid, Comparator.reverseOrder())
                .thenComparing(SplitExpensePayer::getId, IndividualBalanceService::compareCanonical);
        List<SplitExpensePayer> ordered = new ArrayList<>(rows);
        ordered.sort(order);
        return ordered;
    }

    private static boolean isPrimary(SplitExpensePayer row, UUID primaryUserId, UUID primaryContactId) {
        return primaryUserId != null
                ? primaryUserId.equals(row.getPayerUserId())
                : primaryContactId != null && primaryContactId.equals(row.getPayerContactId());
    }

    /**
     * A split expense with <strong>no payer row</strong>: one written by
     * pre-ADR-0025 code after V16 ran (V16's CONTRACT item 1 names the hazard).
     * Its single payer paid the whole amount, which is exactly what V16's backfill
     * would have written and how the old ledger credited them, so the response
     * stays truthful and {@code payers[]} is never empty. Logged, because it means
     * V16 and the backend were not deployed together. Ids only, never an amount
     * (constitution §23).
     */
    private static SplitExpensePayer legacyPayerRow(SplitExpense split) {
        log.warn("Split expense {} has no split_expense_payers row; answering from paid_by_* "
                + "(V16 and the backend were not deployed together)", split.getId());
        return SplitExpensePayer.builder()
                .id(split.getId())
                .splitExpenseId(split.getId())
                .payerUserId(split.getPaidByUserId())
                .payerContactId(split.getPaidByContactId())
                .amountPaid(split.getAmount())
                .revision(split.getRevision())
                .build();
    }

    // An unresolvable payer name falls back to "" rather than throwing. It is
    // unreachable by construction — every payer foreign key is NO ACTION and
    // nothing is ever hard-deleted, so no referenced row can vanish — and the
    // same disposition GroupResponseAssembler records for member names.
    private static List<SplitPayerSummary> toPayerSummaries(
            List<SplitExpensePayer> ordered,
            Map<UUID, String> namesByUserId,
            Map<UUID, String> namesByContactId) {
        List<SplitPayerSummary> summaries = new ArrayList<>(ordered.size());
        for (SplitExpensePayer payer : ordered) {
            String name = payer.getPayerUserId() != null
                    ? namesByUserId.getOrDefault(payer.getPayerUserId(), "")
                    : namesByContactId.getOrDefault(payer.getPayerContactId(), "");
            summaries.add(new SplitPayerSummary(
                    payer.getPayerUserId(), payer.getPayerContactId(), name, payer.getAmountPaid()));
        }
        return List.copyOf(summaries);
    }

    /**
     * The single-split case — {@code POST /split-expenses} and
     * {@code GET /split-expenses/{id}}.
     */
    public SplitExpenseResponse assembleOne(SplitExpense split) {
        return assemble(List.of(split)).get(0);
    }

    private static SplitExpenseResponse toResponse(
            SplitExpense split,
            List<SplitParticipantSummary> participants,
            List<SplitPayerSummary> payers,
            List<SplitCounterpartSummary> counterparts,
            Map<UUID, String> namesByUserId) {
        // The deprecated paidByName is payers[0]'s name: orderForResponse puts the
        // primary payer first, and the primary payer IS what paid_by_* holds
        // (ADR 0025 §3, §5.2). payers is never empty — see legacyPayerRow.
        String paidByName = payers.get(0).name();

        return new SplitExpenseResponse(
                split.getId(),
                split.getTitle(),
                split.getCategoryId(),
                split.getCategoryName(),
                split.getParentCategoryName(),
                split.getCategoryIconName(),
                split.getCategoryGlyph(),
                split.getCategoryTone(),
                split.getSplitDate(),
                split.getAmount(),
                // The contract's lowercase literal, never the enum constant name.
                split.getSplitMode().getValue(),
                split.getGroupId(),
                // Deprecated (ADR 0026 §5.2): the primary counterpart's pair.
                split.getIndividualBalanceId(),
                counterparts,
                split.getSplitMethod(),
                split.getPaidByUserId(),
                split.getPaidByContactId(),
                paidByName,
                payers,
                split.isAddedToPersonalExpenses(),
                split.getPersonalTransactionId(),
                participants,
                split.getCreatedAt(),
                split.getUpdatedAt(),
                split.getCreatedByUserId(),
                namesByUserId.getOrDefault(split.getCreatedByUserId(), ""),
                split.getDeletedAt(),
                split.getDeletedByUserId(),
                split.getDeletedByUserId() == null
                        ? null : namesByUserId.getOrDefault(split.getDeletedByUserId(), ""));
    }

    private static Set<UUID> payerUserIds(Map<UUID, List<SplitExpensePayer>> payersBySplitId) {
        Set<UUID> ids = new HashSet<>();
        for (List<SplitExpensePayer> payers : payersBySplitId.values()) {
            for (SplitExpensePayer payer : payers) {
                if (payer.getPayerUserId() != null) {
                    ids.add(payer.getPayerUserId());
                }
            }
        }
        return ids;
    }

    private static Set<UUID> payerContactIds(Map<UUID, List<SplitExpensePayer>> payersBySplitId) {
        Set<UUID> ids = new HashSet<>();
        for (List<SplitExpensePayer> payers : payersBySplitId.values()) {
            for (SplitExpensePayer payer : payers) {
                if (payer.getPayerContactId() != null) {
                    ids.add(payer.getPayerContactId());
                }
            }
        }
        return ids;
    }

    private static Map<UUID, String> resolveNames(
            Set<UUID> ids, Function<Collection<UUID>, List<MemberNameRow>> lookup) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return lookup.apply(ids).stream()
                .collect(Collectors.toMap(MemberNameRow::id, MemberNameRow::name, (first, second) -> first));
    }
}
