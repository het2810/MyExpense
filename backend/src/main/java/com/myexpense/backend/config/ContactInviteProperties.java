package com.myexpense.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Every tunable of the phone-invite feature (ADR 0015 §4/§6,
 * security-architecture.md §11's strictest row).
 *
 * <p><strong>Four limits, in two layers, and the layering is the whole
 * design.</strong> ADR 0015 §4 is explicit that its two limits are "two
 * genuinely independent checks — do not implement only one and consider the
 * requirement satisfied", and security-architecture.md §11 adds that this
 * endpoint "needs its own stricter limits on top" of the API-wide default tier:
 *
 * <table>
 *   <caption>The four limits and what each one is for</caption>
 *   <tr><th>Limit</th><th>Mechanism</th><th>Scope</th><th>Protects</th></tr>
 *   <tr><td>{@link #perPhoneCooldownHours}</td><td>{@code COUNT(*)} over
 *       {@code contact_invites.sent_at}</td><td>one phone number, across
 *       <em>all</em> callers</td><td>the recipient, who consented to
 *       nothing</td></tr>
 *   <tr><td>{@link #perUserDailyCap} / {@link #perUserWindowHours}</td>
 *       <td>{@code COUNT(*)} over {@code contact_invites.created_at}</td>
 *       <td>one inviting user, all paths combined</td><td>gateway cost and
 *       velocity</td></tr>
 *   <tr><td>{@link #burst}</td><td>token bucket ({@code RateLimiter})</td>
 *       <td>one caller, {@code POST /contacts/{id}/invite} only</td>
 *       <td>request rate — a client loop</td></tr>
 *   <tr><td>{@link #dailyRequests}</td><td>token bucket ({@code RateLimiter})</td>
 *       <td>one caller, {@code POST /contacts/{id}/invite} only</td>
 *       <td>the long window a bucket alone does not give</td></tr>
 * </table>
 *
 * <p><strong>Why the two token buckets are not redundant with the daily cap.</strong>
 * The database counts <em>sends</em>; the buckets count <em>requests</em>. A call
 * to §6.3 that answers {@code already_linked} or {@code cooldown_active} writes
 * no row at all, so it is invisible to the cap while still costing a request —
 * which is exactly the gap the burst bucket closes. {@link #dailyRequests} is
 * set well above {@link #perUserDailyCap} on purpose, so the send cap stays the
 * binding limit on real sends and the bucket only stops abuse of the endpoint
 * itself. The same two-limit shape security-architecture.md §11 specifies for
 * {@code POST /receipts/upload-signature}, and it needs <strong>no new
 * table</strong>: {@code app.ratelimit.auth.register} is already a 5-per-3600 s
 * bucket, so a long window needs no new machinery.
 *
 * <p><strong>Why the buckets are NOT applied to the implicit triggers</strong>
 * ({@code POST /contacts}, {@code POST /groups}, {@code POST /groups/{id}/members}):
 * a bucket rejection is a {@code 429} that fails the whole request, and ADR 0015
 * §4 requires the parent request to succeed regardless of the invite's fate. On
 * those paths the two database limits do the work and a blocked invite simply
 * does not send. The API-wide default tier (120/60 s, {@code ApiRateLimitFilter})
 * still covers them, as it covers every {@code /api/v1/**} path except
 * {@code /api/v1/auth/**} — <strong>no second mechanism is added for them.</strong>
 *
 * <p>Every number here is an <strong>operational tuning knob</strong>, not a
 * correctness-critical constant — the same framing security-architecture.md
 * §5/§11 uses for the lockout parameters — and each is overridable via
 * {@code application.properties}. The defaults are ADR 0015 §4's own recommended
 * orders of magnitude ("on the order of 20 invite-sends per user per day", "e.g.
 * 24 hours" for the cooldown). The {@code Tier} shape is duplicated from
 * {@code ApiRateLimitProperties} rather than extracted, for the reason that
 * class already records: editing Domain 1/2's verified property binding to share
 * a type buys no behaviour. This is the third occurrence, so constitution §25's
 * "duplicate three times → extract" is now due and is flagged in
 * backend/README.md §15 rather than done inside this task's scope.
 */
@ConfigurationProperties(prefix = "app.invites")
@Getter
@Setter
public class ContactInviteProperties {

    /**
     * How long one real-world phone number is in cooldown after a successful
     * send, <strong>regardless of who sent it</strong> (ADR 0015 §4 limit 2).
     * This is the limit that stops five different users each "legitimately"
     * texting one unlucky number within their own allowances.
     */
    private int perPhoneCooldownHours = 24;

    /**
     * How many invite <em>attempts</em> one user may trigger inside
     * {@link #perUserWindowHours} — across contact creation, group writes and
     * explicit resends combined (ADR 0015 §4 limit 1).
     *
     * <p>Counts attempts including failures, deliberately: a user whose sends
     * all fail could otherwise retry without limit (ADR 0023 §5.3).
     */
    private int perUserDailyCap = 20;

    /** The rolling window {@link #perUserDailyCap} is counted over. */
    private int perUserWindowHours = 24;

    /**
     * Short-window request limit for {@code POST /contacts/{id}/invite} — the
     * request-rate control. Generous enough for a real sitting with retries,
     * tight enough to stop a loop in seconds.
     */
    private Tier burst = new Tier(5, 600);

    /**
     * 24-hour request limit for {@code POST /contacts/{id}/invite} — the long
     * window a continuously-refilling bucket alone does not provide (a bucket
     * refilling at 5/600 s permits 720/day).
     */
    private Tier dailyRequests = new Tier(60, 86400);

    /**
     * The app-download link the invite SMS carries. <strong>A configuration
     * value, not a schema or endpoint concern</strong> (ADR 0015 §6) and
     * <strong>not a secret</strong> — which is why it carries a default, unlike
     * {@code JWT_SECRET}/{@code DB_PASSWORD}. A deferred/smart deep-linking
     * service (attribution, "open directly to X") is explicitly out of scope for
     * that ADR; a plain static link is sufficient.
     */
    private String appDownloadLink = "https://myexpense.app/download";

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Tier {
        private int capacity;
        private int windowSeconds;
    }
}
