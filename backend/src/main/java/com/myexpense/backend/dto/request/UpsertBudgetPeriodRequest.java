package com.myexpense.backend.dto.request;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code PUT /api/v1/budget/periods} (api-overview.md §5.2) —
 * the upsert that edits a period in place when {@code id} is supplied and
 * inserts a new one when it is not, matching the frontend's {@code setPeriod}
 * semantics at the contract level (data-model.md §3.1).
 *
 * <p>A record, like {@link CreateSplitExpenseRequest}: this is a {@code PUT},
 * not a {@code PATCH}, so there is no "field omitted vs. explicitly null"
 * distinction to preserve — every field means what it says, every time.
 *
 * <h2>What this body deliberately does NOT carry</h2>
 *
 * <p><strong>No {@code userId}.</strong> The owner comes from the verified JWT
 * via {@code @CurrentUserId} and never from a request field
 * (security-architecture.md §2) — a {@code userId} here would be an
 * account-takeover field.
 *
 * <p><strong>No {@code categoryCaps[].categoryName}.</strong> Server-resolved
 * and snapshotted — see {@link BudgetCategoryCapRequest}.
 *
 * <p><strong>No {@code currencyCode}, and no {@code clientId}.</strong> Currency
 * is a display symbol only and appears exactly once in this API, on §2.1's
 * {@code defaultCurrencyCode} (ADR 0017's Scope Narrowing banner).
 * {@code budget_periods} has no {@code client_id} column either — whether a
 * budget period becomes an offline-syncable entity is a Domain 8 ruling
 * ({@code V14}'s own note), and accepting a value with nowhere to go would
 * pre-empt it.
 *
 * <h2>Which rules are NOT here</h2>
 *
 * <p>Bean Validation constrains one field at a time (plus the one derived
 * cross-field property below). Everything that needs a database lookup or
 * another row lives in {@code BudgetService}: the non-overlap rule
 * ({@code 400 PERIOD_OVERLAP}), category ownership
 * ({@code 404 CATEGORY_NOT_FOUND}), top-level-only caps and the
 * duplicate-category check. That split is deliberate and matches Domain 4 and
 * Domain 6 exactly.
 */
public record UpsertBudgetPeriodRequest(

        /*
         * Contract: "uuid, optional — present to edit an existing period in
         * place; absent to create a new period".
         *
         * Not @NotNull, obviously, and equally not validated against anything
         * here: whether it is one of the CALLER'S periods is an owner-scoped
         * lookup (404 BUDGET_PERIOD_NOT_FOUND, never 403). A malformed uuid is a
         * 400 from the message converter before this record is ever built.
         */
        UUID id,

        /*
         * Contract: "'automatic' | 'custom', required" (ADR 0010 §2's PERIOD
         * control).
         *
         * *** THIS @Pattern IS THE ONLY VOCABULARY GUARD THAT EXISTS. *** V14
         * deliberately puts no CHECK on period_type, having applied V7's test:
         * a vocabulary CHECK earns its place when another constraint keys off
         * the literal or when the column partitions money, and neither is true
         * here. So an out-of-vocabulary value produces no silent arithmetic — but
         * it would be stored and then rendered, which is why it is rejected
         * here.
         *
         * A validated String rather than an enum, for the reason
         * ListTransactionsQuery records: Jackson's enum binding is case-sensitive
         * on the CONSTANT name ('AUTOMATIC'), while the contract's values are
         * lowercase. Validating the exact contract literal keeps the accepted
         * vocabulary identical to the documented one.
         */
        @NotBlank
        @Pattern(regexp = "automatic|custom", message = "must be 'automatic' or 'custom'")
        String periodType,

        /*
         * Contract: "YYYY-MM-DD, required". Jackson parses the ISO form into
         * LocalDate; a malformed value is a 400 from the message converter, not
         * a silent null.
         *
         * No future-date restriction on either bound, deliberately: a budget
         * period is legitimately future-facing — you set next month's budget in
         * advance — and ADR 0010 §2 states exactly that ("No maximumDate
         * restriction on either field, unlike Add Expense's date picker").
         * Inventing a bound would reject input the contract accepts.
         */
        @NotNull
        LocalDate startDate,

        /*
         * Contract: "YYYY-MM-DD, required". INCLUSIVE, like startDate: V14's
         * range bounds are '[]' and the client's own "has it ended" test is
         * endDate < today.
         */
        @NotNull
        LocalDate endDate,

        /*
         * Contract: "number, required, > 0", matched exactly by
         * chk_budget_periods_amount_positive. @Digits matches numeric(12,2),
         * which is what keeps "spent vs budget" exact decimal arithmetic rather
         * than approximate (V14 contract item 5).
         */
        @NotNull
        @DecimalMin(value = "0", inclusive = false)
        @Digits(integer = 10, fraction = 2)
        BigDecimal amount,

        /*
         * Contract: the per-category caps saved WITH this period.
         *
         * *** THIS ARRAY IS THE COMPLETE NEW SET, NOT A DELTA *** (V14 contract
         * item 3). On an edit the period's existing cap rows are REPLACED by
         * it, because §3.2's omission-over-null-entry convention means "a
         * category absent from the array has no cap for that period". An empty
         * array therefore legitimately means "this period caps nothing".
         *
         * OMITTING THE KEY IS TREATED AS AN EMPTY ARRAY, which is the correct
         * reading of a PUT (full replacement) rather than a lenient one — see
         * #categoryCapsOrEmpty(). It is NOT @NotNull because §5.2 marks this
         * field neither required nor optional, and rejecting an omission would
         * reject a request the contract does not forbid. The consequence is
         * stated plainly in backend/README.md §18.5 so a client cannot discover
         * it: on an edit, omitting the key CLEARS the period's caps.
         *
         * @Valid propagates each entry's own constraints — without it the nested
         * record's @NotNull/@DecimalMin/@Digits are silently ignored, which is
         * the classic Bean Validation omission.
         *
         * THE SIZE CAP IS A DERIVED BOUND, NOT A CONTRACT FIGURE, and is flagged
         * in backend/README.md §18.5. §5.2 states no maximum. 100 bounds the one
         * request in this domain that writes an unbounded number of rows, and it
         * is far above any plausible category list (registration seeds 8), so it
         * can never bind a legitimate request. The duplicate-category rule makes
         * the real ceiling "one per category" anyway.
         */
        @Size(max = 100)
        List<@NotNull @Valid BudgetCategoryCapRequest> categoryCaps) {

    /**
     * {@code endDate >= startDate}, reported through the same
     * {@code fieldErrors} shape as every single-field failure and needing no new
     * exception type — the pattern {@code CategoryStatisticsQuery} established
     * for its own reversed-range rule. The property's name
     * ({@code dateRangeValid}) is what appears in {@code fieldErrors[].field};
     * the message carries the instruction.
     *
     * <p><strong>This rule is load-bearing rather than cosmetic.</strong>
     * {@code V14}'s exclusion constraint evaluates
     * {@code daterange(start_date, end_date, '[]')} on every row, and
     * {@code daterange()} <em>raises</em> on a reversed range with
     * {@code SQLSTATE 22000} and <strong>no constraint name</strong> — an error
     * nothing can translate into a client response.
     * {@code chk_budget_periods_date_order} fires first and is named, and
     * {@code BudgetService} re-checks before writing, so there are three guards;
     * this is the one that produces a good error message.
     *
     * <p>A single-day period is legal ({@code >=}, not {@code >}): unusual, but
     * nothing in §5.2 or ADR 0010 §5 forbids it, and the CHECK permits it.
     *
     * <p>A {@code null} bound is not reported here — {@code @NotNull} on each
     * field already covers that, and reporting it twice would put two errors in
     * {@code fieldErrors} for one mistake.
     */
    @AssertTrue(message = "endDate must not be earlier than startDate")
    public boolean isDateRangeValid() {
        return startDate == null || endDate == null || !endDate.isBefore(startDate);
    }

    /**
     * {@link #categoryCaps} with an omitted array read as an empty one, so the
     * service has exactly one shape to handle.
     *
     * <p>Not a lenience: a {@code PUT} replaces the resource, so "no caps
     * stated" means "this period has no caps". The alternative — treating an
     * omission as "leave the existing caps alone" — would smuggle {@code PATCH}
     * semantics into a {@code PUT} and make the array's meaning depend on
     * whether the period already existed.
     */
    public List<BudgetCategoryCapRequest> categoryCapsOrEmpty() {
        return categoryCaps == null ? List.of() : categoryCaps;
    }
}
