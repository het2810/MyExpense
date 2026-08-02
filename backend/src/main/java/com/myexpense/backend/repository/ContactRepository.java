package com.myexpense.backend.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.Contact;

/**
 * Persistence only (constitution §9). Every query here is either a Spring Data
 * derived method or JPQL with <strong>bound</strong> parameters — no native SQL,
 * no string concatenation, nothing built from client input
 * (security-architecture.md §12).
 *
 * <p><strong>Every owner-scoped lookup takes {@code ownerUserId}.</strong> A
 * contact is one user's private address-book entry (data-model.md §4's note), so
 * "fetch by id" must mean "fetch by id <em>belonging to the caller</em>"; there
 * is deliberately no bare {@code findById} use in {@code ContactService}, or an
 * id guessed from another account would be readable (api-overview.md §6,
 * security-architecture.md §2).
 *
 * <p><strong>{@link #findMemberNamesByIdIn} is the one deliberate exception, and
 * it is not a hole.</strong> A contact invited into a group may be owned by
 * <em>any</em> member (V10's note on
 * {@code fk_group_members_invited_contact_id}), so resolving a group's member
 * names cannot be owner-scoped — api-overview.md §7.1 requires every member's
 * name in the response, and the ids it resolves come from {@code group_members}
 * rows of a group the caller's membership has already been verified against. It
 * returns names only, never a contact's phone, email or
 * {@code linkedUserId}.
 *
 * <p>No {@code deleted_at} clause anywhere: {@code contacts} has no soft delete,
 * and §6 has no DELETE endpoint at all.
 */
public interface ContactRepository extends JpaRepository<Contact, UUID> {

    /**
     * {@code GET /api/v1/contacts} (§6.1) — the caller's whole address book,
     * unpaginated per the contract.
     *
     * <p>Ordered by name then id: the contract specifies no order, and
     * <em>some</em> total order is needed for a stable list (two contacts
     * legitimately share a name — V9 declines any uniqueness on this table — so
     * {@code id} is the tie-break that guarantees totality). Alphabetical is
     * what an address book wants, and it matches the frontend's client-side
     * contact search over the already-fetched list (ADR 0006).
     *
     * <p>Served by {@code uq_contacts_owner_user_id_id}, whose btree leads with
     * {@code owner_user_id} — which is why V9 creates no separate
     * {@code idx_contacts_owner_user_id}.
     */
    List<Contact> findByOwnerUserIdOrderByNameAscIdAsc(UUID ownerUserId);

    /**
     * Owner-scoped single fetch. An id belonging to another account and an
     * unknown id both resolve to empty, i.e. one identical
     * {@code 404 CONTACT_NOT_FOUND} (§6.3) — never a {@code 403}, which would
     * confirm the id is real to a non-owner.
     */
    Optional<Contact> findByIdAndOwnerUserId(UUID id, UUID ownerUserId);

    /**
     * Resolves a whole {@code memberContactIds} array in <strong>one</strong>
     * query, owner-scoped (api-overview.md §7.2).
     *
     * <p>V9 contract item 6 names the alternative as a specific trap: "the
     * invite-send path must not re-read {@code contacts} row by row when a group
     * is created with several {@code memberContactIds}". {@code GroupService}
     * compares this result's size against the request's distinct id count and
     * answers {@code 404 CONTACT_NOT_FOUND} if any id failed to resolve — which
     * covers "does not exist" and "is not mine" identically, without a second
     * query and without revealing which of the two it was.
     */
    List<Contact> findByOwnerUserIdAndIdIn(UUID ownerUserId, Collection<UUID> ids);

    /**
     * ADR 0028 §4.3 rule 3: every one of the owner's own contacts linked to one
     * of these users — the synonyms an individual-split edit accepts for a
     * registered counterpart (the originally selected contact id is not stored).
     * Owner-scoped, one query.
     */
    List<Contact> findByOwnerUserIdAndLinkedUserIdIn(UUID ownerUserId, Collection<UUID> linkedUserIds);

    /**
     * Display names for a batch of contact ids — <strong>not</strong>
     * owner-scoped, deliberately; see the interface Javadoc.
     *
     * <p>A JPQL constructor expression rather than a {@code List<Object[]>}, and
     * one query for a whole page of groups rather than one per member
     * (constitution §10, V10 contract item 3).
     */
    @Query("select new com.myexpense.backend.repository.MemberNameRow(c.id, c.name) "
            + "from Contact c where c.id in :ids")
    List<MemberNameRow> findMemberNamesByIdIn(@Param("ids") Collection<UUID> ids);
}
