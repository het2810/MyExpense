package com.myexpense.backend.service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.hibernate.exception.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.AddGroupMemberRequest;
import com.myexpense.backend.dto.request.CreateGroupRequest;
import com.myexpense.backend.dto.response.GroupMemberResponse;
import com.myexpense.backend.dto.response.GroupResponse;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.ExpenseGroup;
import com.myexpense.backend.entity.GroupMember;
import com.myexpense.backend.exception.AlreadyAMemberException;
import com.myexpense.backend.exception.ContactNotFoundException;
import com.myexpense.backend.exception.GroupNotFoundException;
import com.myexpense.backend.exception.IdConflictException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.ContactRepository;
import com.myexpense.backend.repository.EntityInserter;
import com.myexpense.backend.sync.ChangeLogEntityTypes;
import com.myexpense.backend.sync.ChangeSets;
import com.myexpense.backend.sync.ClientIds;
import com.myexpense.backend.sync.FieldChange;
import com.myexpense.backend.sync.IdempotentWriteExecutor;
import com.myexpense.backend.sync.WriteContext;
import com.myexpense.backend.sync.WriteResult;
import com.myexpense.backend.repository.GroupMemberRepository;
import com.myexpense.backend.repository.GroupRepository;
import com.myexpense.backend.repository.UserRepository;

/**
 * Business rules for the Groups domain (api-overview.md §7.1–§7.4) — Domain 6
 * sub-step 2.
 *
 * <h2>AUTHORIZATION IS MEMBERSHIP, NOT OWNERSHIP — the rule this class exists to
 * get right</h2>
 *
 * <p>Unlike {@code ContactService} and unlike every domain before this one, a row
 * here is legitimately shared by more than one user. <strong>"Does
 * {@code created_by_user_id} match the principal" is the WRONG test for every
 * endpoint in §7</strong> (V10's RULE 1, ADR 0014 §2 Consequence 1). The right
 * test is "does a {@code group_members} row exist for (groupId, principal)",
 * evaluated <em>per request</em>, never cached, and answered with {@code 404}
 * rather than {@code 403} so a non-member cannot learn whether the group exists
 * (security-architecture.md §2). The creator is just another {@code 'member'}
 * row and gets no extra capability — any member may add members (§7.4).
 *
 * <p>ADR 0014 §2 calls this "the single biggest IDOR risk in the backend" and
 * the build order calls it "the highest-severity class of bug this backend can
 * have", so the check is written exactly once per endpoint, as the first thing
 * that endpoint does, and {@link GroupRepository} deliberately offers no
 * owner-scoped lookup that could be mistaken for it.
 *
 * <h2>Which column a member row fills is the SERVER's decision</h2>
 *
 * <p>A member always arrives as a <em>contact of the caller's</em>. The service
 * then writes {@code user_id} if that contact's {@code linked_user_id} is
 * populated and {@code invited_contact_id} otherwise (§7.2/§7.4) — a client can
 * never name a {@code userId}, which is what stops a caller attaching an
 * arbitrary account to a group. The contact itself is re-resolved owner-scoped
 * on every write, because {@code fk_group_members_invited_contact_id} guarantees
 * the contact <strong>exists</strong>, not who owns it (V10's note at that
 * constraint: {@code group_members} has no owner column to pair a composite FK
 * with).
 *
 * <h2>Balances are written here, at zero</h2>
 *
 * <p>Every membership write is followed, in the same transaction, by
 * {@link GroupBalanceService}'s resolve-or-create upsert and its two
 * reconciliation checks. Why §6/§7 touch balances at all is argued on that
 * class; the mechanism (relative deltas, never row locks) is argued on
 * {@code GroupMemberBalanceRepository}.
 *
 * <h2>No Domain 7 fan-out from this class, and that is deliberate</h2>
 *
 * <p>{@code activities}/{@code notifications} exist as of {@code V13}, so the
 * fan-out is now <em>possible</em> here — and it is still not done, because
 * neither §7.2 nor §7.4 asks for it. data-model.md §5.1/§5.2 scope the required
 * fan-out to "the {@code split_expenses}/{@code settlements} write path", and
 * §7's own steps describe exactly three effects: the creator becomes a member,
 * each {@code memberContactIds} entry becomes a member row, and the invite
 * trigger fires. Writing a {@code group_created} activity would mean inventing
 * its sentence, icon, glyph and tone, plus deciding who it notifies, none of
 * which any backend contract states (constitution §15/§30). Flagged in
 * backend/README.md §15 for the System Architect, with the frontend's own
 * {@code group_created} entry (ADR 0008 §2.3) noted as the likely source of the
 * eventual rule.
 *
 * <h2>The transactional-rollback audit for this class</h2>
 *
 * <p>No {@code noRollbackFor} anywhere, checked per path rather than assumed
 * (backend/README.md §3's trap). Both write paths decide <strong>every</strong>
 * user-facing rejection — {@code 404 GROUP_NOT_FOUND},
 * {@code 404}/{@code 400 CONTACT_NOT_FOUND}, {@code 409 ALREADY_A_MEMBER} —
 * before the first write, and the two things that can throw afterwards are
 * exactly the two where a rollback is the point:
 * <ul>
 *   <li>a constraint violation on the member insert, which means the row never
 *       landed;</li>
 *   <li>{@link GroupBalanceService}'s consistency assertion, where committing
 *       the group anyway would be strictly worse than failing the request.</li>
 * </ul>
 * The invite send — the one irreversible side effect — is therefore fired
 * <strong>last</strong> on both paths, after the assertion, so no
 * application-level rejection can follow a real SMS. The residual commit-time
 * risk is recorded on {@link ContactInviteService}.
 */
@Service
public class GroupService {

    private static final Logger log = LoggerFactory.getLogger(GroupService.class);

    /**
     * The <strong>two</strong> uniqueness constraints that mean
     * {@code 409 ALREADY_A_MEMBER} (V10 contract item 1 — "the two load-bearing
     * names in this file"). Which one arrives is decided by the member's kind,
     * not by this code: adding a contact already in the group violates the
     * second, while adding a contact whose {@code linked_user_id} is already a
     * member violates the first, because §7.2/§7.4 write {@code user_id} instead
     * once a contact is linked. Both mean the same thing to a client.
     *
     * <p><strong>Full names, never the shared {@code uq_group_members_group_id_}
     * prefix</strong> — V10 says so explicitly, and the trap is real on a table
     * whose names are this close together. Verified pairwise before relying on a
     * {@code contains} match (the same matcher Domain 3 uses and the Project
     * Owner verified live against PostgreSQL): neither of these two strings is a
     * substring of the other, and neither is a substring of
     * {@code uq_group_member_balances_group_id_user_id} or
     * {@code uq_group_member_balances_group_id_invited_contact_id} — those carry
     * {@code member_balances_} where these carry {@code members_}, so the
     * substring breaks at that point in both directions. The balance keys would
     * mean something entirely different if matched here (V10 maps them to
     * {@code 500}: "a duplicate balance row means the recalculation did not use
     * an upsert").
     */
    private static final List<String> ALREADY_A_MEMBER_CONSTRAINTS = List.of(
            "uq_group_members_group_id_user_id",
            "uq_group_members_group_id_invited_contact_id");

    /**
     * {@code 23503} → <strong>{@code 400 CONTACT_NOT_FOUND}</strong>, which is
     * §7.4's code for "{@code contactId} isn't the caller's own" — note it is a
     * {@code 400} there, not a {@code 404} (V10 contract item 1). The service
     * pre-resolves the contact owner-scoped, so a legal request never reaches
     * this constraint.
     */
    private static final String FK_INVITED_CONTACT = "fk_group_members_invited_contact_id";

    /**
     * {@code 23503} → <strong>{@code 404 GROUP_NOT_FOUND}</strong> (V10 contract
     * item 1). Not interchangeable with the mapping above: these two codes
     * differ in status <em>and</em> in meaning, and V10's table states each
     * separately for exactly that reason.
     */
    private static final String FK_GROUP = "fk_group_members_group_id";

    private final GroupRepository groupRepository;
    private final GroupMemberRepository memberRepository;
    private final ContactRepository contactRepository;
    private final UserRepository userRepository;
    private final GroupBalanceService groupBalanceService;
    private final GroupResponseAssembler responseAssembler;
    private final ContactInviteService contactInviteService;

    public GroupService(
            GroupRepository groupRepository,
            GroupMemberRepository memberRepository,
            ContactRepository contactRepository,
            UserRepository userRepository,
            GroupBalanceService groupBalanceService,
            GroupResponseAssembler responseAssembler,
            ContactInviteService contactInviteService,
            EntityInserter entityInserter,
            IdempotentWriteExecutor writeExecutor,
            ChangeLogWriter changeLogWriter) {
        this.groupRepository = groupRepository;
        this.memberRepository = memberRepository;
        this.contactRepository = contactRepository;
        this.userRepository = userRepository;
        this.groupBalanceService = groupBalanceService;
        this.responseAssembler = responseAssembler;
        this.contactInviteService = contactInviteService;
        this.entityInserter = entityInserter;
        this.writeExecutor = writeExecutor;
        this.changeLogWriter = changeLogWriter;
    }

    private final EntityInserter entityInserter;
    private final IdempotentWriteExecutor writeExecutor;
    private final ChangeLogWriter changeLogWriter;

    /**
     * {@code GET /api/v1/groups} (§7.1) — "every group the caller is a member of
     * (via {@code group_members}), not every group in the system".
     *
     * <p>Membership is not a filter applied after a broad read: the id set
     * <em>comes from</em> {@code group_members}, so a group the caller is not in
     * is never fetched at all.
     *
     * <p><strong>A plain array, not a {@code PageResponse}</strong>: the contract
     * specifies {@code GroupResponse[]}, and the set is bounded by one person's
     * memberships. Flagged in backend/README.md §15 alongside
     * {@code GET /contacts} as this domain's two departures from constitution
     * §11's pagination rule.
     *
     * <p>Five queries total, independent of group count: memberships → groups →
     * member rows → two name lookups → balances (the assembler's three, plus
     * these two).
     */
    @Transactional(readOnly = true)
    public List<GroupResponse> listGroups(UUID userId) {
        requireUser(userId);

        List<UUID> groupIds = memberRepository.findGroupIdsByUserId(userId);
        if (groupIds.isEmpty()) {
            return List.of();
        }
        List<ExpenseGroup> groups = groupRepository.findByIdInOrderByNameAscIdAsc(groupIds);
        List<GroupMember> members = memberRepository.findByGroupIdInOrderByCreatedAtAscIdAsc(groupIds);
        return responseAssembler.assemble(groups, members, userId);
    }

    /**
     * {@code GET /api/v1/groups/{id}} (§7.3) — membership-gated.
     *
     * <p>The membership check is the first statement, and its {@code false}
     * answer is {@code 404 GROUP_NOT_FOUND} whether the group is absent or
     * merely someone else's. One query answers both, so this method never learns
     * which case it was and cannot leak the difference.
     */
    @Transactional(readOnly = true)
    public GroupResponse getGroup(UUID userId, UUID groupId) {
        requireUser(userId);
        requireMembership(groupId, userId);

        ExpenseGroup group = groupRepository.findById(groupId).orElseThrow(GroupNotFoundException::new);
        List<GroupMember> members = memberRepository.findByGroupIdOrderByCreatedAtAscIdAsc(groupId);
        return responseAssembler.assembleOne(group, members, userId);
    }

    /**
     * {@code POST /api/v1/groups} (§7.2) — {@code 201 Created}.
     *
     * <p>Steps, in the order §7.2 describes them plus the two this domain's own
     * contracts add:
     * <ol>
     *   <li>resolve <strong>every</strong> {@code memberContactIds} entry
     *       owner-scoped, in <strong>one</strong> query — V9 contract item 6
     *       names the per-row alternative as a specific trap. Any id that fails
     *       to resolve is {@code 404 CONTACT_NOT_FOUND}, which covers "does not
     *       exist" and "is not mine" identically;</li>
     *   <li>create the group ({@code last_activity} stays {@code null} — nothing
     *       in §6/§7 writes it);</li>
     *   <li><strong>the creator is always a member</strong>, with
     *       {@code role: 'member'}; then one row per resolved contact, filling
     *       {@code user_id} for a linked contact and {@code invited_contact_id}
     *       otherwise;</li>
     *   <li>resolve-or-create a balance row per member and assert the group
     *       reconciles;</li>
     *   <li>fire the invite trigger for each unlinked contact member with a
     *       phone — <strong>last</strong>, for the rollback reason in the class
     *       Javadoc.</li>
     * </ol>
     *
     * <p><strong>Duplicate member keys are de-duplicated rather than rejected,
     * and that is a deliberate reading of §7.2</strong> (flagged in
     * backend/README.md §15). §7.2's error table defines {@code 400} and
     * {@code 404} and <em>no</em> {@code 409}, so raising
     * {@code ALREADY_A_MEMBER} here would be inventing an error the contract
     * does not have. Three real inputs collapse this way:
     * <ul>
     *   <li>the same contact id twice in the array;</li>
     *   <li>two <em>different</em> contacts linked to the same account — the
     *       same person entered twice under two names, which V9 explicitly
     *       permits;</li>
     *   <li><strong>a contact linked to the caller themselves</strong> (V9's
     *       FLAG 1, still unresolved at the contact level) — the creator is
     *       already a member, so the duplicate is their own row. Rejecting the
     *       whole group creation because a user has their own number in their own
     *       address book would be the worst of the available behaviours.</li>
     * </ul>
     * The uniqueness constraints remain the real guarantee for the concurrent
     * case; §7.4, which <em>does</em> define a {@code 409}, raises it.
     */
    public WriteResult<GroupResponse> createGroup(UUID userId, CreateGroupRequest request, WriteContext context) {
        UUID requestedId = ClientIds.requireNotNil(request.id(), "id");
        // Not @Transactional: IdempotentWriteExecutor owns the boundary (ADR 0027 §4.3).
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.GROUP, ChangeLog.OPERATION_CREATE, requestedId),
                recorded -> WriteResult.created(getGroup(userId, recorded.getEntityId())),
                () -> doCreateGroup(userId, request, requestedId, context));
    }

    private WriteResult<GroupResponse> doCreateGroup(
            UUID userId, CreateGroupRequest request, UUID requestedId, WriteContext context) {
        requireUser(userId);

        // ADR 0027 §3.3 step 3: explicit lookup; never save() with a client id.
        if (requestedId != null) {
            ExpenseGroup existing = groupRepository.findById(requestedId).orElse(null);
            if (existing != null) {
                if (!userId.equals(existing.getCreatedByUserId())) {
                    throw new IdConflictException();
                }
                return WriteResult.created(getGroup(userId, requestedId));
            }
        }
        OffsetDateTime effectiveWriteAt = context.effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC));

        String name = request.name().trim();
        List<Contact> contacts = resolveOwnContacts(userId, request.memberContactIds());

        // INSERT only (ADR 0027 §3.3): persist, never merge.
        ExpenseGroup group = entityInserter.insert(ExpenseGroup.builder()
                .id(requestedId != null ? requestedId : UUID.randomUUID())
                .name(name)
                .createdByUserId(userId)
                // Explicit: free-text shared display state, written only by the
                // V11/V12 paths (data-model.md §4.2).
                .lastActivity(null)
                .build());

        List<GroupMember> members = new ArrayList<>();
        List<Contact> inviteTargets = new ArrayList<>();
        // The creator first, so the ordered member read puts them first too.
        Set<UUID> claimedUserIds = new HashSet<>();
        Set<UUID> claimedContactIds = new HashSet<>();
        members.add(memberForUser(group.getId(), userId));
        claimedUserIds.add(userId);

        for (Contact contact : contacts) {
            UUID linkedUserId = contact.getLinkedUserId();
            if (linkedUserId != null) {
                // A linked contact joins as the real account, which is what
                // makes the group shared rather than a private placeholder.
                if (!claimedUserIds.add(linkedUserId)) {
                    continue;
                }
                members.add(memberForUser(group.getId(), linkedUserId));
            } else {
                if (!claimedContactIds.add(contact.getId())) {
                    continue;
                }
                members.add(memberForContact(group.getId(), contact.getId()));
                // Only an unlinked contact can be invited — a linked one is
                // already a user (§6.3's already_linked reasoning).
                inviteTargets.add(contact);
            }
        }

        List<GroupMember> savedMembers = persistMembers(members);
        groupBalanceService.resolveOrCreateMemberBalances(group.getId());
        groupBalanceService.assertGroupBalancesConsistent(group.getId());

        // Never the group name or any contact name — both are personal data
        // (constitution §23). Ids and counts only.
        log.info("Group {} created by user {} with {} member(s), {} invite target(s)",
                group.getId(), userId, savedMembers.size(), inviteTargets.size());

        // Logged BEFORE the invites, so an idempotency race fails before any
        // irreversible SMS. The actor's group_created row (ADR 0008 §2.3) is the
        // one activity this change-log row gets (ADR 0027 §6.4).
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("name", group.getName());
        fields.put("memberContactIds", contacts.stream().map(Contact::getId).toList());
        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.GROUP, group.getId(),
                ChangeLog.OPERATION_CREATE, ChangeSets.create(fields), context, effectiveWriteAt, true);
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_GROUP_CREATED, ChangeLogSentences.GROUP_CREATED,
                ChangeLogSentences.groupCreated(group.getName(), savedMembers.size()),
                ChangeLogWriter.Related.group(group.getId()), changeLogId);

        fireInvites(userId, inviteTargets);
        return WriteResult.created(responseAssembler.assembleOne(group, savedMembers, userId));
    }

    /**
     * {@code POST /api/v1/groups/{id}/members} (§7.4) — {@code 201 Created},
     * membership-gated: <strong>the caller must already be a member to add
     * someone else.</strong>
     *
     * <p>Rejection order, each step before the next can write:
     * <ol>
     *   <li>caller's membership → {@code 404 GROUP_NOT_FOUND};</li>
     *   <li>{@code contactId} resolved owner-scoped →
     *       <strong>{@code 400}</strong> {@code CONTACT_NOT_FOUND} (§7.4's own
     *       code; §7.2's equivalent is a {@code 404} — see
     *       {@link ContactNotFoundException});</li>
     *   <li>the member key already present → {@code 409 ALREADY_A_MEMBER}, from
     *       a pre-check against whichever of the two uniqueness keys applies.
     *       The constraints stay the real guarantee for two members adding the
     *       same contact concurrently, which no pre-check can cover.</li>
     * </ol>
     *
     * <p>Then the same balance resolve-and-assert as §7.2, then the invite —
     * last. §7.4's response carries no invite field, so the outcome is logged
     * rather than returned (see {@link GroupMemberResponse}).
     */
    public WriteResult<GroupMemberResponse> addMember(
            UUID userId, UUID groupId, AddGroupMemberRequest request, WriteContext context) {
        // BE-9 (ADR 0027 §3.2/§4.3): logged with its key, entity = the group,
        // operation 'update'. A replay answers 201 with the member it created; a
        // genuine duplicate WITHOUT a recorded key stays 409 ALREADY_A_MEMBER.
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(ChangeLogEntityTypes.GROUP, ChangeLog.OPERATION_UPDATE, groupId),
                recorded -> WriteResult.created(replayedMember(userId, groupId, request.contactId())),
                () -> WriteResult.created(doAddMember(userId, groupId, request, context)));
    }

    /** Re-reads the member a recorded add-member created, under the same gates. */
    private GroupMemberResponse replayedMember(UUID userId, UUID groupId, UUID contactId) {
        requireMembership(groupId, userId);
        Contact contact = contactRepository.findByIdAndOwnerUserId(contactId, userId)
                .orElseThrow(ContactNotFoundException::badRequest);
        GroupMember member = (contact.getLinkedUserId() != null
                ? memberRepository.findByGroupIdAndUserId(groupId, contact.getLinkedUserId())
                : memberRepository.findByGroupIdAndInvitedContactId(groupId, contact.getId()))
                .orElseThrow(GroupNotFoundException::new);
        return new GroupMemberResponse(member.getId(), member.getUserId(), member.getInvitedContactId(),
                responseAssembler.resolveMemberName(member, contact.getName()), member.getRole(),
                member.getCreatedAt());
    }

    private GroupMemberResponse doAddMember(
            UUID userId, UUID groupId, AddGroupMemberRequest request, WriteContext context) {
        requireUser(userId);
        requireMembership(groupId, userId);

        Contact contact = contactRepository.findByIdAndOwnerUserId(request.contactId(), userId)
                .orElseThrow(ContactNotFoundException::badRequest);

        UUID linkedUserId = contact.getLinkedUserId();
        GroupMember member;
        if (linkedUserId != null) {
            if (memberRepository.existsByGroupIdAndUserId(groupId, linkedUserId)) {
                throw new AlreadyAMemberException();
            }
            member = memberForUser(groupId, linkedUserId);
        } else {
            if (memberRepository.existsByGroupIdAndInvitedContactId(groupId, contact.getId())) {
                throw new AlreadyAMemberException();
            }
            member = memberForContact(groupId, contact.getId());
        }

        GroupMember saved = persistMembers(List.of(member)).get(0);
        groupBalanceService.resolveOrCreateMemberBalances(groupId);
        groupBalanceService.assertGroupBalancesConsistent(groupId);

        log.info("User {} added member {} to group {} (registered={})",
                userId, saved.getId(), groupId, linkedUserId != null);

        String name = responseAssembler.resolveMemberName(saved, contact.getName());

        // Logged before the invite (an idempotency race must fail before an SMS).
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.GROUP, groupId,
                ChangeLog.OPERATION_UPDATE,
                List.of(new FieldChange("members", null, Map.of("contactId", contact.getId().toString()))),
                context, context.effectiveWriteAt(now), true);
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_GROUP_MEMBER_ADDED,
                ChangeLogSentences.GROUP_MEMBER_ADDED,
                ChangeLogSentences.groupMemberAdded(name, groupRepository.findById(groupId)
                        .map(ExpenseGroup::getName).orElseThrow(GroupNotFoundException::new)),
                ChangeLogWriter.Related.group(groupId), changeLogId);

        if (linkedUserId == null) {
            fireInvites(userId, List.of(contact));
        }
        return new GroupMemberResponse(
                saved.getId(),
                saved.getUserId(),
                saved.getInvitedContactId(),
                name,
                saved.getRole(),
                saved.getCreatedAt());
    }

    /**
     * Resolves a whole {@code memberContactIds} array owner-scoped in one query,
     * preserving the request's order and dropping duplicate ids.
     *
     * <p>The size comparison is what produces {@code 404 CONTACT_NOT_FOUND}: a
     * missing id and another user's id both simply fail to come back, so this
     * method never learns which it was.
     */
    private List<Contact> resolveOwnContacts(UUID userId, List<UUID> requestedIds) {
        if (requestedIds == null || requestedIds.isEmpty()) {
            return List.of();
        }
        // LinkedHashSet: distinct, order-preserving. The order matters only so
        // the member rows and the resulting invite sequence are deterministic
        // for a given request, which makes a failure reproducible.
        Set<UUID> distinctIds = new LinkedHashSet<>(requestedIds);
        List<Contact> found = contactRepository.findByOwnerUserIdAndIdIn(userId, distinctIds);
        if (found.size() != distinctIds.size()) {
            throw ContactNotFoundException.notFound();
        }
        Map<UUID, Contact> byId = found.stream()
                .collect(Collectors.toMap(Contact::getId, Function.identity()));
        // Re-ordered from the request rather than trusting the IN clause's
        // result order, which SQL does not define.
        return distinctIds.stream().map(byId::get).toList();
    }

    private static GroupMember memberForUser(UUID groupId, UUID userId) {
        return GroupMember.builder()
                .id(UUID.randomUUID())
                .groupId(groupId)
                .userId(userId)
                // Explicit null, so chk_group_members_user_xor_contact's rule is
                // visible at the construction site rather than inferred.
                .invitedContactId(null)
                .role(GroupMember.ROLE_MEMBER)
                .build();
    }

    private static GroupMember memberForContact(UUID groupId, UUID contactId) {
        return GroupMember.builder()
                .id(UUID.randomUUID())
                .groupId(groupId)
                .userId(null)
                .invitedContactId(contactId)
                .role(GroupMember.ROLE_MEMBER)
                .build();
    }

    /**
     * Flushes inside the transaction so a constraint violation surfaces here —
     * where it can still be mapped onto a meaningful status code — rather than
     * at commit.
     *
     * <p>The ids are application-assigned, so Spring Data merges rather than
     * persists and hands back <em>different</em> managed instances; only those
     * carry the {@code @CreationTimestamp}/{@code @UpdateTimestamp} values the
     * response needs, which is why the return value is used and the input list
     * is not (the same wrinkle backend/README.md §3 records for
     * {@code register()}'s {@code createdAt}).
     */
    private List<GroupMember> persistMembers(List<GroupMember> members) {
        try {
            return memberRepository.saveAllAndFlush(members);
        } catch (DataIntegrityViolationException ex) {
            throw translateMembershipViolation(ex);
        }
    }

    /**
     * Maps a {@code group_members} integrity violation onto the exact code V10's
     * contract assigns it, <strong>by constraint name and never by parsing
     * driver message text</strong>.
     *
     * <p><strong>Null-safe by design, not by luck.</strong> V10 repeats the
     * warning V6 and V8 earned on {@code categories}: those tables' triggers
     * raise from plpgsql, and a {@code RAISE} carries no constraint name at all,
     * so {@link ConstraintViolationException#getConstraintName()} can be
     * {@code null} on a path reaching this same application. Folding the case of
     * that value without a guard would throw a {@link NullPointerException}
     * <em>inside</em> the handler for the original failure — replacing a real
     * error with a confusing one. The loop keeps walking the cause chain after a
     * null, in case a named violation sits deeper in it.
     *
     * <p>Anything unmatched is rethrown unchanged and becomes a logged
     * {@code 500}, which is the honest answer: every other constraint on this
     * table means a service check was skipped.
     * {@code chk_group_members_user_xor_contact} is the clearest example — this
     * service decides which column to fill, so reaching it is a service bug, not
     * bad input (V10 contract item 1).
     */
    private static RuntimeException translateMembershipViolation(DataIntegrityViolationException ex) {
        for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException violation) {
                String constraintName = violation.getConstraintName();
                if (constraintName != null) {
                    String folded = constraintName.toLowerCase(Locale.ROOT);
                    if (ALREADY_A_MEMBER_CONSTRAINTS.stream().anyMatch(folded::contains)) {
                        return new AlreadyAMemberException();
                    }
                    if (folded.contains(FK_INVITED_CONTACT)) {
                        return ContactNotFoundException.badRequest();
                    }
                    if (folded.contains(FK_GROUP)) {
                        return new GroupNotFoundException();
                    }
                    return ex;
                }
            }
        }
        return ex;
    }

    /**
     * Fires the §7.2/§7.4 invite trigger for each unlinked contact member with a
     * phone — "inviting someone to a specific group is at least as strong a
     * signal of intent-to-invite as creating the contact alone was"
     * (ADR 0015 §3).
     *
     * <p>One call per target, each of which decides its own limits: "a member
     * already mid-cooldown from a prior invite is simply added to the group
     * without a duplicate SMS" (§7.2), which falls out of the cooldown check
     * rather than needing a rule here. Neither this method nor anything it calls
     * can reject the parent request for an invite-related reason (ADR 0015 §4).
     *
     * <p>This is <strong>not</strong> an N+1 of the kind constitution §10
     * forbids: each iteration is an external side effect that must be decided
     * individually, not a row read that could have been batched. The group paths
     * resolve every contact in one query before reaching here, which is the
     * read V9 contract item 6 was about.
     */
    private void fireInvites(UUID userId, List<Contact> contacts) {
        for (Contact contact : contacts) {
            contactInviteService.triggerInviteIfApplicable(userId, contact)
                    .ifPresent(attempt -> log.info("Group invite for contact {} finished as {}",
                            contact.getId(), attempt.outcome().getValue()));
        }
    }

    /**
     * The membership check, in one place. {@code false} is
     * {@code 404 GROUP_NOT_FOUND} — never {@code 403}, and never a different
     * message for the two cases it covers.
     */
    private void requireMembership(UUID groupId, UUID userId) {
        if (!memberRepository.existsByGroupIdAndUserId(groupId, userId)) {
            throw new GroupNotFoundException();
        }
    }

    /**
     * A valid token whose user row no longer exists is a {@code 401}, not a
     * {@code 404} — the missing resource <em>is</em> the principal. Same rule as
     * Domains 2, 3 and 4.
     */
    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }
}
