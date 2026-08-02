package com.myexpense.backend.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code POST /api/v1/contacts} (api-overview.md §6.2).
 *
 * <p>A record, like {@link CreateCategoryRequest}: on a create there is no
 * "field omitted vs. explicitly null" distinction to preserve — an absent
 * {@code phone} and {@code "phone": null} both mean "this contact has no phone",
 * which is exactly what a {@code null} component expresses. (§6 has no PATCH at
 * all, so the three-intent problem {@code UpdateUserRequest} solves never
 * arises here.)
 *
 * <p><strong>Three fields, and no more.</strong> §6.2 accepts
 * name/phone/email only:
 * <ul>
 *   <li>{@code initials} is <strong>server-derived</strong> from {@code name}
 *       and must never become a request field (V9 contract item 3);</li>
 *   <li>{@code linkedUserId} is resolved server-side from a {@code users} row
 *       (§6.2's auto-link), so a client cannot assert that a contact is a
 *       particular account — which would be an authorization hole, not just a
 *       wrong field;</li>
 *   <li>{@code inviteStatus} is an <em>outcome</em>, not an input.</li>
 * </ul>
 * Any of those keys sent in the body is ignored rather than honoured, because
 * this type has no such property (security-architecture.md §3).
 *
 * <p><strong>A contact may have either, both, or neither</strong> of
 * {@code phone}/{@code email} (§6.1), so there is deliberately no class-level
 * "at least one of" constraint — a plain name in an address book is a legal,
 * useful row, and V9 declines the equivalent CHECK for the same reason.
 *
 * <p><strong>No duplicate-contact rule.</strong> §6.2 defines no such error and
 * V9 adds no uniqueness to the table: two different users may hold the same
 * number, and so may two contacts of one user (the same person entered twice
 * under two names). {@code ContactService} must not add one either without a
 * product decision (V9 contract item 1's closing note).
 */
public record CreateContactRequest(

        /*
         * Contract: "required, max 100". @NotBlank rather than @NotNull because
         * chk_contacts_name_not_blank exists in the database for exactly this
         * input, and V9's contract maps reaching it to a server-side bug — Bean
         * Validation must reject a blank or whitespace-only name first. The
         * value is trimmed in ContactService before the length finally matters
         * at the varchar(100) column, which is the same order Domain 3 uses.
         */
        @NotBlank
        @Size(max = 100)
        String name,

        /*
         * Contract: "optional — E.164 format recommended".
         *
         * ENFORCED STRICTLY RATHER THAN RECOMMENDED, and this is the one place
         * this DTO is deliberately tighter than the sentence in the contract.
         * Flagged in backend/README.md §15 rather than done quietly, because it
         * can reject a payload §6.2's prose would accept. Two reasons, both
         * about correctness rather than tidiness:
         *
         *  1. THE STORED STRING IS THE INVITE COOLDOWN'S BUCKET KEY. The
         *     cooldown is defined per real-world phone number and is checked
         *     with an equality on contact_invites.phone (V9, ADR 0015 §4). If
         *     "+919876543210" and "+91 98765 43210" were both storable, they
         *     would be two buckets for one number and the limit would be
         *     bypassable by reformatting — which is the one rule ADR 0015 §4
         *     says "must not be approximate".
         *  2. A NON-E.164 VALUE CANNOT DO EITHER JOB THIS FIELD EXISTS FOR.
         *     Auto-link compares it against users.phone, which §2.2 validates
         *     as strict E.164, so a local-format number can never match; and no
         *     gateway can route an unqualified number reliably either. Storing
         *     one would look like it worked while silently doing nothing.
         *
         * Same pattern constant as UpdateUserRequest#phone, deliberately
         * identical: the two columns are compared to each other, so a
         * divergence between their rules would be a silent matching failure.
         * max 20 matches the varchar(20) column.
         */
        @Size(max = 20)
        @Pattern(regexp = "^\\+[1-9]\\d{6,14}$",
                message = "must be in E.164 format, e.g. +919876543210")
        String phone,

        /*
         * Contract: "optional". @Email (not a hand-written regex) plus the
         * column's own 255. Matched case-insensitively against users.email,
         * which AuthService stores lowercased — see ContactService, which
         * lowercases the probe and stores the value as submitted so §6.1 echoes
         * what the user typed.
         *
         * NOT unique and NOT a link guarantee: an email that matches an account
         * sets linkedUserId, and one that does not triggers nothing at all.
         * Email invites are explicitly out of scope for ADR 0015.
         */
        @Email
        @Size(max = 255)
        String email,

        /*
         * ADR 0027 §3 (api-overview.md §15.2): optional client-supplied primary
         * key, not the nil UUID. Created by the caller already -> 201 with the
         * current row and NO second invite; someone else's -> 409 ID_CONFLICT.
         */
        java.util.UUID id) {
}
