package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 404 INDIVIDUAL_BALANCE_NOT_FOUND} — api-overview.md §9.1/§9.3/§10.1.
 *
 * <p><strong>Returned both when the pairwise balance does not exist and when it
 * exists but the caller is not a party to it</strong> — identically, never a
 * {@code 403}. This is the pairwise form of the membership-gated rule
 * {@link GroupNotFoundException} documents, and ADR 0023 §1.4 is where the check
 * finally has a definition: the API's §2 convention has always said
 * "membership-gated" means "is the caller a member of this group <em>/ a party to
 * this pair</em>", and until §8.1 was corrected nothing used the second half.
 *
 * <p><strong>"A party to this pair" means {@code user_id = caller} OR
 * {@code counterpart_user_id = caller}</strong>, which on a private contact row
 * collapses to "the caller is the owner". Checking only {@code user_id} is the
 * bug ADR 0023 §1.4 fixed — it would hide a debt someone else recorded against
 * the caller, which made the shared ledger invisible to one of its two parties.
 *
 * <p>{@code V11} maps {@code fk_split_expenses_individual_balance_id} and
 * {@code V12} maps {@code fk_settlements_individual_balance_id} onto this same
 * code. Both are backstops: the service resolves the row and proves the caller is
 * a party before either insert, so a legal request never reaches them.
 */
public class IndividualBalanceNotFoundException extends ApiException {

    public IndividualBalanceNotFoundException() {
        super(HttpStatus.NOT_FOUND, "INDIVIDUAL_BALANCE_NOT_FOUND", "Individual balance not found.");
    }
}
