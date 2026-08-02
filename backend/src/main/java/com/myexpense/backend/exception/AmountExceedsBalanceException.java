package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 400 AMOUNT_EXCEEDS_BALANCE} — api-overview.md §10.1, which replaced
 * {@code AMOUNT_MISMATCH} on 2026-10-02 when partial settlement became legal
 * (ADR 0017 §4).
 *
 * <p><strong>This error has no constraint behind it and never can</strong>
 * ({@code V12} contract item 1, in those words): the outstanding balance lives on
 * {@code group_member_balances} / {@code individual_balances}, and no CHECK can
 * read another table. {@code chk_settlements_amount_positive} holds the
 * {@code > 0} half; this class is the entire {@code <=} half.
 *
 * <p><strong>The rule is "rejected, never clamped, never sign-flipped"</strong>
 * (ADR 0017 §4, restated by {@code V12} contract item 2(b)). An over-amount is
 * refused outright — it is never silently reduced to the outstanding figure, and
 * it is never allowed to push a balance past zero into a reverse debt the
 * settlement itself created.
 *
 * <p><strong>It is also the answer when the caller has no balance row at
 * all</strong> (§10.1's own ruling): outstanding is then {@code 0}, so any
 * positive amount exceeds it, and no separate error code is needed. The same
 * applies when the position has already been settled to {@code 0.00}.
 *
 * <p>For a <strong>group</strong> settlement the bound is the <em>lesser of the
 * two positions</em> — {@code min(|debtor's balance|, creditor's balance)}
 * (ADR 0023 §4, bullet 3) — because paying a creditor more than they are owed
 * would push <em>them</em> into a debt. This one code covers both sides of that
 * bound; which side bound it is not something a client can act on differently.
 *
 * <p>It is raised on two paths that matter equally: from the service's pre-read,
 * and from a bounded {@code UPDATE} that matched zero rows because a concurrent
 * settlement got there first. The second is the race the pre-read cannot cover,
 * and the response is identical.
 */
public class AmountExceedsBalanceException extends ApiException {

    public AmountExceedsBalanceException() {
        super(HttpStatus.BAD_REQUEST, "AMOUNT_EXCEEDS_BALANCE",
                "The settlement amount is greater than the outstanding balance.");
    }
}
