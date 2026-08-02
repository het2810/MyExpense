import { resolveParticipantIdentity } from './splitParticipants';

/**
 * The two request bodies of the shared-ledger domain — `POST /split-expenses`
 * (docs/api/api-overview.md §9.1) and `POST /splits/settle` (§10.1, as
 * corrected by docs/decisions/0023-shared-ledger-contract-corrections.md §4).
 *
 * Kept out of both the screens and `src/api/splitsApi.js` for the reason
 * `utils/transactionRequests.js` already exists: **which fields are legal
 * together is a cross-field business rule**, not transport and not rendering
 * (constitution §8). Every such rule in this domain is stated once, here:
 *
 * - the per-mode target field (`groupId` iff group, `individualCounterpartContactId`
 *   or — for 2+ contacts — `individualCounterpartContactIds` iff individual);
 * - the payer XOR and the participant XOR, both resolved through
 *   `utils/splitParticipants.js`;
 * - **the settlement counterpart, which is required for a group and forbidden
 *   for an individual** — the rule §10.1's request block does not yet state.
 *
 * Pure functions, no state, no API import.
 */

/**
 * Builds the `POST /split-expenses` body (§9.1).
 *
 * `addToPersonalExpenses` is passed through: the SERVER writes the caller's
 * consumption-share transaction (§9.1 step 3) and links the two rows
 * (`transactions.split_expense_id`), which is what gives that row its SPLIT
 * tag. The client no longer writes it itself — doing both would record the
 * share twice (see hooks/useSplitExpenseSave.js).
 *
 * @param {{
 *   title: string,
 *   categoryId: string | null,
 *   splitDate: string,
 *   amount: number,
 *   splitMode: 'individual' | 'group',
 *   groupId: string | null,
 *   individualCounterpartContactId?: string | null,
 *   individualCounterpartContactIds?: string[] | null,
 *   splitConfig: { method: string, paidById: string | null,
 *     payers?: Array<{ participantId: string, amount: number }> | null,
 *     participantAmounts: Array<{ participantId: string, amount: number }> },
 *   participants: object[],
 *   addToPersonalExpenses?: boolean,
 * }} values
 * @returns {object} A §9.1 request body.
 */
export function buildSplitExpenseCreateRequest({
  title,
  categoryId,
  splitDate,
  amount,
  splitMode,
  groupId,
  individualCounterpartContactId = null,
  individualCounterpartContactIds = null,
  splitConfig,
  participants,
  addToPersonalExpenses,
}) {
  const isGroup = splitMode === 'group';

  return {
    title,
    // Optional, and `null` is a legal value: the server resolves the caller's
    // protected `Misc` category and snapshots that (ADR 0023 §3). Nothing in
    // this flow forces a category choice for the split itself.
    categoryId: categoryId ?? null,
    splitDate,
    amount,
    splitMode,
    // Exactly one of the two targets, with the other sent as an explicit null
    // so one request shape covers both modes — the same convention
    // `categoriesApi.createCategory` uses for `parentCategoryId`.
    groupId: isGroup ? groupId : null,
    // Exactly one counterpart form (ADR 0026 §8.4) — spread in the position the
    // legacy single field always had, so a one-contact body is byte-identical
    // to the one this builder sent before ADR 0026.
    ...buildCounterpartFields(
      isGroup,
      individualCounterpartContactId,
      individualCounterpartContactIds,
    ),
    splitMethod: splitConfig.method,
    // Exactly one payer form (§9.1, ADR 0025 §8.2) — spread in the position the
    // legacy pair always had, so a single-payer body is byte-identical to the
    // one this builder sent before ADR 0025.
    ...buildPayerFields(splitConfig, participants),
    // Amounts are passed through exactly as the split method computed them —
    // they already sum to `amount` to the paise by construction
    // (`utils/currency.js#allocateByWeights`), and the server re-validates that
    // sum exactly (§9.1 step 1). Rounding them again here could only break an
    // invariant that already holds. A zero share is legal and is sent, not
    // dropped (`backend/README.md` §16.5 note 17). `name` is deliberately not
    // sent: the server resolves and freezes it (§9.3).
    participants: splitConfig.participantAmounts.map((entry) => {
      const identity = resolveParticipantIdentity(participants, entry.participantId);
      return {
        participantUserId: identity.participantUserId,
        participantContactId: identity.participantContactId,
        amount: entry.amount,
      };
    }),
    addToPersonalExpenses: addToPersonalExpenses === true,
  };
}

/**
 * The counterpart half of the §9.1 body —
 * docs/decisions/0026-multi-contact-individual-splits.md §5.1/§8.4.
 *
 * - **Group mode**: `individualCounterpartContactId: null` exactly as before;
 *   the array is **omitted** (C4 forbids it in group mode).
 * - **One contact**: the legacy `individualCounterpartContactId` and no array —
 *   today's body, byte for byte. The legacy field is not deprecated on the
 *   request (§5.1), so queued one-contact payloads keep their shape.
 * - **Two or more**: `individualCounterpartContactIds` in selection order, and
 *   the legacy field **omitted**, not sent as null, so C1 ("both forms") can
 *   never fire.
 *
 * Accepts either input form: the array (Split Add Expense) or the legacy single
 * id (any older caller). With neither, the legacy field is sent as `null`, as
 * it always was — the server answers C2, and the screen validates first.
 *
 * @param {boolean} isGroup
 * @param {string | null} contactId Legacy single counterpart.
 * @param {string[] | null} contactIds Counterparts in selection order.
 * @returns {object}
 */
function buildCounterpartFields(isGroup, contactId, contactIds) {
  if (isGroup) {
    return { individualCounterpartContactId: null };
  }
  const ids = Array.isArray(contactIds) ? contactIds : contactId ? [contactId] : [];
  if (ids.length >= 2) {
    return { individualCounterpartContactIds: ids };
  }
  return { individualCounterpartContactId: ids[0] ?? null };
}

/**
 * The payer half of the §9.1 body — docs/decisions/0025-multiple-payers-per-split-expense.md
 * §8.2.
 *
 * - **2+ payers** (`splitConfig.payers`): `payers[]` only, each resolved
 *   through `resolveParticipantIdentity`. `paidByUserId`/`paidByContactId` are
 *   **omitted**, not sent as null, so §5.1 R1a ("both forms") can never fire.
 * - **Otherwise**: the legacy `paidByUserId`/`paidByContactId` pair exactly as
 *   before, and `payers` is omitted. The legacy form is not deprecated on the
 *   request (§5.1), so queued single-payer payloads keep their shape.
 *
 * A one-element `payers` should never reach here (Who Paid? collapses it to
 * single mode), but if it does it is sent as the legacy pair for that one
 * person — §5.1 makes the two exactly equivalent.
 *
 * @param {{ paidById: string | null,
 *   payers?: Array<{ participantId: string, amount: number }> | null }} splitConfig
 * @param {object[]} participants
 * @returns {object}
 */
function buildPayerFields(splitConfig, participants) {
  const payers = Array.isArray(splitConfig.payers) ? splitConfig.payers : null;

  if (payers && payers.length >= 2) {
    return {
      payers: payers.map((entry) => {
        const identity = resolveParticipantIdentity(participants, entry.participantId);
        return {
          payerUserId: identity.participantUserId,
          payerContactId: identity.participantContactId,
          amount: entry.amount,
        };
      }),
    };
  }

  const payerId = payers && payers.length === 1 ? payers[0].participantId : splitConfig.paidById;
  const payer = resolveParticipantIdentity(participants, payerId);
  return {
    paidByUserId: payer.participantUserId,
    paidByContactId: payer.participantContactId,
  };
}

/**
 * Builds the `POST /splits/settle` body (§10.1 + ADR 0023 §4).
 *
 * ---
 * **THE COUNTERPART IS REQUIRED FOR A GROUP AND ABSENT FOR AN INDIVIDUAL.**
 *
 * ADR 0023 §4 adds `counterpart_user_id`/`counterpart_contact_id` to
 * `settlements` and requires **exactly one** of them when `group_id` is set,
 * **both null** when `individual_balance_id` is set; `V12` enforces it with
 * `chk_settlements_counterpart_matches_target`. Without it a group settlement
 * records that someone paid but not who was paid, one member's balance moves,
 * nobody's moves the other way, and the group **stops summing to zero** — the
 * invariant that same ADR went to trouble to make checkable.
 *
 * **§10.1's request block still lists five fields and no counterpart.** The
 * backend implements and requires it and flagged the gap rather than resolving
 * it (`backend/README.md` §16.6 flag-back 1). The doc is behind the code, so
 * this client follows the code — otherwise every group settlement fails.
 *
 * An individual settlement needs none: after ADR 0023 §1 the
 * `individual_balances` row *is* the pair, both parties are in the row the
 * settlement already references, and either of them may settle it (§10.1). The
 * two keys are therefore **omitted entirely** rather than sent as nulls, which
 * is exactly the shape §10.1 documents.
 *
 * Nothing here sends a payer or a direction: the server derives who pays from
 * the two balances' signs, and a request that contradicts the ledger is
 * rejected rather than guessed (ADR 0023 §4, `backend/README.md` §16.5 note 7).
 *
 * @param {{
 *   target: 'group' | 'individual',
 *   groupId?: string | null,
 *   individualBalanceId?: string | null,
 *   counterpartUserId?: string | null,
 *   counterpartContactId?: string | null,
 *   amount: number,
 *   method: 'marked_paid' | 'upi',
 * }} values
 * @returns {object} A §10.1 request body.
 */
export function buildSettlementRequest({
  target,
  groupId = null,
  individualBalanceId = null,
  counterpartUserId = null,
  counterpartContactId = null,
  amount,
  method,
}) {
  if (target === 'group') {
    if (!counterpartUserId && !counterpartContactId) {
      // Caught before the request leaves the device: the server answers a
      // missing counterpart with `400 VALIDATION_ERROR`, which is correct but
      // indistinguishable from a bad amount at the call site. The screen
      // prevents this by disabling Confirm until a member is picked; this is
      // the backstop that keeps the rule in one place.
      throw new Error('A group settlement must name the member being settled with.');
    }
    return {
      target,
      groupId,
      // Exactly one, never both — `chk_settlements_counterpart_matches_target`.
      counterpartUserId: counterpartUserId ?? null,
      counterpartContactId: counterpartUserId ? null : counterpartContactId,
      amount,
      method,
    };
  }

  return {
    target,
    individualBalanceId,
    amount,
    method,
  };
}
