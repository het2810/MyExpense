package com.myexpense.backend.dto.request;

import java.util.List;
import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code POST /api/v1/groups} (api-overview.md §7.2).
 *
 * <p>Two fields, and the second is optional: a group may legitimately be created
 * with no members but its creator, who is <strong>always</strong> added as a
 * {@code 'member'} row by the server (§7.2 — there is no {@code 'owner'} role
 * this phase, matching the frontend).
 *
 * <p><strong>{@code memberContactIds} holds the creator's OWN contacts</strong>,
 * re-resolved owner-scoped server-side regardless of what the client offers
 * (security-architecture.md §3): an entry that is not one of the caller's own
 * contacts is {@code 404 CONTACT_NOT_FOUND} — including when it exists and
 * belongs to someone else, per this API's owner-scoped convention. There is
 * deliberately no field for adding a member by user id, email or phone: a member
 * always arrives through a contact of somebody's, which is what keeps the invite
 * trigger and the address book as the single entry point.
 *
 * <p>No {@code lastActivity} and no {@code members[]} shape here. Both are
 * server-owned: {@code last_activity} is written only by the V11/V12 paths, and
 * the member rows are derived from {@code memberContactIds} plus the creator.
 */
public record CreateGroupRequest(

        /*
         * ADR 0027 §3 (api-overview.md §15.2): optional client-supplied primary
         * key, not the nil UUID. Created by the caller already -> 201 with the
         * current group; someone else's -> 409 ID_CONFLICT.
         */
        java.util.UUID id,


        /*
         * Contract: "required, max 100". @NotBlank for the same reason
         * CreateContactRequest#name uses it: chk_groups_name_not_blank exists
         * for this input, and V10 maps reaching it to a 400 that Bean
         * Validation should already have produced. Trimmed in GroupService
         * before persist.
         */
        @NotBlank
        @Size(max = 100)
        String name,

        /*
         * Contract: "optional — the creator's own contacts to invite at
         * creation time". Absent and [] behave identically (a group of one).
         *
         * @NotNull on the element type rejects [null] — which would otherwise
         * reach the owner-scoped resolution as a null id, match nothing, and
         * produce a 404 for what is really a malformed body. A 400 naming the
         * element is the honest answer.
         *
         * THE SIZE CAP IS A DERIVED BOUND, NOT A CONTRACT FIGURE, and is
         * flagged as such in backend/README.md §15. §7.2 states no maximum, but
         * this field is the only place in the API where ONE request can trigger
         * MANY SMS sends (§7.2's invite trigger fires per unlinked member), so
         * an unbounded array is an abuse amplifier on the most
         * strictly-limited mechanism in the whole API
         * (security-architecture.md §11). 50 is deliberately well above
         * anything a real group needs and above the per-user daily send cap
         * (ADR 0015 §4 recommends ~20), so it can never be the binding limit on
         * a legitimate request — the invite caps stay the real control, and
         * this only stops a single pathological payload. Raise it, or remove it,
         * through the System Architect rather than locally.
         */
        @Size(max = 50)
        List<@NotNull UUID> memberContactIds) {
}
