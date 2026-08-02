package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 400 VALIDATION_ERROR} for the cross-field and cross-table business rules
 * of {@code POST /split-expenses} (§9.1), {@code GET /split-expenses} (§9.3) and
 * {@code POST /splits/settle} (§10.1) that Bean Validation cannot express on a
 * single field (security-architecture.md §3).
 *
 * <p>One parameterized class with a named factory per condition, exactly as
 * {@link TransactionRuleViolationException} already does for Domain 4 and for the
 * same reason: a dozen classes differing only in a message string, all carrying
 * the identical status and error code, is the duplication constitution §25 asks
 * to extract. The factory keeps each rule's name at the throw site, and keeps
 * every message in one place where they can be compared for consistency.
 *
 * <p><strong>Every one of these is the contract's generic
 * {@code VALIDATION_ERROR}</strong>, which is §9.1's and §10.1's own choice —
 * each error table lists exactly one {@code 400} row. Inventing codes they do not
 * define would be inventing contract (constitution §15/§30). Where a dedicated
 * code <em>is</em> specified, a dedicated class exists instead
 * ({@link AmountExceedsBalanceException}, {@link IndividualBalanceNotFoundException},
 * {@link SplitExpenseNotFoundException}, {@link GroupNotFoundException},
 * {@link CategoryNotFoundException}, {@link ContactNotFoundException}).
 *
 * <p>No {@code fieldErrors} on the response, matching every other
 * {@code VALIDATION_ERROR} produced outside Bean Validation: each rule below
 * spans two or more fields, so attributing it to one would be arbitrary.
 *
 * <h2>Relationship to {@code V11}/{@code V12}'s CHECK constraints</h2>
 *
 * <p>Several of these rules are <em>also</em> enforced declaratively —
 * {@code chk_split_expenses_target_matches_mode},
 * {@code chk_split_expenses_paid_by_user_xor_contact},
 * {@code chk_settlements_target_xor},
 * {@code chk_settlements_counterpart_matches_target}. Reaching one of those means
 * a rule here was skipped, which surfaces as a logged {@code 500} rather than a
 * plausible-looking {@code 400}: the honest outcome, and the same arrangement
 * {@code CategoryService} and {@code GroupService} already document. Three of
 * these rules have <strong>no</strong> declarative backstop at all — the
 * participant sum, the membership of each participant, and the derived settlement
 * direction — so for those this class is the only enforcement that exists.
 */
public class SplitRuleViolationException extends ApiException {

    private SplitRuleViolationException(String message) {
        super(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
    }

    // ---------------------------------------------------------------------
    // §9.1 — request shape
    // ---------------------------------------------------------------------

    /** {@code splitMode='group'} with no {@code groupId} — the contract's "required iff". */
    public static SplitRuleViolationException groupIdRequiredForGroupMode() {
        return new SplitRuleViolationException(
                "groupId is required when splitMode is 'group'.");
    }

    /**
     * {@code groupId} supplied with {@code splitMode='individual'} — the other
     * direction of the same iff, and the half
     * {@code chk_split_expenses_target_matches_mode} makes structural: without
     * it an individual split could also carry a group, and the write path would
     * have two places to land one balance impact.
     */
    public static SplitRuleViolationException groupIdNotAllowedForIndividualMode() {
        return new SplitRuleViolationException(
                "groupId must be omitted when splitMode is 'individual'.");
    }

    /** {@code splitMode='individual'} with no {@code individualCounterpartContactId}. */
    public static SplitRuleViolationException counterpartContactRequiredForIndividualMode() {
        return new SplitRuleViolationException(
                "individualCounterpartContactId is required when splitMode is 'individual'.");
    }

    /** {@code individualCounterpartContactId} supplied with {@code splitMode='group'}. */
    public static SplitRuleViolationException counterpartContactNotAllowedForGroupMode() {
        return new SplitRuleViolationException(
                "individualCounterpartContactId must be omitted when splitMode is 'group'.");
    }

    /**
     * ADR 0026 §5.1 C1: individual mode with <strong>both</strong>
     * {@code individualCounterpartContactId} and
     * {@code individualCounterpartContactIds}. Two counterpart forms in one
     * request would leave the server to guess which one is true.
     */
    public static SplitRuleViolationException counterpartFormsAreMutuallyExclusive() {
        return new SplitRuleViolationException(
                "Provide either individualCounterpartContactId or individualCounterpartContactIds, not both.");
    }

    /** ADR 0026 §5.1 C4: {@code individualCounterpartContactIds} supplied with {@code splitMode='group'}. */
    public static SplitRuleViolationException counterpartContactsNotAllowedForGroupMode() {
        return new SplitRuleViolationException(
                "individualCounterpartContactIds must be omitted when splitMode is 'group'.");
    }

    /**
     * ADR 0026 §5.1 C6: the same contact id twice in
     * {@code individualCounterpartContactIds}, <strong>or</strong> two selected
     * contacts linked to the same registered user. Both resolve to one pair row,
     * so they are one person.
     *
     * <p>A rejection, not a merge (ADR 0026 §5.1, derived): merging would leave the
     * participant and payer entries ambiguous and would hide an address-book
     * duplicate the user should fix.
     * {@code uq_split_expense_individual_balances_expense_balance} is the
     * backstop and maps to a logged {@code 500}, never a {@code 409}.
     */
    public static SplitRuleViolationException duplicateCounterpart() {
        return new SplitRuleViolationException(
                "The same person is listed more than once in individualCounterpartContactIds.");
    }

    /**
     * Neither or both of {@code paidByUserId}/{@code paidByContactId} —
     * §9.1's "exactly one of paidByUserId/paidByContactId required", matched by
     * {@code chk_split_expenses_paid_by_user_xor_contact}.
     *
     * <p>Since ADR 0025 (§5.1 R1b) this fires only when {@code payers} is absent
     * or {@code null}, i.e. when the legacy form is the one in use. Its message is
     * unchanged on purpose, so existing clients see the same text.
     */
    public static SplitRuleViolationException exactlyOnePayerRequired() {
        return new SplitRuleViolationException(
                "Exactly one of paidByUserId or paidByContactId is required.");
    }

    /**
     * ADR 0025 §5.1 R1a: {@code payers} is present <strong>and</strong> a legacy
     * {@code paidByUserId}/{@code paidByContactId} is too. Two payer forms in one
     * request would leave the server to guess which one is true.
     */
    public static SplitRuleViolationException payerFormsAreMutuallyExclusive() {
        return new SplitRuleViolationException(
                "Provide either paidByUserId/paidByContactId or payers, not both.");
    }

    /**
     * ADR 0025 §5.1 R2: a {@code payers[]} entry with neither or both of
     * {@code payerUserId}/{@code payerContactId}, matched by
     * {@code chk_split_expense_payers_user_xor_contact}.
     */
    public static SplitRuleViolationException exactlyOnePayerIdentityRequired() {
        return new SplitRuleViolationException(
                "Each payer must have exactly one of payerUserId or payerContactId.");
    }

    /**
     * ADR 0025 §5.1 R3: the same identity twice in {@code payers[]}, checked as
     * sent and, in individual mode, again after pair normalisation (a linked
     * contact's id and its account's id are one party).
     *
     * <p>{@code uq_split_expense_payers_expense_revision_user}/{@code ..._expense_revision_contact}
     * (V19, one row per identity per split <em>revision</em>) are the backstops,
     * and they map to a logged {@code 500}, never a {@code 409}.
     * Without this check a duplicate would also double-credit one person in the
     * ledger while the payer sum still passed.
     */
    public static SplitRuleViolationException duplicatePayer() {
        return new SplitRuleViolationException(
                "The same person is listed more than once in payers.");
    }

    /**
     * ADR 0025 §5.1 R4: {@code sum(payers[].amount) != amount}. Exact
     * {@link java.math.BigDecimal#compareTo}, no tolerance, the same discipline as
     * {@link #participantAmountsDoNotSumToAmount()}. No constraint can express it
     * (V16: cross-row).
     */
    public static SplitRuleViolationException payerAmountsDoNotSumToAmount() {
        return new SplitRuleViolationException(
                "Payer amounts must add up exactly to the split amount.");
    }

    /**
     * Neither or both of {@code participantUserId}/{@code participantContactId} on
     * a participant entry — §9.1's own words, matched by
     * {@code chk_split_expense_participants_user_xor_contact}.
     */
    public static SplitRuleViolationException exactlyOneParticipantIdentityRequired() {
        return new SplitRuleViolationException(
                "Each participant requires exactly one of participantUserId or participantContactId.");
    }

    // ---------------------------------------------------------------------
    // §9.1 — the three rules with no declarative backstop
    // ---------------------------------------------------------------------

    /**
     * <strong>{@code sum(participants[].amount) != amount}</strong> — §9.1 step 1,
     * the first thing the write path does, and {@code V11} contract item 2's "the
     * participant sum is yours alone: no constraint in this file can express it".
     *
     * <p>Compared with {@link java.math.BigDecimal#compareTo}, which is exact
     * decimal arithmetic. Both sides are already constrained to at most two
     * decimal places by {@code @Digits(fraction = 2)}, so this is
     * <em>stricter</em> than {@code V11}'s "round incoming JSON numbers to paise
     * before comparing" rather than an approximation of it: a sub-paise value is
     * refused by name at the field instead of being silently rounded into a sum
     * that then does not match.
     */
    public static SplitRuleViolationException participantAmountsDoNotSumToAmount() {
        return new SplitRuleViolationException(
                "participants[].amount must sum exactly to amount.");
    }

    /**
     * The same identity listed twice in {@code participants[]}.
     *
     * <p>{@code uq_split_expense_participants_expense_revision_user}/{@code ..._expense_revision_contact}
     * (V19, one row per identity per split <em>revision</em>) are the backstops and
     * map to a logged {@code 500} (V19 CONTRACT item 4; before V19 the dropped
     * two-column uniques were documented as a {@code 400}). {@code V11} asks for
     * the clean error first: "the
     * service should reject the duplicate before the insert with a clear message".
     * It matters more than a tidy message, though — a duplicate row silently
     * double-counts one person's share while the sum check still passes, and
     * nothing downstream can tell it from a legitimate row afterwards.
     */
    public static SplitRuleViolationException duplicateParticipant() {
        return new SplitRuleViolationException(
                "The same participant appears more than once in participants[].");
    }

    /**
     * A participant or payer who is not a member of the named group.
     *
     * <p><strong>A {@code 400} rather than a {@code 404}, deliberately, and it
     * leaks nothing</strong>: the caller has already proved their own membership
     * of this group, so they may legitimately read its member list through §7.3.
     * The request is simply inconsistent with a group they can see.
     *
     * <p>Without this check the balance upsert would <em>create</em> a balance row
     * for a non-member, and {@code GroupBalanceService}'s row-count assertion
     * would then fail the whole write with a {@code 500} — a correct refusal with
     * an unhelpful code. This is the clean error in front of it.
     */
    public static SplitRuleViolationException notAGroupMember() {
        return new SplitRuleViolationException(
                "Every participant and the payer must be a member of the named group.");
    }

    /**
     * A participant or payer on an <strong>individual</strong> split who is
     * neither the caller nor the named counterpart.
     *
     * <p>Flagged as a derived rule (constitution §30): §9.1 does not state who may
     * appear in an individual split's {@code participants[]}. It follows from the
     * target — an {@code individual_balances} row has exactly two sides, so a
     * third identity's share would have nowhere to land and the pair's single
     * number could no longer be derived from the request.
     */
    public static SplitRuleViolationException notAPartyToThePair() {
        return new SplitRuleViolationException(
                "On an individual split, every participant and the payer must be either the "
                        + "caller or the named counterpart.");
    }

    /**
     * {@code individualCounterpartContactId} resolves to a contact whose
     * {@code linked_user_id} is the caller themselves — a split with oneself.
     *
     * <p>{@code V9}'s FLAG 1 is still open at the contact level: a user may
     * legitimately have their own phone or email in their own address book, and
     * the auto-link then points that contact at its own owner. {@code V11} asks
     * specifically for this to be rejected here rather than left to
     * {@code chk_individual_balances_canonical_pair_order}, which also catches it
     * ({@code user_id < counterpart_user_id} strictly implies
     * {@code user_id <> counterpart_user_id}) but only as an unmappable
     * {@code 23514} and a {@code 500}: "do not let it surface as a 500 on a
     * user-reachable path."
     */
    public static SplitRuleViolationException cannotSplitWithYourself() {
        return new SplitRuleViolationException(
                "A split cannot be created with a contact that is linked to your own account.");
    }

    /**
     * {@code addToPersonalExpenses} is {@code true} but the caller is not a
     * participant with a share greater than zero.
     *
     * <p><strong>Not raised</strong> — recorded here deliberately as the rule this
     * domain chose <em>not</em> to enforce, and kept as a factory so the decision
     * is visible rather than inferable from an absence. The shipped frontend
     * skips the transaction in exactly this case
     * ({@code SplitAddExpenseScreen}: {@code if (addToExpenses && finalYourShare >
     * 0)}), so rejecting the request would break a payload the client legitimately
     * sends. {@code SplitExpenseService} instead stores
     * {@code added_to_personal_expenses = false}, which keeps §4.6's
     * "set iff the flag is true" true in both directions. See that service and
     * backend/README.md §16.6.
     */
    public static SplitRuleViolationException callerHasNoShareToAddToPersonalExpenses() {
        return new SplitRuleViolationException(
                "addToPersonalExpenses requires the caller to have a share greater than zero.");
    }

    // ---------------------------------------------------------------------
    // §9.3 — list filters
    // ---------------------------------------------------------------------

    /**
     * Neither or both of {@code groupId}/{@code individualBalanceId} on
     * {@code GET /split-expenses} — §9.3's "exactly one ... required", and its own
     * error table's {@code 400}.
     */
    public static SplitRuleViolationException exactlyOneListFilterRequired() {
        return new SplitRuleViolationException(
                "Exactly one of groupId or individualBalanceId is required.");
    }

    // ---------------------------------------------------------------------
    // §10.1 — settlement
    // ---------------------------------------------------------------------

    /** {@code target='group'} with no {@code groupId}. */
    public static SplitRuleViolationException groupIdRequiredForGroupTarget() {
        return new SplitRuleViolationException(
                "groupId is required when target is 'group'.");
    }

    /** {@code target='individual'} with no {@code individualBalanceId}. */
    public static SplitRuleViolationException individualBalanceIdRequiredForIndividualTarget() {
        return new SplitRuleViolationException(
                "individualBalanceId is required when target is 'individual'.");
    }

    /**
     * A target discriminator contradicted by the ids supplied —
     * {@code chk_settlements_target_xor}'s rule, which {@code V12} says is
     * "reachable only if the service fills both target columns or neither, i.e. if
     * it trusts {@code target} without re-checking which id arrived".
     */
    public static SplitRuleViolationException targetIdsContradictTarget() {
        return new SplitRuleViolationException(
                "groupId and individualBalanceId must match the target discriminator: exactly the "
                        + "one that target names, and not the other.");
    }

    /**
     * A <strong>group</strong> settlement with neither or both counterpart fields.
     *
     * <p>ADR 0023 §4 added the two columns precisely so a group settlement records
     * <em>who was paid</em>: without it one member's balance moves, nobody's moves
     * the other way, and the group stops summing to zero. In a two-member group
     * the counterpart was implied; in a three-member group "I settled up" is
     * ambiguous. {@code chk_settlements_counterpart_matches_target} is the
     * backstop, and {@code V12} calls it the most likely CHECK to surface during
     * implementation because it encodes a request-shape rule the client has to
     * satisfy.
     */
    public static SplitRuleViolationException exactlyOneSettlementCounterpartRequired() {
        return new SplitRuleViolationException(
                "A group settlement requires exactly one of counterpartUserId or "
                        + "counterpartContactId.");
    }

    /**
     * An <strong>individual</strong> settlement carrying a counterpart.
     *
     * <p>Both columns must be {@code NULL} there: an {@code individual_balances}
     * row <em>is</em> the pair, so a counterpart would be a second representation
     * of a fact the foreign key already carries (ADR 0023 §4, constitution §17).
     */
    public static SplitRuleViolationException settlementCounterpartNotAllowedForIndividualTarget() {
        return new SplitRuleViolationException(
                "counterpartUserId and counterpartContactId must be omitted when target is "
                        + "'individual'.");
    }

    /** A group settlement naming the caller as their own counterpart. */
    public static SplitRuleViolationException settlementCounterpartIsCaller() {
        return new SplitRuleViolationException(
                "A settlement counterpart cannot be the caller.");
    }

    /**
     * <strong>The settlement contradicts the ledger.</strong> Both parties are
     * debtors, both are creditors, or either balance is zero.
     *
     * <p>ADR 0023 §4 bullet 2: <strong>the direction is DERIVED from the two
     * balances, never supplied</strong> — "the request names the counterpart, not
     * a payer ... a settlement that contradicts the ledger is not a settlement."
     * That ADR flags it as its own derived rule, with the reason the alternative
     * was rejected: an explicit payer field lets a client assert a direction the
     * balances deny, and then something has to decide which is true.
     *
     * <p><strong>Rejected rather than guessed</strong> (ADR 0023's Backend
     * follow-up item 5 says so in those words). This is also what
     * {@code V12}'s "no {@code CHECK (counterpart_user_id <> initiated_by_user_id)}"
     * note relies on: settling with yourself is already unreachable through the
     * derived direction, because one row cannot be both debtor and creditor.
     */
    public static SplitRuleViolationException settlementDirectionContradictsLedger() {
        return new SplitRuleViolationException(
                "This settlement contradicts the ledger: one party must owe and the other must be "
                        + "owed, and neither balance may be zero.");
    }

    // ---------------------------------------------------------------------
    // §9.4 — PUT /split-expenses/{id} (ADR 0028 §6.2)
    // ---------------------------------------------------------------------

    /**
     * ADR 0028 §6.2 U1: a field that fixes the split's audience or its private
     * personal transaction was sent non-null on an edit. Changing it would be a
     * move, not an edit (§2.2).
     *
     * @param fieldName the request field's API name — a developer-written
     *                  literal, never client input
     */
    public static SplitRuleViolationException fieldNotEditable(String fieldName) {
        return new SplitRuleViolationException(
                fieldName + " can't be changed after a split expense is created. Delete it and add it again.");
    }

    /** ADR 0028 §7.1: {@code timeZone} is not an IANA zone id. */
    public static SplitRuleViolationException invalidTimeZone() {
        return new SplitRuleViolationException("timeZone must be an IANA time zone id, for example Asia/Kolkata.");
    }

    /** A feed {@code page} so large its row offset overflows. */
    public static SplitRuleViolationException pageOutOfRange() {
        return new SplitRuleViolationException("page is out of range.");
    }

    /** ADR 0028 §6.2 U2: a non-creator sent a {@code categoryId} different from the current one. */
    public static SplitRuleViolationException categoryChangeNotAllowed() {
        return new SplitRuleViolationException(
                "Only the person who added this expense can change its category.");
    }
}
