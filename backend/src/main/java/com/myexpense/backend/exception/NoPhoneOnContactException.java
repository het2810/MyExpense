package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 400 NO_PHONE_ON_CONTACT} — {@code POST /api/v1/contacts/{id}/invite}
 * on a contact that has no {@code phone} set (api-overview.md §6.3).
 *
 * <p><strong>{@code 400}, not {@code 404}:</strong> the contact exists and
 * belongs to the caller, so this is <em>ineligibility</em> rather than absence —
 * the same test {@link CategoryProtectedException} and
 * {@link SubcategoryDepthExceededException} applied. A contact with neither a
 * phone nor an email is a legal, useful row (a plain name in an address book,
 * api-overview.md §6.1), so this is a normal state to meet, not a broken one.
 *
 * <p><strong>Checked before any insert</strong>, which is what makes it this
 * clean error instead of a {@code 500}: {@code chk_contact_invites_phone_not_blank}
 * is only a backstop for a blank-but-non-null phone, and V9's contract item 1
 * says plainly that "a 500 is the honest answer if it is ever reached".
 *
 * <p>There is no equivalent error for an email-only contact and no email invite
 * path at all — email invites are explicitly out of scope for ADR 0015
 * ("Out of scope"), so an unmatched {@code email} triggers nothing. That is a
 * deliberate omission, not a gap to fill here.
 */
public class NoPhoneOnContactException extends ApiException {

    public NoPhoneOnContactException() {
        super(HttpStatus.BAD_REQUEST, "NO_PHONE_ON_CONTACT",
                "This contact has no phone number, so an invite cannot be sent.");
    }
}
