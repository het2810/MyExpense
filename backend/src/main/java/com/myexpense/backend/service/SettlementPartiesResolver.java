package com.myexpense.backend.service;

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

import com.myexpense.backend.dto.response.SettlementPartySummary;
import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.entity.Settlement;
import com.myexpense.backend.repository.ContactRepository;
import com.myexpense.backend.repository.IndividualBalanceRepository;
import com.myexpense.backend.repository.MemberNameRow;
import com.myexpense.backend.repository.UserRepository;

/**
 * Payer and payee of a batch of settlements (ADR 0028 §7.4) — <strong>the one
 * implementation</strong>, used by {@code POST /splits/settle} (one row) and by
 * both feeds (a page of rows). At most three queries for any batch: the pair rows
 * of individual settlements, then one name lookup per source table.
 *
 * <p>From {@code settlements.initiator_is_payer}: {@code true} → the initiator
 * paid; {@code false} → the initiator received. The other party is
 * {@code counterpart_user_id}/{@code counterpart_contact_id} (group) or the other
 * party of the pair row (individual). A legacy row ({@code NULL}) has neither
 * payer nor payee, and the client renders legacy copy.
 */
@Component
public class SettlementPartiesResolver {

    /** Payer and payee of one settlement; both {@code null} on a legacy row. */
    public record Parties(SettlementPartySummary payer, SettlementPartySummary payee) {
        static final Parties LEGACY = new Parties(null, null);
    }

    private final IndividualBalanceRepository balanceRepository;
    private final UserRepository userRepository;
    private final ContactRepository contactRepository;

    public SettlementPartiesResolver(
            IndividualBalanceRepository balanceRepository,
            UserRepository userRepository,
            ContactRepository contactRepository) {
        this.balanceRepository = balanceRepository;
        this.userRepository = userRepository;
        this.contactRepository = contactRepository;
    }

    /** Parties per settlement id. */
    public Map<UUID, Parties> resolve(List<Settlement> settlements) {
        Set<UUID> pairIds = new HashSet<>();
        for (Settlement settlement : settlements) {
            if (settlement.getInitiatorIsPayer() != null && settlement.getIndividualBalanceId() != null) {
                pairIds.add(settlement.getIndividualBalanceId());
            }
        }
        Map<UUID, IndividualBalance> pairs = new HashMap<>();
        if (!pairIds.isEmpty()) {
            for (IndividualBalance pair : balanceRepository.findAllById(pairIds)) {
                pairs.put(pair.getId(), pair);
            }
        }

        Map<UUID, UUID[]> otherBySettlement = new HashMap<>();
        Set<UUID> userIds = new HashSet<>();
        Set<UUID> contactIds = new HashSet<>();
        for (Settlement settlement : settlements) {
            if (settlement.getInitiatorIsPayer() == null) {
                continue;
            }
            UUID otherUserId;
            UUID otherContactId;
            if (settlement.getGroupId() != null) {
                otherUserId = settlement.getCounterpartUserId();
                otherContactId = settlement.getCounterpartContactId();
            } else {
                IndividualBalance pair = pairs.get(settlement.getIndividualBalanceId());
                if (pair == null) {
                    continue;
                }
                otherUserId = IndividualBalanceService.counterpartUserIdOf(pair, settlement.getInitiatedByUserId());
                otherContactId = pair.getCounterpartContactId();
            }
            otherBySettlement.put(settlement.getId(), new UUID[] {otherUserId, otherContactId});
            userIds.add(settlement.getInitiatedByUserId());
            if (otherUserId != null) {
                userIds.add(otherUserId);
            } else if (otherContactId != null) {
                contactIds.add(otherContactId);
            }
        }
        Map<UUID, String> userNames = names(userIds, userRepository::findMemberNamesByIdIn);
        Map<UUID, String> contactNames = names(contactIds, contactRepository::findMemberNamesByIdIn);

        Map<UUID, Parties> result = new HashMap<>();
        for (Settlement settlement : settlements) {
            UUID[] other = otherBySettlement.get(settlement.getId());
            if (other == null) {
                result.put(settlement.getId(), Parties.LEGACY);
                continue;
            }
            SettlementPartySummary initiator = new SettlementPartySummary(settlement.getInitiatedByUserId(), null,
                    userNames.getOrDefault(settlement.getInitiatedByUserId(), ""));
            SettlementPartySummary counterpart = other[0] != null
                    ? new SettlementPartySummary(other[0], null, userNames.getOrDefault(other[0], ""))
                    : new SettlementPartySummary(null, other[1], contactNames.getOrDefault(other[1], ""));
            result.put(settlement.getId(), Boolean.TRUE.equals(settlement.getInitiatorIsPayer())
                    ? new Parties(initiator, counterpart)
                    : new Parties(counterpart, initiator));
        }
        return result;
    }

    private static Map<UUID, String> names(Set<UUID> ids, Function<Collection<UUID>, List<MemberNameRow>> lookup) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return lookup.apply(ids).stream()
                .collect(Collectors.toMap(MemberNameRow::id, MemberNameRow::name, (first, second) -> first));
    }
}
