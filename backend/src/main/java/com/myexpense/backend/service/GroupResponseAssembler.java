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

import org.springframework.stereotype.Service;

import com.myexpense.backend.dto.response.GroupMemberSummary;
import com.myexpense.backend.dto.response.GroupResponse;
import com.myexpense.backend.entity.ExpenseGroup;
import com.myexpense.backend.entity.GroupMember;
import com.myexpense.backend.entity.GroupMemberBalance;
import com.myexpense.backend.repository.ContactRepository;
import com.myexpense.backend.repository.GroupMemberBalanceRepository;
import com.myexpense.backend.repository.MemberNameRow;
import com.myexpense.backend.repository.UserRepository;

/**
 * Composes {@code GroupResponse} (api-overview.md §7.1) from rows —
 * <strong>without an N+1, for any number of groups</strong>.
 *
 * <p>Extracted from {@code GroupService} because three endpoints need the
 * identical composition ({@code GET /groups}, {@code POST /groups},
 * {@code GET /groups/{id}}) and because two of §7.1's fields are not columns:
 * {@code members[].name} is a cross-table resolution and {@code yourBalance}
 * comes from a different table, per viewer. Keeping it here means the no-N+1
 * rule has one home instead of three (constitution §25, and V10 contract item 3
 * which states the rule as "resolve every member's name for a page of groups in
 * ONE query per source table, not one per member").
 *
 * <p><strong>The query budget is fixed at three, whatever the group count:</strong>
 * one for the registered members' names, one for the contact members' names, one
 * for the viewer's balance rows. Each is skipped entirely when its id set is
 * empty. The group rows and member rows are passed in, already fetched by the
 * caller in one query each.
 *
 * <p><strong>No authorization happens here.</strong> This class composes what it
 * is given; the caller has already proved the viewer's membership of every group
 * it passes in. That is deliberate — a composer that also decided access would
 * be a second place to get the membership rule right.
 */
@Service
public class GroupResponseAssembler {

    /**
     * {@code numeric(12,2)}, so a group with no balance row still renders
     * {@code 0.00} rather than {@code 0} — one wire shape for the field
     * regardless of which branch produced it.
     */
    private static final BigDecimal ZERO_BALANCE = BigDecimal.ZERO.setScale(2);

    private final UserRepository userRepository;
    private final ContactRepository contactRepository;
    private final GroupMemberBalanceRepository balanceRepository;

    public GroupResponseAssembler(
            UserRepository userRepository,
            ContactRepository contactRepository,
            GroupMemberBalanceRepository balanceRepository) {
        this.userRepository = userRepository;
        this.contactRepository = contactRepository;
        this.balanceRepository = balanceRepository;
    }

    /**
     * One response per group, in the order the groups were given.
     *
     * @param groups  the groups to render, already fetched
     * @param members every member row of every one of those groups, already
     *                fetched in one query and ordered
     * @param viewerId the authenticated principal — whose own balance row
     *                 becomes {@code yourBalance}, which is what makes the
     *                 number viewer-relative as §7.1 requires
     */
    public List<GroupResponse> assemble(
            List<ExpenseGroup> groups, List<GroupMember> members, UUID viewerId) {
        if (groups.isEmpty()) {
            return List.of();
        }

        List<UUID> groupIds = groups.stream().map(ExpenseGroup::getId).toList();
        Map<UUID, String> namesByUserId = resolveUserNames(members);
        Map<UUID, String> namesByContactId = resolveContactNames(members);
        // ADR 0028 §8.1: every member's balance in ONE query for the whole page;
        // yourBalance is the viewer's own entry of the same read.
        Map<String, BigDecimal> balancesByMemberKey = new HashMap<>();
        Map<UUID, BigDecimal> balancesByGroupId = new HashMap<>();
        for (GroupMemberBalance balance : balanceRepository.findByGroupIdIn(groupIds)) {
            balancesByMemberKey.put(
                    memberKey(balance.getGroupId(), balance.getUserId(), balance.getInvitedContactId()),
                    balance.getBalance());
            if (viewerId.equals(balance.getUserId())) {
                balancesByGroupId.put(balance.getGroupId(), balance.getBalance());
            }
        }

        Map<UUID, List<GroupMemberSummary>> membersByGroupId = new HashMap<>();
        for (GroupMember member : members) {
            BigDecimal balance = balancesByMemberKey.getOrDefault(
                    memberKey(member.getGroupId(), member.getUserId(), member.getInvitedContactId()), ZERO_BALANCE);
            membersByGroupId
                    .computeIfAbsent(member.getGroupId(), id -> new ArrayList<>())
                    .add(toSummary(member, namesByUserId, namesByContactId, balance));
        }

        List<GroupResponse> responses = new ArrayList<>(groups.size());
        for (ExpenseGroup group : groups) {
            // copyOf so the record handed to Jackson holds no reference to the
            // mutable accumulator above — the same sharp edge CategoryService's
            // tree assembly avoids.
            List<GroupMemberSummary> groupMembers =
                    List.copyOf(membersByGroupId.getOrDefault(group.getId(), List.of()));
            responses.add(new GroupResponse(
                    group.getId(),
                    group.getName(),
                    group.getCreatedByUserId(),
                    group.getLastActivity(),
                    groupMembers,
                    balancesByGroupId.getOrDefault(group.getId(), ZERO_BALANCE),
                    group.getCreatedAt(),
                    group.getUpdatedAt()));
        }
        return List.copyOf(responses);
    }

    /** The single-group case — {@code POST /groups} and {@code GET /groups/{id}}. */
    public GroupResponse assembleOne(ExpenseGroup group, List<GroupMember> members, UUID viewerId) {
        return assemble(List.of(group), members, viewerId).get(0);
    }

    /**
     * The display name of one member, for {@code POST /groups/{id}/members}'
     * {@code 201} body (§7.4).
     *
     * <p>Costs <strong>zero</strong> queries on the contact branch, because the
     * caller already resolved that contact to check its ownership, and at most
     * one on the registered branch. It is a separate method rather than a reuse
     * of {@link #assemble} because that path has no group to render and no
     * balance to read.
     *
     * @param contactName the already-known contact name, used when the member is
     *                    a contact placeholder; ignored otherwise
     */
    public String resolveMemberName(GroupMember member, String contactName) {
        if (member.getUserId() == null) {
            return contactName;
        }
        return userRepository.findMemberNamesByIdIn(List.of(member.getUserId())).stream()
                .findFirst()
                .map(MemberNameRow::name)
                .orElse("");
    }

    private Map<UUID, String> resolveUserNames(List<GroupMember> members) {
        Set<UUID> userIds = new HashSet<>();
        for (GroupMember member : members) {
            if (member.getUserId() != null) {
                userIds.add(member.getUserId());
            }
        }
        return toNameMap(userIds, userRepository::findMemberNamesByIdIn);
    }

    private Map<UUID, String> resolveContactNames(List<GroupMember> members) {
        Set<UUID> contactIds = new HashSet<>();
        for (GroupMember member : members) {
            if (member.getInvitedContactId() != null) {
                contactIds.add(member.getInvitedContactId());
            }
        }
        // NOT owner-scoped, deliberately: a contact invited into a group may be
        // owned by any member (V10's note on
        // fk_group_members_invited_contact_id), and §7.1 requires every member's
        // name. The ids come from group_members rows of a group whose membership
        // the caller has already been verified against, and only names are read.
        return toNameMap(contactIds, contactRepository::findMemberNamesByIdIn);
    }

    private static Map<UUID, String> toNameMap(
            Set<UUID> ids, Function<Collection<UUID>, List<MemberNameRow>> lookup) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return lookup.apply(ids).stream()
                // A duplicate id cannot occur — the input is a Set and both
                // queries key on a primary key — so the merge function is
                // unreachable rather than a policy.
                .collect(Collectors.toMap(MemberNameRow::id, MemberNameRow::name, (first, second) -> first));
    }

    /** One member of one group, whichever of the two member keys it has. */
    private static String memberKey(UUID groupId, UUID userId, UUID invitedContactId) {
        return groupId + (userId != null ? "|u:" + userId : "|c:" + invitedContactId);
    }

    /**
     * {@code { userId, invitedContactId, name, role }} — both id keys always
     * present, exactly one of them non-null.
     *
     * <p>An unresolvable name falls back to {@code ""} rather than throwing. It
     * is unreachable by construction: {@code fk_group_members_user_id} and
     * {@code fk_group_members_invited_contact_id} guarantee the referenced row
     * exists, and both are {@code NO ACTION}, so neither target can be deleted
     * while a membership references it. Recorded here so the fallback reads as a
     * known property of an impossible state rather than as an accepted gap —
     * the same disposition CategoryService's tree assembly takes.
     */
    private static GroupMemberSummary toSummary(GroupMember member, Map<UUID, String> namesByUserId,
            Map<UUID, String> namesByContactId, BigDecimal balance) {
        String name = member.getUserId() != null
                ? namesByUserId.getOrDefault(member.getUserId(), "")
                : namesByContactId.getOrDefault(member.getInvitedContactId(), "");
        return new GroupMemberSummary(
                member.getUserId(), member.getInvitedContactId(), name, member.getRole(), balance);
    }
}
