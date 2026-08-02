package com.myexpense.backend.controller;

import java.util.List;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.CreateContactRequest;
import com.myexpense.backend.dto.response.ContactCreatedResponse;
import com.myexpense.backend.dto.response.ContactInviteResponse;
import com.myexpense.backend.dto.response.ContactResponse;
import com.myexpense.backend.security.CurrentUserId;
import com.myexpense.backend.service.ContactService;

import jakarta.validation.Valid;

/**
 * HTTP layer only for the Contacts domain (api-overview.md §6) — three
 * endpoints, all requiring {@code Authorization: Bearer <accessToken>}, which
 * {@code SecurityConfig} enforces before any method here runs.
 *
 * <p>The caller's identity arrives only via {@link CurrentUserId}, i.e. from the
 * verified JWT (security-architecture.md §2) — the rule Domain 2 established and
 * every domain since has followed. {@code {id}} in the invite path identifies the
 * <strong>contact</strong>, never the user: {@code ContactService} resolves it
 * with a lookup that is itself filtered by the authenticated user id, so an id
 * belonging to another account is a {@code 404}, not someone else's data.
 *
 * <p><strong>Rate limiting: the default per-user tier covers all three routes
 * automatically</strong> ({@code ApiRateLimitFilter} keys off the
 * {@code /api/v1/} prefix and excludes only {@code /api/v1/auth/}), and
 * {@code POST /contacts/{id}/invite} additionally carries <strong>its own two
 * stricter limits</strong> — applied inside {@code ContactInviteService}, exactly
 * as {@code AuthService} layers per-account limits over the per-IP filter, and
 * <strong>not</strong> as a second filter or a second mechanism
 * (security-architecture.md §11, which names this endpoint as "the single
 * strictest case in the entire API"). On top of those, the two
 * {@code contact_invites} window checks bound real sends. Four limits, one
 * mechanism each, documented on {@code ContactInviteProperties}.
 *
 * <p>Business rules — trimming, initials derivation, auto-link, both abuse
 * limits, the ledger row and the two-statement status advance — live in
 * {@code ContactService}/{@code ContactInviteService}; this class only maps HTTP.
 *
 * <p><strong>No PATCH and no DELETE, deliberately:</strong> §6 defines neither,
 * so a contact is immutable once created. That is also why {@code contacts} has
 * no {@code version} and no {@code deleted_at} column (V9's closing notes) — if
 * either endpoint is ever wanted, both questions need answering first.
 */
@RestController
@RequestMapping("/api/v1/contacts")
public class ContactController {

    private final ContactService contactService;

    public ContactController(ContactService contactService) {
        this.contactService = contactService;
    }

    /**
     * §6.1 — the caller's whole address book.
     *
     * <p>A plain array, not a {@code PageResponse}: the contract specifies
     * {@code ContactResponse[]} and the frontend's contact search is a
     * client-side filter over the already-fetched list (ADR 0006), so
     * paginating would break that search rather than improve anything. Same call
     * as {@code GET /categories}.
     */
    @GetMapping
    public ResponseEntity<List<ContactResponse>> listContacts(@CurrentUserId UUID userId) {
        return ResponseEntity.ok(contactService.listContacts(userId));
    }

    /**
     * §6.2 — create a contact; {@code 201 Created}.
     *
     * <p>The response is {@link ContactCreatedResponse} rather than
     * {@link ContactResponse}: §6.2's shape carries an additional
     * {@code inviteStatus}, present-and-{@code null} when no invite was
     * applicable.
     *
     * <p>A failed or blocked invite still returns {@code 201} — the contact is
     * created either way (ADR 0015 §4), and the outcome is a field rather than a
     * status code.
     */
    @PostMapping
    public ResponseEntity<ContactCreatedResponse> createContact(
            @CurrentUserId UUID userId, com.myexpense.backend.sync.WriteContext writeContext,
            @Valid @RequestBody CreateContactRequest request) {
        // 201 on a create and on a replay (ADR 0027 §4.3).
        return contactService.createContact(userId, request, writeContext).toResponseEntity();
    }

    /**
     * §6.3 — explicitly (re)trigger an invite SMS for an existing contact
     * (owner-scoped).
     *
     * <p><strong>No request body</strong>, deliberately: §6.3 defines none. The
     * contact comes from the path and everything else — the number, both limits,
     * the message — is server-side. There is nothing for a client to supply, so
     * there is nothing to validate beyond the path variable's own type (a
     * malformed uuid is already a {@code 400} via
     * {@code GlobalExceptionHandler}'s type-mismatch handler).
     *
     * <p>{@code 200}, not {@code 201}, for every non-error outcome — including
     * the three that write no row at all. A client reads {@code status} rather
     * than branching on the HTTP code.
     */
    @PostMapping("/{id}/invite")
    public ResponseEntity<ContactInviteResponse> resendInvite(
            @CurrentUserId UUID userId, @PathVariable("id") UUID id) {
        return ResponseEntity.ok(contactService.resendInvite(userId, id));
    }
}
