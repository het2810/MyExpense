package com.myexpense.backend.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.AddGroupMemberRequest;
import com.myexpense.backend.dto.request.CreateGroupRequest;
import com.myexpense.backend.dto.request.SplitFeedQuery;
import com.myexpense.backend.dto.response.GroupMemberResponse;
import com.myexpense.backend.dto.response.GroupResponse;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.dto.response.SplitFeedItemResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.GroupService;
import com.myexpense.backend.service.SplitFeedService;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the Groups domain (api-overview.md §7) — four endpoints,
 * all requiring {@code Authorization: Bearer <accessToken>}, which
 * {@code SecurityConfig} enforces before any method here runs.
 *
 * <p><strong>All four are MEMBERSHIP-GATED, and that check is not here.</strong>
 * ADR 0014 §1 makes the point precisely about this domain: "a controller-only
 * security posture (e.g. relying on a URL prefix or a naive owner-id filter) is
 * insufficient once a resource can legitimately be written to by more than one
 * user". The authenticated route is necessary and nowhere near sufficient —
 * {@code GroupService} re-derives membership from {@code group_members} on every
 * request and answers {@code 404}, never {@code 403}
 * (security-architecture.md §2). This class deliberately contains no
 * authorization logic at all, so there is exactly one place that rule can be got
 * wrong.
 *
 * <p>{@code {id}} always identifies the <strong>group</strong>, never the user,
 * and the caller's identity arrives only via {@link CurrentUserId} — from the
 * verified JWT, never a path variable, a query parameter or a body field.
 *
 * <p>The default per-user rate-limit tier covers all four routes automatically
 * ({@code ApiRateLimitFilter}), so <strong>no second mechanism is added
 * here</strong>. The two write paths can trigger an invite SMS, and those sends
 * are bounded by the {@code contact_invites} window limits inside
 * {@code ContactInviteService} — <em>not</em> by a token bucket on these routes,
 * because a bucket rejection would fail the group write itself, which ADR 0015 §4
 * forbids ("a contact must never fail to be created merely because a downstream
 * SMS provider had a bad moment" — the same rule covers a membership write).
 *
 * <p><strong>No DELETE, no PATCH and no member removal</strong>, deliberately:
 * §7 defines none, and every FK in {@code V10} is {@code NO ACTION}, so those
 * operations are blocked by the database until a design pass decides them
 * (data-model.md Open Question #3).
 */
@RestController
@RequestMapping("/api/v1/groups")
public class GroupController {

    private final GroupService groupService;
    private final SplitFeedService splitFeedService;

    public GroupController(GroupService groupService, SplitFeedService splitFeedService) {
        this.groupService = groupService;
        this.splitFeedService = splitFeedService;
    }

    /**
     * §7.5 (ADR 0028 §7) — the group's chronological feed of split expenses
     * (deleted ones as tombstones) and settlements, {@code PageResponse}.
     * Membership-gated in {@code SplitFeedService}: {@code 404 GROUP_NOT_FOUND}.
     */
    @GetMapping("/{id}/feed")
    public ResponseEntity<PageResponse<SplitFeedItemResponse>> getGroupFeed(
            @CurrentUserId UUID userId, @PathVariable("id") UUID id, @Valid @ModelAttribute SplitFeedQuery query) {
        return ResponseEntity.ok(splitFeedService.groupFeed(userId, id, query));
    }

    /**
     * §7.1 — every group the caller is a member of, not every group in the
     * system.
     *
     * <p>A plain array, not a {@code PageResponse}: the contract specifies
     * {@code GroupResponse[]} and the set is bounded by one person's
     * memberships.
     *
     * <p>{@code yourBalance} on each entry is viewer-relative — built from the
     * requesting principal's own {@code group_member_balances} row — so two
     * members calling this endpoint correctly see different numbers for one
     * group.
     */
    @GetMapping
    public ResponseEntity<List<GroupResponse>> listGroups(@CurrentUserId UUID userId) {
        return ResponseEntity.ok(groupService.listGroups(userId));
    }

    /** §7.2 — create a group, optionally with members; {@code 201 Created}. */
    @PostMapping
    public ResponseEntity<GroupResponse> createGroup(
            @CurrentUserId UUID userId, com.myexpense.backend.sync.WriteContext writeContext,
            @Valid @RequestBody CreateGroupRequest request) {
        return groupService.createGroup(userId, request, writeContext).toResponseEntity();
    }

    /**
     * §7.3 — one group, same shape as the list item.
     *
     * <p>{@code 404 GROUP_NOT_FOUND} covers "does not exist" and "the caller
     * isn't a member" identically, per §7.3's own error table.
     */
    @GetMapping("/{id}")
    public ResponseEntity<GroupResponse> getGroup(
            @CurrentUserId UUID userId, @PathVariable("id") UUID id) {
        return ResponseEntity.ok(groupService.getGroup(userId, id));
    }

    /**
     * §7.4 — add one of the caller's own contacts to a group the caller is
     * already a member of; {@code 201 Created}.
     *
     * <p>"Fills a real gap the frontend doesn't have today: membership is
     * currently only ever set at group-creation time" (§7.4).
     *
     * <p>Three distinct failures, and their codes are <strong>not</strong>
     * interchangeable: {@code 404 GROUP_NOT_FOUND} (not a member, or no such
     * group), {@code 400 CONTACT_NOT_FOUND} (not the caller's contact — a
     * {@code 400} here, unlike §7.2's {@code 404}), and
     * {@code 409 ALREADY_A_MEMBER}.
     */
    @PostMapping("/{id}/members")
    public ResponseEntity<GroupMemberResponse> addMember(
            @CurrentUserId UUID userId,
            @PathVariable("id") UUID id,
            com.myexpense.backend.sync.WriteContext writeContext,
            @Valid @RequestBody AddGroupMemberRequest request) {
        // ADR 0027 BE-9: a replay is 201 with the member it created.
        return groupService.addMember(userId, id, request, writeContext).toResponseEntity();
    }
}
