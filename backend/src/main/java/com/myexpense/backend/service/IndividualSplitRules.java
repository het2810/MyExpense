package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.myexpense.backend.dto.request.CreateSplitExpenseRequest;
import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.IndividualBalance;
import com.myexpense.backend.exception.ContactNotFoundException;
import com.myexpense.backend.exception.SplitRuleViolationException;
import com.myexpense.backend.service.SplitExpenseService.Identity;
import com.myexpense.backend.service.SplitExpenseService.PayerEntry;

/**
 * The individual-mode rules of {@code POST /split-expenses} for one <em>or
 * more</em> counterparts (docs/decisions/0026-multi-contact-individual-splits.md
 * §4, §5.1): the counterpart form, the counterpart checks, normalisation onto the
 * creator or one counterpart, the per-counterpart net, the zero-sum assertion and
 * the per-pair signed delta.
 *
 * <p>Extracted from {@code SplitExpenseService} as ADR 0026's Backend follow-up
 * item 5 asks, so that service does not grow further past constitution §26's
 * guideline. Everything here is a <strong>pure function</strong>: no repository,
 * no state, so the ledger arithmetic can be pinned by unit tests without a
 * database. The service keeps the orchestration and every write.
 *
 * <h2>The ledger rule (ADR 0026 §0, §4.3)</h2>
 *
 * <p>All debts route through the creator. For every counterpart {@code c},
 * {@code net_c = paid_c − share_c} (positive = the creator owes {@code c}), and
 * the creator↔{@code c} pair row moves by {@code −net_c} when the creator is its
 * left side and by {@code +net_c} when {@code c} is. With one counterpart this is
 * exactly ADR 0025's {@code paid(left) − share(left)} (ADR 0026 §4.3's proof), so
 * a one-contact split's ledger result is unchanged.
 *
 * <p>Every failure is a {@link SplitRuleViolationException} ({@code 400}) or
 * {@code 404 CONTACT_NOT_FOUND}, and every one is decided before the first write.
 * The two {@link IllegalStateException}s are programming-error guards.
 */
final class IndividualSplitRules {

    private IndividualSplitRules() {
    }

    /** One selected contact and the identity its participants and payers normalise onto. */
    record Counterpart(Contact contact, Identity identity) {
    }

    // =====================================================================
    // Counterpart form (ADR 0026 §5.1 C1-C4, C6 as sent)
    // =====================================================================

    /** C1 and C2 — individual mode needs exactly one counterpart form. */
    static void requireExactlyOneCounterpartForm(CreateSplitExpenseRequest request) {
        boolean single = request.individualCounterpartContactId() != null;
        boolean multiple = request.individualCounterpartContactIds() != null;
        if (single && multiple) {
            throw SplitRuleViolationException.counterpartFormsAreMutuallyExclusive();
        }
        if (!single && !multiple) {
            throw SplitRuleViolationException.counterpartContactRequiredForIndividualMode();
        }
    }

    /** C3 then C4 — group mode carries neither counterpart form. */
    static void requireNoCounterpartForGroupMode(CreateSplitExpenseRequest request) {
        if (request.individualCounterpartContactId() != null) {
            throw SplitRuleViolationException.counterpartContactNotAllowedForGroupMode();
        }
        if (request.individualCounterpartContactIds() != null) {
            throw SplitRuleViolationException.counterpartContactsNotAllowedForGroupMode();
        }
    }

    /**
     * The counterpart contact ids in <strong>request order</strong>; the legacy
     * single field becomes a one-element list, so from here on there is one code
     * path. The same id twice is C6, decided here, before the owner-scoped load
     * (which would otherwise see fewer rows than ids and answer a wrong
     * {@code 404}).
     *
     * <p>Call only after {@link #requireExactlyOneCounterpartForm}.
     */
    static List<UUID> counterpartContactIds(CreateSplitExpenseRequest request) {
        List<UUID> ids = request.individualCounterpartContactIds() != null
                ? new ArrayList<>(request.individualCounterpartContactIds())
                : List.of(request.individualCounterpartContactId());
        if (new HashSet<>(ids).size() != ids.size()) {
            throw SplitRuleViolationException.duplicateCounterpart();
        }
        return Collections.unmodifiableList(new ArrayList<>(ids));
    }

    /**
     * C7: the owner-scoped load in request order. Any id that did not resolve
     * (unknown, or another account's) is one identical
     * {@code 404 CONTACT_NOT_FOUND}, whichever id it was.
     */
    static List<Contact> inRequestOrder(List<UUID> requestedIds, List<Contact> loaded) {
        Map<UUID, Contact> byId = new HashMap<>();
        for (Contact contact : loaded) {
            byId.put(contact.getId(), contact);
        }
        List<Contact> ordered = new ArrayList<>(requestedIds.size());
        for (UUID id : requestedIds) {
            Contact contact = byId.get(id);
            if (contact == null) {
                throw ContactNotFoundException.notFound();
            }
            ordered.add(contact);
        }
        return ordered;
    }

    /**
     * C8 for every contact, then C6's second form (two contacts linked to the
     * same registered user), in that order (ADR 0026 §4.6 steps 5-6).
     */
    static void requireValidCounterparts(UUID callerId, List<Contact> contacts) {
        for (Contact contact : contacts) {
            if (callerId.equals(contact.getLinkedUserId())) {
                throw SplitRuleViolationException.cannotSplitWithYourself();
            }
        }
        Set<UUID> linkedUserIds = new HashSet<>();
        for (Contact contact : contacts) {
            if (contact.getLinkedUserId() != null && !linkedUserIds.add(contact.getLinkedUserId())) {
                throw SplitRuleViolationException.duplicateCounterpart();
            }
        }
    }

    /**
     * ADR 0026 §4.1: a linked contact is its account, an unlinked one is itself —
     * today's counterpart rule, applied per contact.
     */
    static List<Counterpart> counterpartsOf(List<Contact> contacts) {
        List<Counterpart> counterparts = new ArrayList<>(contacts.size());
        for (Contact contact : contacts) {
            Identity identity = contact.getLinkedUserId() != null
                    ? Identity.ofUser(contact.getLinkedUserId())
                    : Identity.ofContact(contact.getId());
            counterparts.add(new Counterpart(contact, identity));
        }
        return List.copyOf(counterparts);
    }

    // =====================================================================
    // Normalisation (ADR 0026 §4.2)
    // =====================================================================

    /**
     * Maps a participant or payer identity, as the client spelled it, onto the
     * creator or exactly one counterpart:
     * <ol>
     *   <li>the creator → the creator;</li>
     *   <li>a counterpart's identity → that counterpart;</li>
     *   <li>the contact id of a <strong>selected, linked</strong> contact → that
     *       contact's account (the synonym today's code accepts);</li>
     *   <li>anything else → {@code 400 notAPartyToThePair}.</li>
     * </ol>
     * Only the selected contacts are synonyms. Another contact in the creator's
     * address book that links to the same user is not, exactly as before.
     */
    static Identity normalise(Identity raw, Identity creator, List<Counterpart> counterparts) {
        if (raw.equals(creator)) {
            return creator;
        }
        for (Counterpart counterpart : counterparts) {
            if (raw.equals(counterpart.identity())) {
                return counterpart.identity();
            }
        }
        if (raw.contactId() != null) {
            for (Counterpart counterpart : counterparts) {
                Contact contact = counterpart.contact();
                if (raw.contactId().equals(contact.getId()) && contact.getLinkedUserId() != null) {
                    return counterpart.identity();
                }
            }
        }
        throw SplitRuleViolationException.notAPartyToThePair();
    }

    /**
     * ADR 0028 §4.3 — normalisation for an <strong>edit</strong>, against the
     * split's fixed audience (derived from its link rows). Accepted:
     * <ol>
     *   <li>the creator's user id → the creator;</li>
     *   <li>a counterpart exactly as {@code counterparts[]} returns it → that
     *       counterpart;</li>
     *   <li>one of the <strong>creator's own</strong> contacts whose
     *       {@code linked_user_id} is a user counterpart → that counterpart (the
     *       synonym rule, generalised because the originally selected contact id
     *       is not stored);</li>
     *   <li>anything else → {@code 400 notAPartyToThePair}.</li>
     * </ol>
     *
     * @param creatorContactLinks the creator's own contacts linked to a user
     *                            counterpart: contact id → linked user id
     */
    static Identity normaliseAgainstAudience(Identity raw, Identity creator, List<Identity> counterparts,
            Map<UUID, UUID> creatorContactLinks) {
        if (raw.equals(creator)) {
            return creator;
        }
        if (counterparts.contains(raw)) {
            return raw;
        }
        if (raw.contactId() != null) {
            UUID linkedUserId = creatorContactLinks.get(raw.contactId());
            if (linkedUserId != null && counterparts.contains(Identity.ofUser(linkedUserId))) {
                return Identity.ofUser(linkedUserId);
            }
        }
        throw SplitRuleViolationException.notAPartyToThePair();
    }

    // =====================================================================
    // Ledger arithmetic (ADR 0026 §4.3, §4.4)
    // =====================================================================

    /**
     * {@code paid − share} for one identity, from the <em>normalised</em> payers
     * and participants. Either term is zero when the identity is absent (a
     * counterpart who neither pays nor participates is legal).
     *
     * @param shares the participant amounts, index-aligned with
     *               {@code participants}
     */
    static BigDecimal netOf(
            Identity identity,
            List<PayerEntry> payers,
            List<Identity> participants,
            List<BigDecimal> shares) {
        BigDecimal paid = BigDecimal.ZERO;
        for (PayerEntry payer : payers) {
            if (payer.identity().equals(identity)) {
                paid = paid.add(payer.amount());
            }
        }
        BigDecimal share = BigDecimal.ZERO;
        for (int i = 0; i < participants.size(); i++) {
            if (participants.get(i).equals(identity)) {
                share = shares.get(i);
                break;
            }
        }
        return paid.subtract(share);
    }

    /**
     * ADR 0026 §4.4: {@code net_k + Σ net_c = 0}, checked in memory before the
     * first write. Unreachable when the payer and participant sums hold, so a
     * failure is a programming error ({@link IllegalStateException}, a logged
     * {@code 500}), not a user error. No amount goes into the message
     * (constitution §23).
     */
    static void requireZeroSum(BigDecimal creatorNet, List<BigDecimal> counterpartNets) {
        BigDecimal sum = creatorNet;
        for (BigDecimal net : counterpartNets) {
            sum = sum.add(net);
        }
        if (sum.compareTo(BigDecimal.ZERO) != 0) {
            throw new IllegalStateException(
                    "Individual split nets do not sum to zero across the creator and "
                            + counterpartNets.size() + " counterpart(s)");
        }
    }

    /**
     * <strong>The signed delta for one pair row</strong> (ADR 0026 §4.3):
     * {@code −net_c} when the creator is the row's left side, {@code +net_c} when
     * the counterpart is.
     *
     * <p>The stored {@code balance} is signed relative to the row's
     * {@code user_id}, its <em>left side</em> (ADR 0023 §1.4):
     * <ul>
     *   <li>a <strong>contact row</strong>'s {@code user_id} is always its owner,
     *       the creator;</li>
     *   <li>a <strong>canonical pair row</strong>'s {@code user_id} is the lesser
     *       uuid, <strong>read off the stored row</strong>. Never re-derived here:
     *       the canonical order is PostgreSQL's <em>unsigned</em> uuid order, which
     *       {@link UUID#compareTo} gets wrong
     *       ({@code IndividualBalanceService#compareCanonical} owns that).</li>
     * </ul>
     *
     * <p><strong>Not ADR 0025's {@code paid(left) − share(left)} with
     * left = creator</strong>: with 2+ counterparts that is the creator's
     * <em>total</em> net, which would be applied to every pair row. The two forms
     * agree only for one counterpart.
     *
     * @param net {@code net_c} from {@link #netOf}
     */
    static BigDecimal signedPairDelta(
            IndividualBalance row, UUID creatorId, Identity counterpart, BigDecimal net) {
        Identity creator = Identity.ofUser(creatorId);
        Identity leftSide = row.getCounterpartContactId() != null
                ? creator
                : Identity.ofUser(row.getUserId());
        if (leftSide.equals(creator)) {
            return net.negate();
        }
        if (leftSide.equals(counterpart)) {
            return net;
        }
        // Unreachable: the row was resolved from this counterpart's contact for
        // this creator, so its left side is one of the two.
        throw new IllegalStateException(
                "Pair row " + row.getId() + " does not belong to the creator and its counterpart");
    }
}
