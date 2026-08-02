package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code CONTACT_NOT_FOUND} — one error code, <strong>two different HTTP status
 * codes, because the approved contract specifies two</strong>:
 *
 * <ul>
 *   <li><strong>{@code 404}</strong> on {@code POST /api/v1/contacts/{id}/invite}
 *       (api-overview.md §6.3) and on {@code POST /api/v1/groups} when a
 *       {@code memberContactIds} entry is not one of the caller's own contacts
 *       (§7.2's error table);</li>
 *   <li><strong>{@code 400}</strong> on {@code POST /api/v1/groups/{id}/members}
 *       when {@code contactId} is not the caller's own (§7.4's error table, and
 *       {@code V10__groups.sql}'s mapping for
 *       {@code fk_group_members_invited_contact_id}).</li>
 * </ul>
 *
 * <p><strong>The two are not interchangeable and neither is a typo.</strong>
 * V10's contract states the {@code 400} explicitly — "note it is a 400 there,
 * not a 404" — so this class offers one factory per call site rather than a
 * single default that would silently pick the wrong one for half of them. Both
 * factories carry the same message, for the same anti-enumeration reason
 * {@link CategoryNotFoundException} does: the response must not reveal whether
 * the id exists and belongs to someone else, or does not exist at all.
 *
 * <p>Why the contract differs between two endpoints that reject the same input
 * is a System Architect question, not one to normalise away here — flagged in
 * backend/README.md §15 rather than "fixed". The defensible reading is that
 * {@code contactId} is the <em>only</em> field of §7.4's body, so a bad value is
 * a bad request, while §7.2's {@code memberContactIds} is one optional field of
 * a larger create and the id is being <em>resolved</em>.
 *
 * <p>Both are produced by a service-layer pre-check, before any write. The
 * foreign key is only a backstop and guarantees the contact <em>exists</em>, not
 * who owns it (V10's note at the constraint) — ownership is unavoidably a
 * service-layer invariant here, because {@code group_members} has no owner
 * column to pair the FK with.
 */
public class ContactNotFoundException extends ApiException {

    private static final String MESSAGE = "Contact not found.";

    private ContactNotFoundException(HttpStatus status) {
        super(status, "CONTACT_NOT_FOUND", MESSAGE);
    }

    /**
     * {@code 404} — {@code POST /contacts/{id}/invite} (§6.3), and a
     * {@code memberContactIds} entry on {@code POST /groups} (§7.2).
     */
    public static ContactNotFoundException notFound() {
        return new ContactNotFoundException(HttpStatus.NOT_FOUND);
    }

    /**
     * {@code 400} — {@code contactId} on {@code POST /groups/{id}/members}
     * (§7.4). Deliberately not a {@code 404}; see the class Javadoc.
     */
    public static ContactNotFoundException badRequest() {
        return new ContactNotFoundException(HttpStatus.BAD_REQUEST);
    }
}
