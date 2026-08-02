package com.myexpense.backend.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.User;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    /**
     * Backs {@code 409 PHONE_ALREADY_EXISTS} on {@code PATCH /users/me}
     * (api-overview.md §2.2) — "is this phone number already claimed by a
     * <em>different</em> account", so re-submitting the caller's own current
     * number is never a conflict. A derived query: parameters are bound, never
     * concatenated (security-architecture.md §12).
     *
     * <p>This is a friendly pre-check, not the guarantee — the partial unique
     * index {@code uq_users_phone} is what actually enforces uniqueness, and
     * the service also translates that constraint violation into the same 409
     * for the case where two requests race between this check and the insert.
     */
    boolean existsByPhoneAndIdNot(String phone, UUID id);

    /**
     * The <strong>phone half of contact auto-link</strong>
     * (api-overview.md §6.2, ADR 0015 §2): {@code contacts.phone} matches
     * against {@code users.phone}, one of two independent lookups with no
     * shape-inference heuristic anywhere.
     *
     * <p>A match sets {@code contacts.linked_user_id} and <em>suppresses</em> the
     * SMS invite; no match is exactly the case an invite exists for. Served by
     * {@code uq_users_phone} (partial unique, {@code WHERE phone IS NOT NULL}),
     * so a {@code null} probe could never match a row even if one were passed —
     * {@code ContactService} never passes one.
     *
     * <p>The stored values on both sides are strict E.164, enforced at the DTO
     * layer on each (§2.2 for {@code users.phone},
     * {@code CreateContactRequest} for {@code contacts.phone}). That is what
     * makes a string equality the right comparison here, and the same reason the
     * invite cooldown can key on the raw string.
     */
    Optional<User> findByPhone(String phone);

    /**
     * Display names for a batch of registered group members — the
     * {@code firstName + lastName} half of api-overview.md §7.1's
     * "{@code members[].name} is resolved server-side".
     *
     * <p>A JPQL constructor expression into {@link MemberNameRow} rather than a
     * {@code List<Object[]>}, and <strong>one query for a whole page of groups
     * rather than one per member</strong> (constitution §10, V10 contract
     * item 3).
     *
     * <p>Returns names only — never an email, phone, premium flag or any other
     * profile field. A group member is entitled to see who else is in the group
     * (§7.1 requires it), not to read their account.
     *
     * <p><strong>No name snapshot is stored on {@code group_members}</strong>, so
     * this read is the membership list's only source of names and a rename is
     * reflected immediately — deliberately unlike
     * {@code split_expense_participants.name} (V11), where the name is frozen
     * because a historical record must not change. A membership list is current
     * state (V10 contract item 3).
     */
    @Query("select new com.myexpense.backend.repository.MemberNameRow("
            + "u.id, concat(u.firstName, ' ', u.lastName)) "
            + "from User u where u.id in :ids")
    List<MemberNameRow> findMemberNamesByIdIn(@Param("ids") Collection<UUID> ids);
}
