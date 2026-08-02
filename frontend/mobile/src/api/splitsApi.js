import { authorizedRequest } from './apiClient';
import { SPLIT_PATHS } from './config';

/**
 * The shared ledger (Domain 6, sub-steps 3 and 4) — pairwise balances (§8.1),
 * split expenses (§9.1/§9.3) and settlements (§10.1). One thin function per
 * wired endpoint, the shape every other module in this folder follows
 * (docs/decisions/0016-frontend-api-integration.md §3.4). Contract:
 * docs/api/api-overview.md, as corrected by
 * docs/decisions/0023-shared-ledger-contract-corrections.md.
 *
 * Every call goes through `apiClient.authorizedRequest` (ADR 0016 §6.2/§6.3).
 * These functions return the parsed response and throw `ApiError` on failure;
 * they hold no state, touch no store, and build no request bodies — the two
 * bodies in this domain are composed by `utils/splitRequests.js`, because which
 * fields are legal together is a cross-field business rule and this layer is
 * transport.
 *
 * Layer rule (ADR 0016 §1): may import `apiClient` and `config`. Never React,
 * never a store.
 *
 * ---
 * **THE THREE THINGS THAT SILENTLY BREAK A LEDGER, STATED ONCE HERE.**
 *
 * 1. **`balance` arrives already oriented to the caller. Never negate it.**
 *    The server stores one row per registered pair, signed relative to the
 *    canonical (lesser-uuid) `user_id`, reads **both** sides, and flips the sign
 *    exactly once — in `IndividualBalanceService#orientToCaller` — when the
 *    caller is the canonical counterpart (ADR 0023 §1.4, its Frontend follow-up,
 *    `backend/README.md` §16.1/§16.5 note 3). A second flip on this side would
 *    render every debt backwards, and would do it *plausibly*: the number and
 *    the name would both look right.
 * 2. **A pairwise balance is SHARED.** One row, two readers, either party may
 *    settle it. It can change with no action from this device, so nothing above
 *    this layer may keep a private `yourBalance` and adjust it by its own
 *    deltas — every write is followed by a re-read (ADR 0023 §1.1/§1.4,
 *    Offline-first note).
 * 3. **A group settlement must name a counterpart.** See `settleUp` below.
 */

/**
 * `GET /api/v1/splits/individuals` -> `200 IndividualBalanceResponse[]`
 * (api-overview.md §8.1): `{ id, counterpartUserId, counterpartContactId,
 * counterpartName, balance, updatedAt }`.
 *
 * **Membership-gated, both sides** (ADR 0023 §1.4): the caller sees every pair
 * row they are *a party to* — the ones they created and the ones the other
 * party created — plus their own private rows against unregistered contacts.
 * Before that correction a read filtered on `user_id = caller` returned
 * plausible data while hiding every debt someone else had recorded against the
 * caller, which is the bug this endpoint's shape exists to prevent.
 *
 * **One counterpart, one entry, one number.** No `currencyCode` (reverted
 * 2026-10-02 — currency is a display symbol only), and exactly one
 * `individual_balances` row per pair, whose `id` is what §9.3's
 * `individualBalanceId` filter and §10.1's settle request both reference.
 *
 * `counterpartUserId`/`counterpartContactId` resolve to **the other party**,
 * whichever stored column that happens to be; `counterpartName` is resolved
 * server-side. A `counterpartUserId` means the row is the shared, canonical one
 * (both parties read the same `id`); a `counterpartContactId` means it is the
 * caller's private row against a contact with no account.
 *
 * **Not paginated** — §8.1 defines no wrapper. The whole list arrives, which is
 * what makes summing it into "you owe" / "you are owed" totals legitimate here
 * (unlike a total derived from one page of a paginated list).
 *
 * **There is no "last activity" field**, so a consumer that wants a subtitle
 * composes it from `updatedAt` rather than inventing one.
 *
 * @returns {Promise<object[]>} IndividualBalanceResponse[]
 */
export function listIndividualBalances() {
  return authorizedRequest(SPLIT_PATHS.individualBalances);
}

/**
 * `GET /api/v1/split-expenses?groupId=` **or** `?individualBalanceId=` ->
 * `200 SplitExpenseResponse[]` (api-overview.md §9.3), membership-gated.
 *
 * **Exactly one of the two parameters is required** — neither or both is a
 * `400 VALIDATION_ERROR`. This function sends whichever one it is given and
 * never both; the caller's own guard is in `useSplitExpensesStore`.
 *
 * **Not paginated**, deliberately (§9.3): the frontend's equivalent view has no
 * pagination concept either, so the whole itemized history for one target
 * arrives and a total over it is a real total.
 *
 * Each row carries its **frozen** category snapshot (`categoryName`,
 * `parentCategoryName`, `categoryIconName`, `categoryGlyph`, `categoryTone`) and
 * its **frozen** `participants[].name`, so a row renders with zero further
 * lookups — that denormalization is the point. Two consequences worth knowing:
 * a category rename does *not* yet refresh these snapshots (`backend/README.md`
 * §16.8), and `categoryId` is always non-null even when the creator chose no
 * category, because the server snapshots their protected `Misc` row instead
 * (ADR 0023 §3).
 *
 * `participants[]` is `{ participantUserId, participantContactId, name, amount }`
 * with exactly one id set per entry, the same two-column identity vocabulary
 * `GET /groups` uses for members. **The caller's own share is the entry whose
 * `participantUserId` is their user id** — the one figure that must never be
 * confused with `amount`, which is the whole bill.
 *
 * Ordering is the server's (`split_date desc, id`) and is not selectable
 * (`backend/README.md` §16.6 assumption 17). Nothing above this layer re-sorts.
 *
 * Errors: `400 VALIDATION_ERROR`, `404 GROUP_NOT_FOUND` /
 * `404 INDIVIDUAL_BALANCE_NOT_FOUND` (membership-gated — never a `403`).
 *
 * @param {{ groupId?: string | null, individualBalanceId?: string | null }} target
 * @returns {Promise<object[]>} SplitExpenseResponse[]
 */
export function listSplitExpenses({ groupId = null, individualBalanceId = null }) {
  const query = groupId
    ? `?groupId=${encodeURIComponent(groupId)}`
    : `?individualBalanceId=${encodeURIComponent(individualBalanceId)}`;
  return authorizedRequest(`${SPLIT_PATHS.splitExpenses}${query}`);
}

/**
 * `GET /api/v1/split-expenses/{id}` -> `200 SplitExpenseResponse` (§9.2).
 * Split Expense Detail's online refresh (ADR 0028 §11.3). A deleted split is
 * `404 SPLIT_EXPENSE_NOT_FOUND`.
 *
 * @param {string} id
 * @returns {Promise<object>} SplitExpenseResponse
 */
export function getSplitExpense(id) {
  return authorizedRequest(SPLIT_PATHS.splitExpenseById(id));
}

/**
 * `PUT /api/v1/split-expenses/{id}` -> `200 SplitExpenseResponse` (§9.4,
 * ADR 0028 §6). The body is the full editable state, built by
 * `utils/splitEdit.js#buildSplitExpenseUpdateRequest`.
 *
 * Errors: `400 VALIDATION_ERROR` (U1/U2 and every create rule),
 * `403 SPLIT_EXPENSE_CREATOR_ONLY`, `404 SPLIT_EXPENSE_NOT_FOUND`,
 * `404 CATEGORY_NOT_FOUND`, `409 WRITE_SUPERSEDED`.
 *
 * @param {string} id
 * @param {object} body
 * @param {Record<string, string>} [headers] ADR 0027 write headers, if any.
 * @returns {Promise<object>} SplitExpenseResponse
 */
export function updateSplitExpense(id, body, headers) {
  return authorizedRequest(SPLIT_PATHS.splitExpenseById(id), {
    method: 'PUT',
    body,
    ...(headers ? { headers } : {}),
  });
}

/**
 * `DELETE /api/v1/split-expenses/{id}` -> `204` (§9.5, ADR 0028 §2.3). A soft
 * delete that reverses the split's ledger effect. A `404` means it is already
 * gone, which callers treat as success.
 *
 * @param {string} id
 * @param {Record<string, string>} [headers]
 * @returns {Promise<null>}
 */
export function deleteSplitExpense(id, headers) {
  return authorizedRequest(SPLIT_PATHS.splitExpenseById(id), {
    method: 'DELETE',
    ...(headers ? { headers } : {}),
  });
}

/**
 * @param {{ page?: number, size?: number, timeZone?: string | null }} options
 * @returns {string}
 */
function buildFeedQuery({ page = 0, size = 30, timeZone = null }) {
  const parts = [`page=${encodeURIComponent(page)}`, `size=${encodeURIComponent(size)}`];
  if (timeZone) {
    parts.push(`timeZone=${encodeURIComponent(timeZone)}`);
  }
  return `?${parts.join('&')}`;
}

/**
 * `GET /api/v1/groups/{groupId}/feed` -> `200 PageResponse<SplitFeedItemResponse>`
 * (§7.5, ADR 0028 §7). Includes deleted splits as tombstones. Errors:
 * `400 VALIDATION_ERROR`, `404 GROUP_NOT_FOUND`.
 *
 * @param {string} groupId
 * @param {{ page?: number, size?: number, timeZone?: string | null }} [options]
 * @returns {Promise<object>} PageResponse
 */
export function fetchGroupFeed(groupId, options = {}) {
  return authorizedRequest(`${SPLIT_PATHS.groupFeed(groupId)}${buildFeedQuery(options)}`);
}

/**
 * `GET /api/v1/splits/individuals/{id}/feed` -> `200 PageResponse<SplitFeedItemResponse>`
 * (§8.2, ADR 0028 §7). Errors: `400 VALIDATION_ERROR`,
 * `404 INDIVIDUAL_BALANCE_NOT_FOUND`.
 *
 * @param {string} individualBalanceId
 * @param {{ page?: number, size?: number, timeZone?: string | null }} [options]
 * @returns {Promise<object>} PageResponse
 */
export function fetchPairFeed(individualBalanceId, options = {}) {
  return authorizedRequest(
    `${SPLIT_PATHS.pairFeed(individualBalanceId)}${buildFeedQuery(options)}`,
  );
}

/**
 * `POST /api/v1/split-expenses` -> `201 SplitExpenseResponse` (api-overview.md
 * §9.1, as corrected by ADR 0023 §3).
 *
 * Takes a prebuilt body from `utils/splitRequests.js` — the participant
 * identities, the payer XOR, the per-mode target field and the participant sum
 * are cross-field rules that belong next to each other and not in transport.
 *
 * What this write does server-side, in one transaction: re-validates that
 * `participants[].amount` sums **exactly** to `amount`, recalculates every
 * affected balance row, optionally creates the caller's personal transaction,
 * and fans out activity/notification rows to the other members (§9.1). It is
 * therefore the one call in this domain that can move another user's balance.
 *
 * **`categoryId` is optional and omitting it is legal.** The server resolves the
 * caller's protected `Misc` category and snapshots it, setting `category_id` to
 * that row rather than leaving it null (ADR 0023 §3 — the contract previously
 * specified an endpoint that could not succeed without one). So nothing above
 * this layer may force a category choice for the split itself.
 *
 * **`addToPersonalExpenses: true` makes the SERVER create the personal
 * transaction** (§9.1 step 3, at the caller's own consumption share and never
 * the full amount). This app sends `false` and writes that transaction itself
 * through `POST /transactions` — see `utils/splitRequests.js` for why, and why
 * sending `true` as well would double-count the user's own money.
 *
 * Errors: `400 VALIDATION_ERROR` (participant sum, a sub-paise share, a payer
 * or participant who is not a member of the named group, splitting with a
 * contact linked to yourself), `404 GROUP_NOT_FOUND` /
 * `404 INDIVIDUAL_BALANCE_NOT_FOUND` (membership-gated),
 * `404 CATEGORY_NOT_FOUND`, and `404 CONTACT_NOT_FOUND` — which §9.1's error
 * table omits although the endpoint resolves a contact owner-scoped, flagged by
 * the Backend Engineer in `backend/README.md` §16.6 assumption 3 and mapped here
 * regardless.
 *
 * @param {object} splitExpense A §9.1 request body.
 * @returns {Promise<object>} SplitExpenseResponse
 */
export function createSplitExpense(splitExpense) {
  return authorizedRequest(SPLIT_PATHS.splitExpenses, {
    method: 'POST',
    body: splitExpense,
  });
}

/**
 * `POST /api/v1/splits/settle` -> `201 SettlementResponse` (api-overview.md
 * §10.1, as corrected by ADR 0023 §4).
 *
 * Takes a prebuilt body from `utils/splitRequests.js`.
 *
 * ---
 * **A GROUP SETTLEMENT MUST CARRY A COUNTERPART, AND §10.1 DOES NOT SAY SO.**
 *
 * `POST /splits/settle` requires **exactly one** of `counterpartUserId` /
 * `counterpartContactId` when `target: 'group'`, and **neither** when
 * `target: 'individual'`. ADR 0023 §4 adds the two columns and makes one
 * required for a group; `V12` enforces it with
 * `chk_settlements_counterpart_matches_target`; the backend implements and
 * requires it. **§10.1's request block still lists only five fields**, which the
 * Backend Engineer flagged rather than resolved (`backend/README.md` §16.6
 * flag-back 1). Without the field every group settlement fails — the doc is
 * behind the code, so the code is what this client follows.
 *
 * Why an individual settlement needs none: after ADR 0023 §1 the
 * `individual_balances` row *is* the pair, so both parties are already in the
 * row the settlement references; a counterpart column would be a second
 * representation of a fact the FK carries (constitution §17).
 *
 * ---
 * **DIRECTION IS DERIVED, NOT SUPPLIED — AND THE BOUND IS TWO-SIDED.**
 *
 * The request names *who* is being settled with, never who pays. The server
 * reads both rows' signs and the debtor pays the creditor; both parties owing,
 * both owed, or either at `0.00` is a `400 VALIDATION_ERROR`, because a
 * settlement that contradicts the ledger is not a settlement (ADR 0023 §4,
 * `backend/README.md` §16.5 note 7). That `400` carries **no `fieldErrors`**,
 * which is how a caller tells it apart from a genuine field problem.
 *
 * **Partial settlement is supported** (§10.1, ADR 0017 §4): the balance is
 * reduced to its residual, never zeroed, and an over-amount is
 * `400 AMOUNT_EXCEEDS_BALANCE` — rejected, never clamped, never sign-flipped.
 * For a group the bound is `min(|debtor's balance|, creditor's balance)`, and
 * **this client cannot compute it**: §7.1 deliberately exposes no per-member
 * breakdown, so the counterpart's position is unknown here. The error is
 * therefore a normal, reachable outcome rather than a bug, and its copy says so.
 * It is also reachable with a *correct* amount, because the balance is shared
 * and may have moved since this screen read it.
 *
 * `remainingBalance` on the response is the target row's value after the write,
 * oriented to the caller on an individual settlement (`backend/README.md`
 * §16.6 assumption 15). This app does not render it: the authoritative value
 * comes from re-reading the balance, and keeping a second source for one shared
 * number is how the two disagree.
 *
 * Errors: `400 VALIDATION_ERROR`, `400 AMOUNT_EXCEEDS_BALANCE`,
 * `404 GROUP_NOT_FOUND` (including **a counterpart who is not a member** —
 * `404`, never `403`, and never a message that distinguishes it from an unknown
 * group: ADR 0023 item 6), `404 INDIVIDUAL_BALANCE_NOT_FOUND`.
 *
 * @param {object} settlement A §10.1 request body.
 * @returns {Promise<object>} SettlementResponse
 */
export function settleUp(settlement) {
  return authorizedRequest(SPLIT_PATHS.settle, {
    method: 'POST',
    body: settlement,
  });
}
