package com.myexpense.backend.service;

/**
 * The five invite outcomes {@code POST /api/v1/contacts/{id}/invite} returns
 * (api-overview.md §6.3). <strong>These are the service's own vocabulary and
 * appear nowhere in the schema</strong> (V9 contract item 2) — only three of
 * them correspond to a {@code contact_invites} row at all.
 *
 * <table>
 *   <caption>What each outcome means and whether a row exists</caption>
 *   <tr><th>Outcome</th><th>Row written</th><th>Meaning</th></tr>
 *   <tr><td>{@link #SENT}</td><td>yes, {@code status='sent'}</td>
 *       <td>the gateway accepted it; {@code sent_at} holds its timestamp and
 *           starts the recipient's cooldown</td></tr>
 *   <tr><td>{@link #FAILED}</td><td>yes, {@code status='failed'}</td>
 *       <td>the gateway rejected or errored; {@code sent_at} stays
 *           {@code null}, so no cooldown starts and a resend is the right next
 *           action</td></tr>
 *   <tr><td>{@link #COOLDOWN_ACTIVE}</td><td>no</td>
 *       <td>this phone number was texted recently — <em>by anyone</em></td></tr>
 *   <tr><td>{@link #RATE_LIMITED}</td><td>no</td>
 *       <td>this caller has used their rolling-window send allowance</td></tr>
 *   <tr><td>{@link #ALREADY_LINKED}</td><td>no</td>
 *       <td>the contact is already a registered account; there is nobody to
 *           invite</td></tr>
 * </table>
 *
 * <p><strong>A blocked attempt deliberately writes no row</strong>, which is
 * this file's one derived decision (flagged in backend/README.md §15): a row in
 * {@code contact_invites} records a dispatch attempt <em>made to the
 * gateway</em>, and the three non-row outcomes never reached it. Writing one
 * would also be self-defeating — the per-user cap counts rows, so a
 * cap-blocked call would consume the very allowance it was refused.
 *
 * <p><strong>{@link #FAILED} is not in that group.</strong> A failed attempt
 * <em>does</em> write a row, because ADR 0023 §5.3 is explicit that the daily cap
 * "must count ATTEMPTS, including failures, or a user whose sends all fail could
 * retry without limit".
 *
 * <p>{@link #carriesNextAllowedAt()} encodes §6.3's own rule — "populated only
 * when {@code status='cooldown_active'} or {@code 'rate_limited'}" — in one place
 * rather than as an {@code if} at each call site.
 */
public enum InviteOutcome {

    SENT("sent", false),
    FAILED("failed", false),
    COOLDOWN_ACTIVE("cooldown_active", true),
    RATE_LIMITED("rate_limited", true),
    ALREADY_LINKED("already_linked", false);

    private final String value;
    private final boolean carriesNextAllowedAt;

    InviteOutcome(String value, boolean carriesNextAllowedAt) {
        this.value = value;
        this.carriesNextAllowedAt = carriesNextAllowedAt;
    }

    /** The exact wire value (api-overview.md §6.2/§6.3). */
    public String getValue() {
        return value;
    }

    /** {@code true} only for the two outcomes §6.3 pairs with a {@code nextAllowedAt}. */
    public boolean carriesNextAllowedAt() {
        return carriesNextAllowedAt;
    }
}
