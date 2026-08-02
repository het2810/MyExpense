package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.myexpense.backend.service.SplitExpenseService.Identity;

/**
 * ADR 0028 §9.4's effect clause {@code E(recipient, split, revision)} and its
 * removal form {@code E_del}, per recipient. Pure functions; the wording lives in
 * {@link ActivitySentences#groupEffect} and {@link ActivitySentences#pairEffect}.
 *
 * <ul>
 *   <li><strong>Group</strong> recipient: {@code n = net(recipient)}.</li>
 *   <li><strong>Individual counterpart</strong> recipient {@code c}:
 *       {@code e = +net(c)} (positive = the creator owes them).</li>
 *   <li><strong>Individual creator</strong>, exactly one counterpart:
 *       {@code e = −net(c)}. With 2+ counterparts: no clause.</li>
 * </ul>
 */
final class SplitEffectClauses {

    private SplitEffectClauses() {
    }

    /** One counterpart of an individual split, with its net in the revision being described. */
    record PairParty(UUID userId, String name, BigDecimal net) {
    }

    static Map<UUID, String> forGroup(Set<UUID> recipients, Map<Identity, BigDecimal> nets, boolean removed) {
        Map<UUID, String> clauses = new LinkedHashMap<>();
        for (UUID recipient : recipients) {
            clauses.put(recipient, ActivitySentences.groupEffect(
                    SplitLedgerMath.netOf(nets, Identity.ofUser(recipient)), removed));
        }
        return clauses;
    }

    static Map<UUID, String> forIndividual(Set<UUID> recipients, UUID creatorId, String creatorName,
            List<PairParty> counterparts, boolean removed) {
        Map<UUID, String> clauses = new LinkedHashMap<>();
        if (recipients.contains(creatorId)) {
            clauses.put(creatorId, counterparts.size() == 1
                    ? ActivitySentences.pairEffect(counterparts.get(0).name(), counterparts.get(0).net().negate(), removed)
                    : "");
        }
        for (PairParty counterpart : counterparts) {
            if (counterpart.userId() != null && !counterpart.userId().equals(creatorId)
                    && recipients.contains(counterpart.userId())) {
                clauses.put(counterpart.userId(),
                        ActivitySentences.pairEffect(creatorName, counterpart.net(), removed));
            }
        }
        return clauses;
    }
}
