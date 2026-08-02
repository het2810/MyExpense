package com.myexpense.backend.service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.CreateContactRequest;
import com.myexpense.backend.dto.response.ContactCreatedResponse;
import com.myexpense.backend.dto.response.ContactInviteResponse;
import com.myexpense.backend.dto.response.ContactResponse;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.User;
import com.myexpense.backend.exception.ContactNotFoundException;
import com.myexpense.backend.exception.IdConflictException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.ContactRepository;
import com.myexpense.backend.repository.EntityInserter;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.sync.ChangeLogEntityTypes;
import com.myexpense.backend.sync.ChangeSets;
import com.myexpense.backend.sync.ClientIds;
import com.myexpense.backend.sync.IdempotentWriteExecutor;
import com.myexpense.backend.sync.WriteContext;
import com.myexpense.backend.sync.WriteResult;

/**
 * Business rules for the Contacts domain (api-overview.md §6.1–§6.3) — Domain 6
 * sub-step 1.
 *
 * <p><strong>Owner-scoped, and it is the one table in this domain that is.</strong>
 * Every method takes the authenticated {@code userId} and scopes every read and
 * write to it; there is no method here that can address another user's contact.
 * A contact remains one user's private address-book entry even once it links to
 * a real account (data-model.md §4's note, V9's header), so "does
 * {@code owner_user_id} match the principal" <em>is</em> the right test here —
 * unlike {@code GroupService}, where it would be the wrong one. An id belonging
 * to someone else is indistinguishable from one that does not exist: both are
 * {@code 404 CONTACT_NOT_FOUND}, never a {@code 403}.
 *
 * <h2>Two values this class derives, and neither is ever a request field</h2>
 *
 * <ul>
 *   <li><strong>{@code initials}</strong> — the column is {@code NOT NULL} and
 *       §6.2 accepts name/phone/email only (V9 contract item 3). Derived here so
 *       every surface renders one badge per contact;</li>
 *   <li><strong>{@code linkedUserId}</strong> — resolved from a {@code users}
 *       row, which is also an authorization property rather than a convenience:
 *       a client that could assert it would be able to attach a contact (and
 *       later a group membership, and later a balance) to an arbitrary account.</li>
 * </ul>
 *
 * <h2>What this class deliberately does NOT do</h2>
 *
 * <ul>
 *   <li><strong>No duplicate-contact check.</strong> V9 adds no uniqueness and
 *       §6.2 defines no duplicate error, so two contacts with the same name,
 *       phone or email are legal for one user — the same person entered twice
 *       under two names is real data. V9's contract closes with "do not add a
 *       duplicate check in the service either without a product decision";</li>
 *   <li><strong>No email invite.</strong> An unmatched {@code email} triggers
 *       nothing at all — email invites are explicitly out of scope for
 *       ADR 0015;</li>
 *   <li><strong>No PATCH and no DELETE.</strong> §6 defines neither, so a
 *       contact is immutable once created and {@code contacts} needs no
 *       {@code version} and no {@code deleted_at};</li>
 *   <li><strong>No resolution of {@code linkedUserId} on read.</strong> V9
 *       contract item 6 names that as a specific N+1 trap:
 *       {@code GET /contacts} must not look up a {@code users} row per row, and
 *       §6.1's response carries only the id.</li>
 * </ul>
 *
 * <h2>The transactional-rollback audit for this class</h2>
 *
 * <p>No {@code noRollbackFor} anywhere, re-checked per method rather than
 * assumed (backend/README.md §3's trap, which has bitten this project three
 * times):
 * <ul>
 *   <li>{@link #listContacts} writes nothing;</li>
 *   <li>{@link #createContact} decides every rejection before writing — all of
 *       them in Bean Validation, in fact — and the invite is fired
 *       <strong>last</strong>, after which only response assembly remains and
 *       nothing can throw;</li>
 *   <li>{@link #resendInvite} decides all three of its rejections
 *       ({@code 429}, {@code 404}, {@code 400}) before any write.</li>
 * </ul>
 * Re-check this if a future change here writes an audit row that must survive a
 * rejection.
 */
@Service
public class ContactService {

    private static final Logger log = LoggerFactory.getLogger(ContactService.class);

    /** {@code contacts.initials} is {@code varchar(4)}. */
    private static final int MAX_INITIALS_LENGTH = 4;

    private final ContactRepository contactRepository;
    private final UserRepository userRepository;
    private final ContactInviteService contactInviteService;

    public ContactService(
            ContactRepository contactRepository,
            UserRepository userRepository,
            ContactInviteService contactInviteService,
            EntityInserter entityInserter,
            IdempotentWriteExecutor writeExecutor,
            ChangeLogWriter changeLogWriter) {
        this.contactRepository = contactRepository;
        this.userRepository = userRepository;
        this.contactInviteService = contactInviteService;
        this.entityInserter = entityInserter;
        this.writeExecutor = writeExecutor;
        this.changeLogWriter = changeLogWriter;
    }

    private final EntityInserter entityInserter;
    private final IdempotentWriteExecutor writeExecutor;
    private final ChangeLogWriter changeLogWriter;

    /**
     * {@code GET /api/v1/contacts} (§6.1) — the caller's whole address book.
     *
     * <p><strong>A plain array, not a {@code PageResponse}</strong>: the contract
     * specifies {@code ContactResponse[]}, and the frontend's contact search is a
     * client-side filter over the already-fetched list (ADR 0006), so paginating
     * it would break that search rather than improve anything. Flagged in
     * backend/README.md §15 as the one place this domain departs from
     * constitution §11's "pagination for list endpoints" — the set is bounded by
     * one person's address book, and the same call was already made for
     * {@code GET /categories}.
     *
     * <p>One query, no N+1: {@code linkedUserId} is echoed as an id and never
     * resolved to a user row (V9 contract item 6).
     */
    @Transactional(readOnly = true)
    public List<ContactResponse> listContacts(UUID userId) {
        requireUser(userId);
        return contactRepository.findByOwnerUserIdOrderByNameAscIdAsc(userId).stream()
                .map(ContactService::toResponse)
                .toList();
    }

    /**
     * {@code POST /api/v1/contacts} (§6.2) — create a contact, which may
     * auto-link to a real account <em>or</em> trigger an SMS invite, never both.
     *
     * <p><strong>Auto-link is two independent lookups</strong> (ADR 0015 §2):
     * {@code phone} against {@code users.phone}, {@code email} against
     * {@code users.email}. No shape inference anywhere — that heuristic is
     * exactly what splitting the original {@code phone_or_email} column removed.
     * Phone is tried first because it is the field the invite depends on, so a
     * phone match settles both questions in one query.
     *
     * <p><strong>The response never explains WHY a link did or did not
     * happen</strong> beyond {@code linkedUserId} being set (ADR 0015 §7,
     * security-architecture.md §2). That does let a caller infer "this number is
     * already a MyExpense account" — a real but bounded disclosure, because the
     * only numbers they can ask about are ones they already possess and chose to
     * submit. There is no endpoint that takes an arbitrary phone number and
     * reports back, and this one must never become it.
     */
    public WriteResult<ContactCreatedResponse> createContact(
            UUID userId, CreateContactRequest request, WriteContext context) {
        UUID requestedId = ClientIds.requireNotNil(request.id(), "id");
        // Not @Transactional: IdempotentWriteExecutor owns the boundary (ADR 0027 §4.3).
        // A replay never re-sends an invite.
        return writeExecutor.execute(userId, context,
                IdempotentWriteExecutor.ReplayMatch.of(
                        ChangeLogEntityTypes.CONTACT, ChangeLog.OPERATION_CREATE, requestedId),
                recorded -> WriteResult.created(currentResponse(userId, recorded.getEntityId())),
                () -> doCreateContact(userId, request, requestedId, context));
    }

    private WriteResult<ContactCreatedResponse> doCreateContact(
            UUID userId, CreateContactRequest request, UUID requestedId, WriteContext context) {
        requireUser(userId);

        // ADR 0027 §3.3 step 3: explicit lookup; never save() with a client id.
        if (requestedId != null) {
            Contact existing = contactRepository.findById(requestedId).orElse(null);
            if (existing != null) {
                if (!userId.equals(existing.getOwnerUserId())) {
                    throw new IdConflictException();
                }
                return WriteResult.created(toCreatedResponse(existing, null));
            }
        }
        OffsetDateTime effectiveWriteAt = context.effectiveWriteAt(OffsetDateTime.now(ZoneOffset.UTC));

        // Trimmed before persist, as Domain 3 does: the column is varchar(100)
        // and chk_contacts_name_not_blank rejects a whitespace-only value, which
        // @NotBlank has already caught.
        String name = request.name().trim();
        // Blank -> null for both optional fields. A client that sends "" for an
        // untouched form field means "absent", and an empty string in either
        // column would be a value that renders as nothing, matches nothing, and
        // (for phone) would be a shared cooldown bucket that
        // chk_contact_invites_phone_not_blank exists to refuse.
        String phone = blankToNull(request.phone());
        String email = blankToNull(request.email());

        UUID linkedUserId = resolveLinkedUserId(phone, email);

        // INSERT only (ADR 0027 §3.3): persist, never merge, so a colliding
        // client id fails on contacts_pkey instead of overwriting a row.
        Contact contact = entityInserter.insert(Contact.builder()
                .id(requestedId != null ? requestedId : UUID.randomUUID())
                .ownerUserId(userId)
                .name(name)
                .initials(deriveInitials(name))
                .phone(phone)
                .email(email)
                .linkedUserId(linkedUserId)
                .build());

        // Never the name, the number or the address — a contact's details are
        // personal data (constitution §23). Only ids and shape facts.
        log.info("Contact created for user {} (id={}, hasPhone={}, hasEmail={}, linked={})",
                userId, contact.getId(), phone != null, email != null, linkedUserId != null);

        // Logged BEFORE the invite: a uq_change_log_user_idempotency_key race
        // must fail before the irreversible SMS, so the re-run sends nothing.
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("name", contact.getName());
        fields.put("phone", contact.getPhone());
        fields.put("email", contact.getEmail());
        UUID changeLogId = changeLogWriter.logApplied(userId, ChangeLogEntityTypes.CONTACT, contact.getId(),
                ChangeLog.OPERATION_CREATE, ChangeSets.create(fields), context, effectiveWriteAt, true);
        changeLogWriter.activity(userId, ChangeLogSentences.TYPE_CONTACT_CREATED,
                ChangeLogSentences.CONTACT_CREATED, ChangeLogSentences.contactCreated(contact.getName()),
                ChangeLogWriter.Related.contact(contact.getId()), changeLogId);

        // LAST, deliberately: the SMS is an irreversible side effect and nothing
        // after this point can reject the request. See ContactInviteService's
        // rollback audit.
        Optional<InviteAttempt> attempt = contactInviteService.triggerInviteIfApplicable(userId, contact);
        String inviteStatus = attempt
                .map(InviteAttempt::outcome)
                .map(ContactInviteService::toCreateResponseStatus)
                .orElse(null);

        return WriteResult.created(toCreatedResponse(contact, inviteStatus));
    }

    /** Replay read: the caller's contact in its current state; no invite status. */
    private ContactCreatedResponse currentResponse(UUID userId, UUID contactId) {
        return contactRepository.findById(contactId)
                .filter(contact -> userId.equals(contact.getOwnerUserId()))
                .map(contact -> toCreatedResponse(contact, null))
                .orElseThrow(ContactNotFoundException::notFound);
    }

    /**
     * {@code POST /api/v1/contacts/{id}/invite} (§6.3) — explicitly (re)trigger
     * an invite for an existing contact, owner-scoped.
     *
     * <p>Order of operations, each step deliberate:
     * <ol>
     *   <li><strong>the endpoint's own token buckets first</strong>, so a
     *       throttled caller costs one in-memory lookup and no database work;</li>
     *   <li>the contact resolved owner-scoped — {@code 404 CONTACT_NOT_FOUND}
     *       for unknown <em>and</em> for someone else's;</li>
     *   <li>the send mechanism itself, which applies the same per-phone cooldown
     *       and per-user cap as the implicit trigger. <strong>This endpoint is
     *       not a way to bypass either limit</strong> (ADR 0015 §3) — it is a
     *       second entry point into one mechanism.</li>
     * </ol>
     *
     * <p>Returns {@code 200} with a status for every non-error outcome; the two
     * blocked outcomes additionally carry {@code nextAllowedAt}.
     */
    @Transactional
    public ContactInviteResponse resendInvite(UUID userId, UUID contactId) {
        contactInviteService.enforceExplicitInviteRequestLimits(userId);
        requireUser(userId);

        Contact contact = contactRepository.findByIdAndOwnerUserId(contactId, userId)
                .orElseThrow(ContactNotFoundException::notFound);

        InviteAttempt attempt = contactInviteService.resendInvite(userId, contact);
        return new ContactInviteResponse(attempt.outcome().getValue(), attempt.nextAllowedAt());
    }

    /**
     * §6.2's auto-link: at most two queries, and only for the fields that were
     * actually submitted.
     *
     * <p>A phone match short-circuits the email lookup — not as an optimisation
     * but because the result is the same either way (both would link to a
     * registered account) and one query is enough to decide it.
     *
     * <p>{@code users.email} is stored lowercased by {@code AuthService}, so the
     * probe is lowercased too. The contact's own {@code email} is stored exactly
     * as submitted, so §6.1 echoes what the user typed.
     */
    private UUID resolveLinkedUserId(String phone, String email) {
        if (phone != null) {
            Optional<User> byPhone = userRepository.findByPhone(phone);
            if (byPhone.isPresent()) {
                return byPhone.get().getId();
            }
        }
        if (email != null) {
            Optional<User> byEmail = userRepository.findByEmail(email.toLowerCase(Locale.ROOT));
            if (byEmail.isPresent()) {
                return byEmail.get().getId();
            }
        }
        return null;
    }

    /**
     * "Aditi Sharma" → {@code "AS"}, "Aditi" → {@code "A"} — the first letter of
     * the first word plus the first letter of the last word, uppercased
     * (docs/ui/design-system.md's contact-creation rule, which the frontend's
     * {@code Avatar} already renders against).
     *
     * <p>The input is the already-trimmed, {@code @NotBlank} name, so there is
     * always at least one word and the result is never empty — which is what
     * lets V9 skip a not-blank CHECK on {@code initials} and rely on the one on
     * {@code name} transitively.
     *
     * <p>Code points rather than {@code char}s, and a width guard, because both
     * edge cases are real against a {@code varchar(4)} column: an emoji or a
     * non-BMP letter is a surrogate pair, and uppercasing a single code point can
     * widen it (German {@code ß} → {@code SS}, the ligature {@code ﬄ} →
     * {@code FFL}), so two "letters" can exceed four characters. The truncation
     * never splits a surrogate pair.
     */
    private static String deriveInitials(String name) {
        String[] words = name.split("\\s+");
        String initials = firstCodePointUpperCased(words[0]);
        if (words.length > 1) {
            initials += firstCodePointUpperCased(words[words.length - 1]);
        }
        if (initials.length() <= MAX_INITIALS_LENGTH) {
            return initials;
        }
        int end = MAX_INITIALS_LENGTH;
        if (Character.isHighSurrogate(initials.charAt(end - 1))) {
            end--;
        }
        return initials.substring(0, end);
    }

    private static String firstCodePointUpperCased(String word) {
        if (word.isEmpty()) {
            return "";
        }
        int codePoint = word.codePointAt(0);
        // Locale.ROOT, not the default locale: a server's locale must never
        // decide how a user's initials look (the Turkish dotless-i case is the
        // classic way that goes wrong).
        return new String(Character.toChars(codePoint)).toUpperCase(Locale.ROOT);
    }

    private static String blankToNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
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

    private static ContactResponse toResponse(Contact contact) {
        return new ContactResponse(
                contact.getId(),
                contact.getName(),
                contact.getInitials(),
                contact.getPhone(),
                contact.getEmail(),
                contact.getLinkedUserId(),
                contact.getCreatedAt(),
                contact.getUpdatedAt());
    }

    private static ContactCreatedResponse toCreatedResponse(Contact contact, String inviteStatus) {
        return new ContactCreatedResponse(
                contact.getId(),
                contact.getName(),
                contact.getInitials(),
                contact.getPhone(),
                contact.getEmail(),
                contact.getLinkedUserId(),
                inviteStatus,
                contact.getCreatedAt(),
                contact.getUpdatedAt());
    }
}
