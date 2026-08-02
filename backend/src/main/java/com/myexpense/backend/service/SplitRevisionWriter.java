package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Component;

import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.SplitExpenseParticipant;
import com.myexpense.backend.entity.SplitExpensePayer;
import com.myexpense.backend.repository.ContactRepository;
import com.myexpense.backend.repository.MemberNameRow;
import com.myexpense.backend.repository.SplitExpenseParticipantRepository;
import com.myexpense.backend.repository.SplitExpensePayerRepository;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.service.SplitExpenseService.Identity;
import com.myexpense.backend.service.SplitExpenseService.PayerEntry;

/**
 * Writes one <strong>revision</strong> of a split expense's child rows
 * (participants, then payers) and resolves the display names they need —
 * extracted from {@code SplitExpenseService} by ADR 0028 §12 so the create path
 * (revision 1) and the edit path (revision {@code r + 1}) share one
 * implementation (constitution §17, §25).
 *
 * <p>Both child tables are insert-only (ADR 0024 §1, ADR 0025 §2.5, ADR 0028 §3):
 * an edit never updates or deletes an old row, it inserts the next revision. The
 * {@code revision} is always set explicitly (V19 CONTRACT item 2).
 *
 * <p>Ids here are server-generated ({@code UUID.randomUUID()}), never client
 * supplied, so {@code saveAllAndFlush} cannot merge onto a foreign row.
 */
@Component
public class SplitRevisionWriter {

    private final SplitExpenseParticipantRepository participantRepository;
    private final SplitExpensePayerRepository payerRepository;
    private final UserRepository userRepository;
    private final ContactRepository contactRepository;

    public SplitRevisionWriter(
            SplitExpenseParticipantRepository participantRepository,
            SplitExpensePayerRepository payerRepository,
            UserRepository userRepository,
            ContactRepository contactRepository) {
        this.participantRepository = participantRepository;
        this.payerRepository = payerRepository;
        this.userRepository = userRepository;
        this.contactRepository = contactRepository;
    }

    /** One revision's participant rows, flushed so the set-based ledger statements can read them. */
    List<SplitExpenseParticipant> persistParticipants(
            UUID splitExpenseId, int revision, List<BigDecimal> shares, List<Identity> identities, Names names) {
        List<SplitExpenseParticipant> rows = new ArrayList<>(shares.size());
        for (int i = 0; i < shares.size(); i++) {
            Identity identity = identities.get(i);
            rows.add(SplitExpenseParticipant.builder()
                    .id(UUID.randomUUID())
                    .splitExpenseId(splitExpenseId)
                    .participantUserId(identity.userId())
                    .participantContactId(identity.contactId())
                    // Server-resolved and frozen (V11 contract item 5). Never a
                    // request field.
                    .name(names.requireName(identity))
                    .amount(shares.get(i))
                    .revision(revision)
                    .build());
        }
        return participantRepository.saveAllAndFlush(rows);
    }

    /**
     * ADR 0025 §4.3 step 9: one {@code split_expense_payers} row per payer,
     * flushed so the group payer-credit statements can read them in this
     * transaction. {@code created_at}/{@code updated_at} are set by the entity's
     * timestamps (V16 CONTRACT item 2).
     */
    List<SplitExpensePayer> persistPayers(UUID splitExpenseId, int revision, List<PayerEntry> payers) {
        List<SplitExpensePayer> rows = new ArrayList<>(payers.size());
        for (PayerEntry payer : payers) {
            rows.add(SplitExpensePayer.builder()
                    .id(UUID.randomUUID())
                    .splitExpenseId(splitExpenseId)
                    .payerUserId(payer.identity().userId())
                    .payerContactId(payer.identity().contactId())
                    .amountPaid(payer.amount())
                    .revision(revision)
                    .build());
        }
        return payerRepository.saveAllAndFlush(rows);
    }

    /**
     * One batch lookup per source table for every identity involved, skipped when
     * its id set is empty (constitution §10).
     *
     * @param knownContacts already-resolved contacts whose names are reused without
     *                      a second read
     */
    Names resolveNames(Collection<Identity> identities, List<Contact> knownContacts) {
        Set<UUID> userIds = new HashSet<>();
        Set<UUID> contactIds = new HashSet<>();
        for (Identity identity : identities) {
            if (identity.userId() != null) {
                userIds.add(identity.userId());
            } else {
                contactIds.add(identity.contactId());
            }
        }
        for (Contact known : knownContacts) {
            contactIds.remove(known.getId());
        }

        Map<UUID, String> byUserId = lookupNames(userIds, userRepository::findMemberNamesByIdIn);
        Map<UUID, String> byContactId =
                new HashMap<>(lookupNames(contactIds, contactRepository::findMemberNamesByIdIn));
        for (Contact known : knownContacts) {
            byContactId.put(known.getId(), known.getName());
        }
        return new Names(byUserId, Map.copyOf(byContactId));
    }

    private static Map<UUID, String> lookupNames(
            Set<UUID> ids, Function<Collection<UUID>, List<MemberNameRow>> lookup) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return lookup.apply(ids).stream()
                .collect(Collectors.toMap(MemberNameRow::id, MemberNameRow::name, (first, second) -> first));
    }

    /** The two name maps one write needs, with the frozen-snapshot guard attached. */
    record Names(Map<UUID, String> byUserId, Map<UUID, String> byContactId) {

        String nameOf(Identity identity) {
            return identity.userId() != null
                    ? byUserId.getOrDefault(identity.userId(), "")
                    : byContactId.getOrDefault(identity.contactId(), "");
        }

        String userName(UUID userId) {
            return byUserId.getOrDefault(userId, "");
        }

        /**
         * The same lookup, but refusing to write a blank into
         * {@code split_expense_participants.name}
         * ({@code chk_split_expense_participants_name_not_blank} would otherwise
         * surface as an unexplained {@code 500}). Unreachable by construction,
         * hence {@link IllegalStateException}.
         */
        String requireName(Identity identity) {
            String name = nameOf(identity);
            if (name == null || name.isBlank()) {
                throw new IllegalStateException(
                        "Could not resolve a display name for participant " + identity);
            }
            return name;
        }
    }
}
