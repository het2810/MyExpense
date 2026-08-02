package com.myexpense.backend.entity;

/**
 * Mirrors the {@code contact_invites.status} vocabulary exactly
 * (data-model.md §4.9, {@code chk_contact_invites_status_valid}):
 * {@code 'queued'} | {@code 'sent'} | {@code 'failed'}. Persisted via
 * {@link ContactInviteStatusConverter}.
 *
 * <p><strong>The vocabulary is closed by a CHECK constraint, and that constraint
 * is load-bearing rather than decorative</strong> (V9's note at the constraint).
 * A mis-cased {@code 'Sent'} would make
 * {@code chk_contact_invites_sent_at_matches_status} read
 * {@code false = (sent_at IS NOT NULL)} and therefore <em>accept</em> a row with
 * {@code sent_at = NULL} — a real SMS that the per-phone cooldown query
 * ({@code WHERE phone = ? AND sent_at >= ?}) would never see, silently granting
 * a free send. This enum is what keeps the literal exact; never write the column
 * from a hand-typed string.
 *
 * <p><strong>A row advances {@link #QUEUED} → {@link #SENT}/{@link #FAILED} and
 * never anywhere else</strong> (ADR 0023 §5.3). That one transition is the only
 * mutation a {@code contact_invites} row ever receives — it is an append-only
 * log of one row per attempt, not a state table — and it is forced into two
 * statements by the {@code sent_at} CHECK: INSERT as {@code queued} with a null
 * {@code sent_at}, then UPDATE to {@code sent} with the gateway's timestamp or
 * to {@code failed} leaving it null.
 *
 * <p>Deliberately <strong>not</strong> the same type as the API's invite
 * <em>outcome</em> ({@code service/InviteOutcome}). This enum is the three
 * states a gateway attempt can be in; that one is the five values
 * api-overview.md §6.3 returns, three of which
 * ({@code cooldown_active}/{@code rate_limited}/{@code already_linked}) describe
 * an attempt that was never made and therefore has no row here at all.
 */
public enum ContactInviteStatus {

    QUEUED("queued"),
    SENT("sent"),
    FAILED("failed");

    private final String value;

    ContactInviteStatus(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /** The exact lowercase column value → enum. Same convention as {@link TransactionScope#fromValue}. */
    public static ContactInviteStatus fromValue(String value) {
        for (ContactInviteStatus status : values()) {
            if (status.value.equals(value)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown contact invite status: " + value);
    }
}
