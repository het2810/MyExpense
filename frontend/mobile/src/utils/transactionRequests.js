import { toPaise } from './currency';

/**
 * The two `POST`/`PATCH /api/v1/transactions` request bodies, built from one
 * plain "intended values" object — docs/api/api-overview.md §4.2/§4.4.
 *
 * Pure and store-free, like dateDisplay.js/currency.js/activityLogEntries.js
 * before it: no React, no store, no `src/api/` import. The store calls these
 * and hands the result to `transactionsApi`; a screen never builds a request
 * body (constitution §8 — business logic lives in hooks or services, and
 * "which fields may legally travel together" is business logic, not markup).
 *
 * ---
 * **FIELD NAMES ARE THE API'S, VERBATIM.**
 *
 * The intended-values object uses `TransactionResponse`'s own names —
 * `txnDate`, `txnTime`, `categoryId`, `paymentMode`, `receiptPublicId` — so
 * nothing in the app renames or reshapes a contract field (constitution
 * §15/§30), and a diff between "what the server holds" and "what the form
 * wants" is a field-by-field comparison with no translation table in the
 * middle. The five category snapshot fields (`categoryName`,
 * `parentCategoryName`, `categoryIconName`, `categoryGlyph`, `categoryTone`)
 * are **server-authoritative and never request fields** (§4.2's resolution
 * rule 3): they are absent from everything below, deliberately, and must not
 * be "helpfully" added to save the server a lookup.
 *
 * ---
 * **ABSENT vs. EXPLICIT `null` — the distinction this file exists to protect**
 * (§4.4, following §3.3's verified `monthlyCap` convention).
 *
 * On `PATCH`, an **absent** field leaves the stored column unchanged; an
 * explicit **`null`** clears it. So a body that names every field — the
 * obvious way to write a form submit — would send `notes: null` for a
 * transaction whose note the user never opened, and **wipe it**. That is why
 * `buildTransactionUpdateRequest` is a *diff* rather than a serializer: a
 * field the user did not change is never named in the body at all, and a
 * `null` appears only where the user actually cleared something.
 */

/**
 * Builds the `POST /api/v1/transactions` body (§4.2).
 *
 * Absent and `null` mean the same thing on a create, so this one is a plain
 * include-when-applicable build rather than a diff. Four cross-field rules
 * decide what is included, each of them a `400` if broken:
 *
 * - **`categoryId` iff `type === 'expense'`.** A non-null `categoryId` sent
 *   with `type: 'income'` is a `400 VALIDATION_ERROR`, never a silently
 *   ignored field (docs/decisions/0018-income-is-not-a-category.md §3), so an
 *   income create omits the key entirely — the server fills the income
 *   snapshot from its own constants and writes `categoryId: null`.
 * - **`groupId` iff `scope === 'group'`.** Required in that case, and
 *   rejected otherwise.
 * - **`cashAmount`/`onlineAmount` iff `paymentMode === 'both'`**, and they
 *   must sum to `amount` exactly. Omitted — not sent as `null` — for the
 *   single modes, so the request says nothing about portions that do not
 *   exist.
 * - **`txnTime` is required and client-supplied**, `HH:mm`, the device
 *   wall-clock moment of creation. It travels from the client because the true
 *   creation moment can happen offline, long before the write arrives
 *   (docs/architecture/data-model.md §2.2).
 *
 * `clientId` is deliberately not sent: it is the idempotency key for an
 * offline-created record, and the offline write queue is Domain 8. Sending a
 * fresh uuid per attempt would be a key that dedupes nothing.
 *
 * `receiptPublicId` is never sent — see `buildTransactionUpdateRequest`.
 *
 * @param {object} values Intended values, in API field names.
 * @returns {object} A §4.2 request body.
 */
export function buildTransactionCreateRequest(values) {
  const body = {
    title: values.title,
    txnDate: values.txnDate,
    txnTime: values.txnTime,
    amount: values.amount,
    type: values.type,
    scope: values.scope,
    paymentMode: values.paymentMode,
  };

  if (values.type === 'expense' && values.categoryId) {
    body.categoryId = values.categoryId;
  }
  if (values.scope === 'group' && values.groupId) {
    body.groupId = values.groupId;
  }
  if (values.paymentMode === 'both') {
    body.cashAmount = values.cashAmount;
    body.onlineAmount = values.onlineAmount;
  }

  const notes = normalizeNotes(values.notes);
  if (notes !== null) {
    body.notes = notes;
  }

  return body;
}

/**
 * Builds the `PATCH /api/v1/transactions/{id}` body (§4.4) as a diff of
 * `intended` against `current`, plus the required `version`.
 *
 * @param {object} current The stored `TransactionResponse` the form was opened
 *   on — the row whose `version` is being asserted.
 * @param {object} intended Intended values, in API field names.
 * @returns {{ body: object, hasChanges: boolean }} `hasChanges` is false when
 *   the diff is empty, i.e. the user opened Edit and saved without changing
 *   anything. The caller should skip the request entirely in that case: it
 *   would be a round trip, a rate-limit slot and a `version` bump for nothing.
 */
export function buildTransactionUpdateRequest(current, intended) {
  // Required (§4.4) — "the version last read by the client". A stale value is
  // `409 VERSION_CONFLICT` and nothing is mutated, which is the entire point:
  // two devices editing one row must not silently overwrite each other.
  const body = { version: current.version };

  if (intended.title !== current.title) {
    body.title = intended.title;
  }
  if (intended.txnDate !== current.txnDate) {
    body.txnDate = intended.txnDate;
  }

  // `txnTime` is never included: it is frozen at creation (§4.4), the form has
  // no time field at all, and the server ignores the key. The refusal is
  // structural here — there is no branch that can add it.

  const typeChanged = intended.type !== current.type;
  if (typeChanged) {
    body.type = intended.type;
  }

  // CATEGORY, and the two `type` transitions §4.4 spells out.
  //
  // - **-> income**: the key is omitted. The server nulls `categoryId` and
  //   overwrites all five snapshot fields with the income constants; a
  //   non-null `categoryId` in the same request is a `400`.
  // - **income -> expense**: `categoryId` becomes *required* in that same
  //   request, and the diff supplies it for free — `current.categoryId` is
  //   `null` on an income row, so any chosen category differs from it.
  // - **type-preserving**: included only when the category actually changed,
  //   which is what keeps a transaction tagged to a subcategory tagged to it
  //   when the user edits some other field without opening the picker.
  //
  // A `null` is never sent: §4.4's absent-vs-null rule covers `notes` and
  // `receiptPublicId` only, and "clear the category" is not a client intent
  // the contract has (an expense must have one; an income row's `null` is the
  // server's to write).
  if (intended.type === 'expense' && intended.categoryId && intended.categoryId !== current.categoryId) {
    body.categoryId = intended.categoryId;
  }

  const scopeChanged = intended.scope !== current.scope;
  if (scopeChanged) {
    body.scope = intended.scope;
  }
  if (intended.scope === 'group' && intended.groupId !== current.groupId) {
    body.groupId = intended.groupId;
  } else if (scopeChanged && intended.scope === 'personal' && current.groupId) {
    // Group -> personal. The explicit `null` states the intent, and is
    // forward-correct if the contract ever gives `groupId` the same
    // presence-tracked treatment `notes` has.
    //
    // **Flagged rather than worked around** (this round's report): §4.4 gives
    // no documented way to clear `groupId`, because absent and `null` are the
    // same thing for every field except `notes`/`receiptPublicId` — so a
    // group-scoped transaction cannot currently be edited back to personal
    // without the server rejecting the pair. It is unreachable today, since
    // `scope: 'group'` writes are `403 NOT_GROUP_MEMBER` until Domain 6
    // exists, so no group-scoped row can be created in the first place.
    body.groupId = null;
  }

  // PAYMENT MODE and its two portions, resolved as one rule rather than three
  // independent fields — because the server resolves them that way (§4.2's
  // "required iff `paymentMode: 'both'`", re-validated at paise granularity).
  //
  // Two asymmetric cases:
  // - **Effective mode is `both`** -> `amount`, `cashAmount` and
  //   `onlineAmount` travel TOGETHER, every time, even when one of them did
  //   not change. Patching `amount` alone on a `both` row leaves the stored
  //   portions no longer summing to it, which is a `400` — correctly, since
  //   the alternative is a row whose own arithmetic is false or a server guess
  //   at how to redistribute someone's money.
  // - **Effective mode is not `both`** -> the portions are never sent. The
  //   server clears them itself when the mode leaves `both`, and a portion
  //   sent alongside `cash`/`online` is a contradiction, so it is a `400`.
  if (intended.paymentMode !== current.paymentMode) {
    body.paymentMode = intended.paymentMode;
  }
  if (intended.paymentMode === 'both') {
    body.amount = intended.amount;
    body.cashAmount = intended.cashAmount;
    body.onlineAmount = intended.onlineAmount;
  } else if (!isSameAmount(intended.amount, current.amount)) {
    body.amount = intended.amount;
  }

  // NOTES — the tri-state field, and the reason this builder is a diff.
  // Unchanged -> the key is absent and the stored note survives. Cleared ->
  // an explicit `null`, which is the contract's only way to say so.
  const nextNotes = normalizeNotes(intended.notes);
  const currentNotes = normalizeNotes(current.notes);
  if (nextNotes !== currentNotes) {
    body.notes = nextNotes;
  }

  // RECEIPT — clearing only, and that is a hard rule rather than a current
  // limitation of the form.
  //
  // `receiptPublicId` is a Cloudinary `public_id` the server issues through
  // `POST /receipts/upload-signature` (§4.2's receipt rules), an endpoint that
  // does not exist yet. The app therefore has no legitimate value to send:
  // anything it could invent — a local device URI above all — is explicitly
  // **not** a `receiptPublicId` (§4.1) and would fail the server's claim
  // check as a `400`. So only a clear is ever expressed, and a non-null
  // intended value is ignored by construction.
  //
  // TODO (blocked on that endpoint, docs/decisions/0020-receipt-upload-cloudinary-signed-direct.md):
  // when upload lands, a newly uploaded `public_id` becomes sendable here and
  // this branch becomes a normal "changed -> include" comparison.
  if (current.receiptPublicId && intended.receiptPublicId === null) {
    body.receiptPublicId = null;
  }

  return { body, hasChanges: Object.keys(body).length > 1 };
}

/**
 * Empty, blank and absent notes are all one state — "no note" — and the column
 * is nullable, so they normalize to `null`. Without this, `''` and `null`
 * would read as a change and send a pointless `PATCH`; worse, `''` would be
 * stored as a note that renders as an empty NOTES card.
 *
 * @param {string | null | undefined} notes
 * @returns {string | null}
 */
function normalizeNotes(notes) {
  if (typeof notes !== 'string') {
    return null;
  }
  const trimmed = notes.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Paise-granularity comparison, never raw decimal equality — the same
 * correctness rule the cash/online split validation follows, through the same
 * shared primitive (constitution §25). `250` and `250.00` are the same amount;
 * `0.1 + 0.2` is not reliably `0.3`.
 *
 * @param {number | null | undefined} a
 * @param {number | null | undefined} b
 * @returns {boolean}
 */
function isSameAmount(a, b) {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return toPaise(Number(a)) === toPaise(Number(b));
}
