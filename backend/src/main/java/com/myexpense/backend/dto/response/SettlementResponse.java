package com.myexpense.backend.dto.response;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * {@code SettlementResponse} (api-overview.md §10.1) — returned by
 * {@code POST /api/v1/splits/settle} with {@code 201 Created}.
 *
 * <p><strong>Since ADR 0028 (2026-11-12) it also carries {@code payer} and
 * {@code payee}</strong> (§7.4, additive). The paragraph below is kept as history.
 *
 * <p><strong>This was §10.1's documented shape exactly, with nothing added.</strong>
 * ADR 0023 §4's Consequences list says §10.1's {@code SettlementResponse} changes,
 * but that document's response block is unchanged and still shows these nine
 * fields — so the two counterpart columns the request now carries are
 * <em>deliberately not echoed back</em>. Adding them would be inventing response
 * fields (constitution §15/§30), and a client that just sent the value does not
 * need it returned. Flagged for the System Architect in backend/README.md §16.6
 * alongside the request-side half of the same gap.
 *
 * <h2>{@link #remainingBalance} is the target row's value AFTER this settlement</h2>
 *
 * <p>api-overview.md flags this field as its own addition rather than a Project
 * Owner specification, with the reasoning: under the old full-amount-only rule the
 * post-settlement state was always {@code 0} and therefore inferable, and under
 * partial settlement it no longer is — without it every settle needs an immediate
 * follow-up read just to render "₹250 still outstanding".
 *
 * <p><strong>It is oriented to the CALLER, and that is this implementation's own
 * reading</strong> (flagged in backend/README.md §16.6). §10.1 says "the target
 * balance row's value after this settlement", which is unambiguous for a group
 * target — step 1 defines the target as "the caller's own
 * {@code group_member_balances} row", so it is the caller's residual, exactly like
 * §7.1's {@code yourBalance}. For an <em>individual</em> target the stored value
 * is signed relative to the row's {@code user_id}, which after ADR 0023 §1 is not
 * necessarily the caller — so returning it raw would contradict §8.1's
 * caller-perspective rule and make the same pair read differently on the two
 * endpoints. It is therefore negated here under exactly the same condition §8.1
 * negates under, by the same single method.
 *
 * <p>A full-amount settlement returns exactly {@code 0.00} by arithmetic, not by
 * special-casing; a partial one returns the real residual, <strong>never a
 * forgiven zero</strong> ({@code V12} contract item 2(a)).
 *
 * <p>{@link #initiatedByUserId} records <em>who</em> and authorizes nothing:
 * either party may settle (§10.1), so it is history rather than permission.
 * {@link #settledAt} is when the money moved and {@link #createdAt} is when the
 * row was written — the same instant today only because §10.1 has no back-dating
 * field. No {@code currencyCode}: {@code settlements.currency_code} does not
 * exist.
 */
public record SettlementResponse(
        UUID id,
        UUID groupId,
        UUID individualBalanceId,
        UUID initiatedByUserId,
        BigDecimal amount,
        String method,
        BigDecimal remainingBalance,
        OffsetDateTime settledAt,
        OffsetDateTime createdAt,
        /*
         * ADR 0028 §7.4 (2026-11-12, additive): who paid whom, from the
         * direction the server derived, stored as settlements.initiator_is_payer.
         * null only on settlements recorded before that column existed.
         */
        SettlementPartySummary payer,
        SettlementPartySummary payee) {
}
