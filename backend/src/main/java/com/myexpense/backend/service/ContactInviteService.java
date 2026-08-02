package com.myexpense.backend.service;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.config.ContactInviteProperties;
import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.ContactInvite;
import com.myexpense.backend.entity.ContactInviteStatus;
import com.myexpense.backend.exception.NoPhoneOnContactException;
import com.myexpense.backend.exception.RateLimitExceededException;
import com.myexpense.backend.ratelimit.RateLimiter;
import com.myexpense.backend.repository.ContactInviteRepository;

/**
 * The one place an invite SMS is ever attempted (ADR 0015 §3/§4,
 * api-overview.md §6.2/§6.3/§7.2/§7.4).
 *
 * <p><strong>Four endpoints trigger an invite and all four come through here</strong>
 * — {@code POST /contacts} and the two group writes implicitly,
 * {@code POST /contacts/{id}/invite} explicitly. ADR 0015 §3 describes the
 * explicit endpoint as "simply a second entry point into the same underlying
 * send mechanism", and that is literal: one method does the limits, the ledger
 * row and the gateway call, so there is no second implementation of a rule where
 * the two could drift. A second copy of the cooldown check is how an
 * abuse-prevention rule silently stops applying to one path.
 *
 * <h2>Both limits are checked, and both are load-bearing</h2>
 *
 * <p>ADR 0015 §4 is explicit that a per-user cap and a per-phone cooldown
 * "check different failure modes and are both required", and its Backend
 * follow-up says "do not implement only one and consider the requirement
 * satisfied". Worked through once, here, so nobody has to re-derive it:
 * <ul>
 *   <li>a <strong>per-user cap alone</strong> does nothing to stop five
 *       different users, each with the same number in their address book, from
 *       each spending one invite of their own allowance on it — the recipient
 *       still gets five texts;</li>
 *   <li>a <strong>per-phone cooldown alone</strong> does nothing to stop one
 *       user working through a large contact list rapid-fire, sending genuinely
 *       first-time invites to many different real people — which no single
 *       recipient would object to and which is still a real cost and velocity
 *       risk.</li>
 * </ul>
 *
 * <p>The order they are checked in is deliberate: <strong>the recipient's
 * protection first</strong>. A number in cooldown is answered without consulting
 * — or consuming — anything belonging to the caller.
 *
 * <h2>The two-statement write the schema forces</h2>
 *
 * <p>{@code chk_contact_invites_sent_at_matches_status} enforces
 * {@code (status = 'sent') = (sent_at IS NOT NULL)}, so a row cannot be inserted
 * as {@code 'sent'} before the gateway's timestamp exists. The only shape that
 * satisfies it is INSERT as {@code queued} with a null {@code sent_at}, then
 * UPDATE to {@code sent} with the gateway's time or to {@code failed} leaving it
 * null (V9 contract item 1). {@link #dispatch} does exactly that and nothing
 * else ever writes this table.
 *
 * <p><strong>One row per attempt, never an update of an older row</strong>
 * (ADR 0023 §5.3, Backend follow-up item 7). There is no "find the previous
 * invite for this contact" read anywhere, by design.
 *
 * <h2>The transactional-rollback audit for this class</h2>
 *
 * <p>backend/README.md §3 records how a method that writes and <em>then</em>
 * throws silently broke account lockout and token-family revocation in Domain 1,
 * and ADR 0023 flagged this domain's write paths as the next place that trap
 * waits. <strong>No {@code noRollbackFor} is needed here, and the reason is
 * ordering rather than luck:</strong>
 * <ul>
 *   <li>every rejection — {@code 429}, {@code 400 NO_PHONE_ON_CONTACT},
 *       {@code already_linked}, {@code cooldown_active}, {@code rate_limited} —
 *       is decided <strong>before</strong> the insert, and four of the five are
 *       not exceptions at all;</li>
 *   <li>after the insert, the only throw possible is a database failure from the
 *       insert or the update itself, and for that case <strong>a rollback is
 *       exactly what must happen</strong> — a {@code queued} row that never
 *       advances would be a permanent lie about an SMS nobody sent;</li>
 *   <li>the gateway call cannot propagate: a {@link RuntimeException} from it is
 *       caught and recorded as {@code failed}, which is ADR 0015 §4's
 *       fail-gracefully requirement ("a contact must never fail to be created
 *       merely because a downstream SMS provider had a bad moment").</li>
 * </ul>
 *
 * <p><strong>The residual risk, stated rather than hidden.</strong> A real SMS
 * is an irreversible side effect inside a transaction: if the surrounding
 * transaction rolls back <em>after</em> a successful send, the ledger row
 * disappears while the text is already delivered — so the recipient's cooldown
 * is lost and they could be texted again sooner than the rule intends. Every
 * caller therefore fires invites <strong>last</strong>, after the final
 * validation and the final assertion, so no application-level rejection can
 * follow a send; what remains is a commit-time failure, which no ordering can
 * fix. The honest fix is to dispatch after commit from an outbox row, and it is
 * flagged in backend/README.md §15 as a follow-up rather than improvised here.
 *
 * <p>This class is annotated {@link Propagation#MANDATORY} rather than
 * {@code REQUIRED} on purpose: V9 contract item 2 requires both limits to be
 * evaluated "INSIDE the same transaction as the insert", and MANDATORY makes a
 * caller that forgot a transaction fail loudly instead of running the limit
 * checks in three separate auto-commit transactions.
 */
@Service
public class ContactInviteService {

    private static final Logger log = LoggerFactory.getLogger(ContactInviteService.class);

    /** FNV-1a 64-bit offset basis and prime — see {@link #phoneLockKey}. */
    private static final long FNV_OFFSET_BASIS = 0xcbf29ce484222325L;
    private static final long FNV_PRIME = 0x100000001b3L;

    private final ContactInviteRepository inviteRepository;
    private final SmsInviteGateway smsInviteGateway;
    private final RateLimiter rateLimiter;
    private final ContactInviteProperties properties;

    public ContactInviteService(
            ContactInviteRepository inviteRepository,
            SmsInviteGateway smsInviteGateway,
            RateLimiter rateLimiter,
            ContactInviteProperties properties) {
        this.inviteRepository = inviteRepository;
        this.smsInviteGateway = smsInviteGateway;
        this.rateLimiter = rateLimiter;
        this.properties = properties;
    }

    /**
     * The endpoint-level token buckets for {@code POST /contacts/{id}/invite}
     * (security-architecture.md §11: "the strictest bucket parameters in the
     * whole API", layered on top of the default per-user tier rather than
     * replacing it).
     *
     * <p><strong>Two buckets, both required</strong>, for the reason
     * {@link ContactInviteProperties} sets out: the short one is the request-rate
     * control, the 24-hour one is the long window a continuously-refilling bucket
     * does not give. Keyed by the authenticated principal, never by IP — one user
     * legitimately moves between networks (§11's default-tier reasoning) — and
     * keyed per <em>operation</em>, following {@code AuthService}'s own
     * {@code account:<scope>:<email>} convention so this endpoint's budget cannot
     * be spent by, or spend, any other endpoint's.
     *
     * <p>Deliberately called <strong>before</strong> anything is read or written,
     * so a throttled caller costs one map lookup. Equally deliberately
     * <strong>not</strong> called by the implicit triggers: a {@code 429} there
     * would fail a contact creation or a group write because of an invite, which
     * ADR 0015 §4 forbids.
     *
     * @throws RateLimitExceededException {@code 429 RATE_LIMIT_EXCEEDED}
     */
    public void enforceExplicitInviteRequestLimits(UUID userId) {
        consumeOrReject("invite-burst", userId, properties.getBurst());
        consumeOrReject("invite-daily", userId, properties.getDailyRequests());
    }

    /**
     * The <strong>implicit</strong> trigger — {@code POST /contacts} (§6.2) and
     * the two group write paths (§7.2/§7.4).
     *
     * <p>Returns {@link Optional#empty()} for the two cases §6.2 calls "no invite
     * was applicable" and therefore reports as {@code inviteStatus: null}:
     * <ul>
     *   <li><strong>no phone</strong> on the contact — there is nothing to text,
     *       and (unlike §6.3) it is not an error, because the caller did not ask
     *       for an invite;</li>
     *   <li><strong>the contact is linked</strong> to a registered account —
     *       there is nobody to invite.</li>
     * </ul>
     *
     * <p><strong>"Linked" is read from {@code linked_user_id}, not from the phone
     * lookup, and that resolves a real ambiguity in the contract</strong> —
     * flagged in backend/README.md §15. §6.2's prose conditions the invite on
     * "{@code phone} is present and does not match any {@code users.phone}",
     * which read literally would text a contact that auto-linked by
     * <em>email</em> and happens to carry an unmatched number. The narrower rule
     * is used because §6.3's own {@code already_linked} outcome is about the
     * contact being linked rather than about the phone, because ADR 0015 §3's
     * parenthetical is "(no auto-link)", and because the conservative direction
     * is the right default for a mechanism that texts an uninvolved third party.
     *
     * <p>Never throws for an invite-related reason: a failure is reported as
     * {@link InviteOutcome#FAILED}, and a blocked attempt as one of the two
     * blocked outcomes.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<InviteAttempt> triggerInviteIfApplicable(UUID userId, Contact contact) {
        if (contact.getLinkedUserId() != null) {
            return Optional.empty();
        }
        String phone = contact.getPhone();
        if (phone == null || phone.isBlank()) {
            return Optional.empty();
        }
        return Optional.of(dispatch(userId, contact, phone));
    }

    /**
     * The <strong>explicit</strong> resend — {@code POST /contacts/{id}/invite}
     * (§6.3). "The manual counterpart to §6.2's implicit on-create trigger, for a
     * first attempt that failed or a reminder send", and it
     * <strong>does not bypass either limit</strong> (ADR 0015 §3).
     *
     * <p>The same two "not applicable" conditions are reported differently here,
     * because this caller explicitly asked for a send:
     * <ul>
     *   <li>no phone → {@code 400 NO_PHONE_ON_CONTACT} (§6.3's own error),
     *       thrown <strong>before</strong> any write so the clean error is not
     *       dependent on {@code chk_contact_invites_phone_not_blank}, whose
     *       honest answer would be a {@code 500};</li>
     *   <li>linked → {@code 200} with {@link InviteOutcome#ALREADY_LINKED}, not
     *       an error: the request was legal and the answer is informative.</li>
     * </ul>
     *
     * <p>The contact must already have been resolved as the caller's own —
     * {@code ContactService} does that and answers
     * {@code 404 CONTACT_NOT_FOUND} otherwise, so this method never sees another
     * user's row.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public InviteAttempt resendInvite(UUID userId, Contact contact) {
        if (contact.getLinkedUserId() != null) {
            return InviteAttempt.of(InviteOutcome.ALREADY_LINKED);
        }
        String phone = contact.getPhone();
        if (phone == null || phone.isBlank()) {
            throw new NoPhoneOnContactException();
        }
        return dispatch(userId, contact, phone);
    }

    /**
     * Folds a five-value outcome into the four values §6.2's
     * {@code inviteStatus} is allowed to carry
     * ({@code 'sent' | 'failed' | 'cooldown_active' | null}).
     *
     * <p><strong>{@link InviteOutcome#RATE_LIMITED} is reported as
     * {@code cooldown_active} on that endpoint, and this is a known contract
     * gap rather than a preference</strong> — flagged in backend/README.md §15
     * with a recommendation to add {@code 'rate_limited'} to §6.2's enumeration.
     * §6.2 predates nothing; it simply lists one fewer value than §6.3 while the
     * per-user cap can block either path. Of the three available answers:
     * <ul>
     *   <li><strong>{@code cooldown_active}</strong> — chosen. It never claims a
     *       send happened, it means "not sent now, try later", and that is the
     *       only one of §6.2's four values with that meaning;</li>
     *   <li>{@code 'failed'} — rejected: a client reads it as "retry now", and
     *       retrying is precisely what will be refused again. It would also
     *       disagree with the ledger, which has no row for a blocked attempt;</li>
     *   <li>{@code null} — rejected: it means "no invite was applicable", and an
     *       invite very much was.</li>
     * </ul>
     * {@link InviteOutcome#ALREADY_LINKED} cannot reach here —
     * {@link #triggerInviteIfApplicable} returns empty for it, which §6.2 maps to
     * {@code null} exactly as specified.
     */
    public static String toCreateResponseStatus(InviteOutcome outcome) {
        if (outcome == InviteOutcome.RATE_LIMITED) {
            return InviteOutcome.COOLDOWN_ACTIVE.getValue();
        }
        return outcome.getValue();
    }

    /**
     * Both limits, then the ledger row, then the gateway, then the status
     * advance. The only method in the backend that writes
     * {@code contact_invites}.
     */
    private InviteAttempt dispatch(UUID userId, Contact contact, String phone) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        Duration cooldown = Duration.ofHours(properties.getPerPhoneCooldownHours());

        // -------------------------------------------------------------------
        // LIMIT 1 of 2 — the cross-user per-phone cooldown (ADR 0015 §4). The
        // recipient's protection, checked first and independently of who is
        // asking.
        //
        // The advisory lock closes the one window a same-transaction COUNT(*)
        // cannot: under READ COMMITTED two concurrent requests both see zero
        // rows, and V9 forbids the unique constraint that would otherwise
        // arbitrate (two attempts to one number are the normal case these
        // limits exist to BOUND, not to forbid). A false answer means another
        // transaction is mid-send to this very number, which for cooldown
        // purposes IS cooldown_active.
        // -------------------------------------------------------------------
        if (!inviteRepository.tryLockPhone(phoneLockKey(phone))) {
            log.info("Invite to contact {} skipped: a concurrent send to the same number is in flight",
                    contact.getId());
            // An upper bound, not a read value: the competing send's own
            // timestamp is not committed anywhere this transaction can see.
            return InviteAttempt.blocked(InviteOutcome.COOLDOWN_ACTIVE, now.plus(cooldown));
        }

        OffsetDateTime cooldownSince = now.minus(cooldown);
        if (inviteRepository.countSendsToPhoneSince(phone, cooldownSince) > 0) {
            OffsetDateTime nextAllowedAt = inviteRepository.findLatestSendToPhone(phone)
                    .map(latest -> latest.plus(cooldown))
                    .orElseGet(() -> now.plus(cooldown));
            log.info("Invite to contact {} skipped: destination number is in cooldown until {}",
                    contact.getId(), nextAllowedAt);
            return InviteAttempt.blocked(InviteOutcome.COOLDOWN_ACTIVE, nextAllowedAt);
        }

        // -------------------------------------------------------------------
        // LIMIT 2 of 2 — the per-inviting-user rolling-window cap
        // (ADR 0015 §4). Counts ATTEMPTS, including failures: a user whose
        // sends all fail must not be able to retry without limit.
        // -------------------------------------------------------------------
        Duration userWindow = Duration.ofHours(properties.getPerUserWindowHours());
        OffsetDateTime windowStart = now.minus(userWindow);
        long attemptsInWindow = inviteRepository.countAttemptsByUserSince(userId, windowStart);
        if (attemptsInWindow >= properties.getPerUserDailyCap()) {
            OffsetDateTime nextAllowedAt = inviteRepository
                    .findOldestAttemptByUserSince(userId, windowStart)
                    .map(oldest -> oldest.plus(userWindow))
                    .orElseGet(() -> now.plus(userWindow));
            log.info("Invite by user {} skipped: {} attempts in the window, cap is {}, next slot at {}",
                    userId, attemptsInWindow, properties.getPerUserDailyCap(), nextAllowedAt);
            return InviteAttempt.blocked(InviteOutcome.RATE_LIMITED, nextAllowedAt);
        }

        // -------------------------------------------------------------------
        // STATEMENT 1 of 2 — INSERT as `queued` with a NULL sent_at. The CHECK
        // permits no other first statement.
        // -------------------------------------------------------------------
        ContactInvite invite = inviteRepository.saveAndFlush(ContactInvite.builder()
                .id(UUID.randomUUID())
                .contactId(contact.getId())
                .invitedByUserId(userId)
                .phone(phone)
                .status(ContactInviteStatus.QUEUED)
                // Explicit, so the invariant is visible here rather than
                // inferred from the field's default: a non-null value at this
                // point would violate the CHECK.
                .sentAt(null)
                .build());

        // -------------------------------------------------------------------
        // The gateway. A third-party client is not taken on trust: anything it
        // throws becomes a recorded failure rather than a failed request.
        // -------------------------------------------------------------------
        SmsDispatchResult result;
        try {
            result = smsInviteGateway.sendAppDownloadInvite(phone);
        } catch (RuntimeException ex) {
            // The exception, not the number. Logged at WARN rather than ERROR:
            // a gateway having a bad moment is an expected operational event
            // with a defined recovery (§6.3), not an unexpected exception.
            log.warn("Invite gateway threw for invite {}; recording the attempt as failed", invite.getId(), ex);
            result = SmsDispatchResult.failed();
        }

        // -------------------------------------------------------------------
        // STATEMENT 2 of 2 — advance the row. `sent` carries the gateway's own
        // timestamp; `failed` leaves sent_at null, so no cooldown starts for a
        // text that never arrived.
        // -------------------------------------------------------------------
        if (result.dispatched()) {
            invite.setStatus(ContactInviteStatus.SENT);
            invite.setSentAt(result.dispatchedAt());
        } else {
            invite.setStatus(ContactInviteStatus.FAILED);
            invite.setSentAt(null);
        }
        inviteRepository.saveAndFlush(invite);

        InviteOutcome outcome = result.dispatched() ? InviteOutcome.SENT : InviteOutcome.FAILED;
        // Ids and the outcome only — never the number (constitution §23).
        log.info("Invite attempt {} for contact {} by user {} finished as {}",
                invite.getId(), contact.getId(), userId, outcome.getValue());
        return InviteAttempt.of(outcome);
    }

    private void consumeOrReject(String scope, UUID userId, ContactInviteProperties.Tier tier) {
        String key = scope + ":" + userId;
        boolean allowed = rateLimiter.tryConsume(
                key, tier.getCapacity(), Duration.ofSeconds(tier.getWindowSeconds()));
        if (!allowed) {
            log.info("Invite request rejected for user {} by the {} limit", userId, scope);
            throw new RateLimitExceededException();
        }
    }

    /**
     * A stable 64-bit key for one phone number, for
     * {@link ContactInviteRepository#tryLockPhone}.
     *
     * <p>FNV-1a over the UTF-8 bytes: six lines, no dependency, and a full
     * 64-bit output. Chosen over {@code String#hashCode()} (only 32 bits, so
     * collisions between unrelated numbers would be far likelier) and over
     * PostgreSQL's {@code hashtext()} (an undocumented server function whose
     * value could change between major versions, which would silently change
     * which numbers share a lock).
     *
     * <p>A collision is harmless in the safe direction: two different numbers
     * mapping to one key can only cause a spurious {@code cooldown_active} while
     * the other send is in flight, never a missed cooldown. It cannot cause a
     * wrong {@code COUNT(*)} — the counts query {@code phone} itself.
     */
    private static long phoneLockKey(String phone) {
        long hash = FNV_OFFSET_BASIS;
        for (byte b : phone.getBytes(StandardCharsets.UTF_8)) {
            hash ^= (b & 0xff);
            hash *= FNV_PRIME;
        }
        return hash;
    }
}
