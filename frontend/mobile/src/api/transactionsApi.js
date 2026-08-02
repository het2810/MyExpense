import { authorizedRequest } from './apiClient';
import { TRANSACTION_PATHS, TRANSACTION_PAGE_SIZE } from './config';

/**
 * Transactions (Domain 4) — one thin function per wired endpoint, the exact
 * shape authApi.js established and usersApi.js/categoriesApi.js already follow
 * (docs/decisions/0016-frontend-api-integration.md §3.4). Contract:
 * docs/api/api-overview.md §4.1–§4.5.
 *
 * **Every call here goes through `apiClient.authorizedRequest`.** All five
 * transaction endpoints require `Authorization: Bearer <accessToken>` and are
 * owner-scoped (api-overview.md §4), so `sendRequest` is never used directly
 * and raw `fetch` never appears: going through `authorizedRequest` is what
 * attaches the bearer and gets the single-flight refresh-on-401, the
 * stale-token comparison and the forced logout on a terminal 401 (ADR 0016
 * §6.2/§6.3). None of that may be re-implemented or worked around here.
 *
 * These functions return the parsed response and throw `ApiError` on any
 * failure. They hold no state and touch no store: that is what lets React
 * Query wrap them as `queryFn`s/`mutationFn`s later without this layer
 * changing (ADR 0016 §10).
 *
 * Layer rule (ADR 0016 §1): may import `apiClient` and `config`. Never React,
 * never a store.
 *
 * ---
 * **RECEIPT UPLOAD IS NOT WIRED, AND NOT BY OMISSION.**
 *
 * `POST /receipts/upload-signature` (§4's endpoint table) is specified but not
 * implemented on the backend, so there is **no `requestReceiptUploadSignature`
 * wrapper here and no path for it in config.js** — an endpoint wrapper nothing
 * can call is dead code (constitution §3.5, ADR 0016 §3.4).
 *
 * TODO (blocked on the backend implementing `POST /receipts/upload-signature`
 * per docs/decisions/0020-receipt-upload-cloudinary-signed-direct.md): add the
 * signing wrapper, the direct device->Cloudinary multipart upload (which does
 * NOT go through this module — it is not our API), and then start sending
 * `receiptPublicId` on create/update. Until then **`receiptPublicId` is a field
 * the app reads and can clear, never one it can populate**, and the two error
 * codes that only a real upload can produce (`503
 * RECEIPT_UPLOAD_UNAVAILABLE`, `409 RECEIPT_ALREADY_ATTACHED`) are
 * unreachable — see errorMessages.js for why they are deliberately unmapped.
 */

/**
 * Builds a query string from the subset of §4.1's parameters a caller actually
 * supplied. `undefined` and `null` are dropped rather than sent as empty
 * values: `?scope=` is not the same request as no `scope` at all, and the
 * server validates `scope` against `personal|group` (so a blank would be a
 * `400`).
 *
 * @param {object} params
 * @returns {string} '' or '?a=1&b=2'
 */
function buildQuery(params) {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/**
 * `GET /api/v1/transactions` -> `200 PageResponse<TransactionResponse>`
 * (api-overview.md §4.1):
 * `{ content, page, size, totalElements, totalPages }`.
 *
 * Every filter is optional and omitted when not supplied. Two of them are
 * worth knowing at the call site:
 *
 * - **`categoryId` rolls up** — a top-level id matches transactions tagged to
 *   it *and* to any of its subcategories, and it **never matches an income
 *   row** (which has no category at all). `type: 'income'` is the filter for
 *   that (§4.1, docs/decisions/0019-subcategories-one-optional-level.md §5).
 * - **`dateFrom`/`dateTo` are inclusive bounds on `txnDate`**, `YYYY-MM-DD`.
 *
 * Ordering is the server's and is not selectable: newest first, deterministic
 * down to a tiebreaker. **§4.1 does not actually document the order** — that
 * is flagged back to the System Architect in this round's report; the client
 * never re-sorts, so the rendered order is whatever the contract settles on.
 *
 * Soft-deleted rows are excluded server-side (§4.5), so nothing here has to
 * filter them.
 *
 * @param {{ scope?: 'personal' | 'group', type?: 'expense' | 'income',
 *           categoryId?: string, dateFrom?: string, dateTo?: string,
 *           page?: number, size?: number }} [filters]
 * @returns {Promise<object>} PageResponse<TransactionResponse>
 */
export function listTransactions(filters = {}) {
  const { page = 0, size = TRANSACTION_PAGE_SIZE, ...rest } = filters;
  return authorizedRequest(`${TRANSACTION_PATHS.list}${buildQuery({ ...rest, page, size })}`);
}

/**
 * `POST /api/v1/transactions` -> `201 TransactionResponse` (api-overview.md
 * §4.2).
 *
 * The body is built by `utils/transactionRequests.js`, not here: which fields
 * are legal together is a cross-field business rule (category iff expense,
 * group id iff group scope, cash/online portions iff `paymentMode: 'both'`),
 * and this layer is transport. What matters here is what this function must
 * never do — **the five category snapshot fields (`categoryName`,
 * `parentCategoryName`, `categoryIconName`, `categoryGlyph`, `categoryTone`)
 * and `txnTime`'s immutability are server-authoritative** (§4.2's resolution
 * rule 3, docs/decisions/0018-income-is-not-a-category.md §3), so nothing in
 * this module adds them "to save a lookup".
 *
 * Errors worth knowing at the call site, all mapped to copy in
 * errorMessages.js: `400 VALIDATION_ERROR` (including a non-null `categoryId`
 * sent with `type: 'income'`, and a cash/online split that does not sum to
 * `amount`), `403 NOT_GROUP_MEMBER` (**every** `scope: 'group'` write this
 * phase — Domain 6 is unbuilt, so there is no membership to establish; by
 * design, not a bug), `404 CATEGORY_NOT_FOUND`.
 *
 * @param {object} transaction A §4.2 request body.
 * @returns {Promise<object>} TransactionResponse (`version: 1`)
 */
export function createTransaction(transaction) {
  return authorizedRequest(TRANSACTION_PATHS.create, {
    method: 'POST',
    body: transaction,
  });
}

/**
 * `GET /api/v1/transactions/{id}` -> `200 TransactionResponse` (api-overview.md
 * §4.3), owner-scoped.
 *
 * This single-resource response carries two things §4.1's list deliberately
 * does not, both derived server-side at response time:
 *
 * - the **premium payment-method enrichment** (`paymentMethodDisplay`,
 *   `paymentMethodUpiId`), gated on the account's real `is_premium` — never on
 *   a client-side flag;
 * - **`receiptSignedUrl`**, a short-lived signed Cloudinary delivery URL,
 *   `null` when `receiptPublicId` is null.
 *
 * `receiptSignedUrl` **must not be cached or persisted** (ADR 0020 §5.2/§7):
 * for its lifetime it is a bearer credential for financial PII. The one caller
 * keeps it in component state for the render that needs it and nowhere else.
 * And its absence is **not** "no receipt": when `receiptPublicId` is non-null
 * the receipt exists and the UI must say so (that ADR §10.5).
 *
 * A soft-deleted transaction answers `404 TRANSACTION_NOT_FOUND` here, which is
 * exactly how a stale id is discovered (§4.5).
 *
 * @param {string} id
 * @returns {Promise<object>} TransactionResponse + the enrichment above
 */
export function getTransaction(id) {
  return authorizedRequest(TRANSACTION_PATHS.byId(id));
}

/**
 * `PATCH /api/v1/transactions/{id}` -> `200 TransactionResponse` with
 * `version` incremented (api-overview.md §4.4), owner-scoped.
 *
 * Two properties of this body are load-bearing and are the caller's
 * responsibility (`utils/transactionRequests.js` builds it):
 *
 * 1. **`version` is required** — the version the client last read. A stale one
 *    is `409 VERSION_CONFLICT` and nothing is mutated.
 * 2. **Absent vs. explicit `null`** — an absent field leaves the column
 *    unchanged; an explicit `null` clears it, for `notes` and
 *    `receiptPublicId`. Sending `null` for every field the user did not touch
 *    would wipe their notes.
 *
 * `txnTime` is **not** updatable (frozen at creation) and the five category
 * snapshot fields are not request fields — see `createTransaction` above.
 *
 * Errors: `400 VALIDATION_ERROR`, `404 TRANSACTION_NOT_FOUND`,
 * `409 VERSION_CONFLICT` (re-fetch and retry), `409 RECEIPT_ALREADY_ATTACHED`
 * (**not** retryable — unreachable until receipt upload exists, see the
 * module note).
 *
 * @param {string} id
 * @param {object} changes A §4.4 request body, including `version`.
 * @returns {Promise<object>} TransactionResponse (updated)
 */
export function updateTransaction(id, changes) {
  return authorizedRequest(TRANSACTION_PATHS.byId(id), {
    method: 'PATCH',
    body: changes,
  });
}

/**
 * `DELETE /api/v1/transactions/{id}` -> `204 No Content` (api-overview.md
 * §4.5), owner-scoped.
 *
 * A **soft** delete: the row keeps existing with `deleted_at` set, so offline
 * clients can learn about the deletion through `/sync/pull` rather than having
 * a record silently vanish (constitution §14). The client-visible consequence
 * is the one that matters here — the id is immediately absent from §4.1's list
 * and answers `404 TRANSACTION_NOT_FOUND` on §4.3 — so a held id is a stale id
 * from this point on, and anything still holding one must stop.
 *
 * Resolves to `null` (httpClient maps `204` to `null`, ADR 0016 §3.1).
 *
 * Errors: `404 TRANSACTION_NOT_FOUND`.
 *
 * @param {string} id
 * @returns {Promise<null>}
 */
export function deleteTransaction(id) {
  return authorizedRequest(TRANSACTION_PATHS.byId(id), { method: 'DELETE' });
}
