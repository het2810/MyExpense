import { authorizedRequest } from './apiClient';
import { ACTIVITY_PATHS, EVENT_FEED_PAGE_SIZE } from './config';

/**
 * Activity log (Domain 7) — one thin function per wired endpoint, the exact
 * shape authApi.js established and every other module in this folder already
 * follows (docs/decisions/0016-frontend-api-integration.md §3.4). Contract:
 * docs/api/api-overview.md §11.1, implemented per `backend/README.md` §17.
 *
 * **The call goes through `apiClient.authorizedRequest`.** §11 requires
 * `Authorization: Bearer <accessToken>` and is owner-scoped from the JWT
 * principal, so `sendRequest` is never used directly and raw `fetch` never
 * appears: going through `authorizedRequest` is what attaches the bearer and
 * gets the single-flight refresh-on-401, the stale-token comparison and the
 * forced logout on a terminal 401 (ADR 0016 §6.2/§6.3). None of that may be
 * re-implemented or worked around here.
 *
 * This function returns the parsed response and throws `ApiError` on any
 * failure. It holds no state and touches no store: that is what lets React
 * Query wrap it as a `queryFn` later without this layer changing (ADR 0016
 * §10).
 *
 * Layer rule (ADR 0016 §1): may import `apiClient` and `config`. Never React,
 * never a store.
 *
 * ---
 * **THERE IS ONE FUNCTION HERE, AND THERE CAN NEVER BE A SECOND WRITE ONE.**
 *
 * §11 defines a single `GET` and no `POST`/`PATCH`/`DELETE`. `activities` rows
 * are **immutable** and are written only by the server's own fan-out, in the
 * same transaction as the ledger event that caused them (`backend/README.md`
 * §17's opening block: "`read` is the only mutable column in this domain", and
 * `activities` has no mutable column at all). So this client **reads** the
 * audit trail and can never add to it; if a write endpoint is ever wanted, it
 * is a contract change first.
 *
 * The practical consequence for this app: nothing above this layer may mint an
 * activity row of its own and merge it into a feed read from here. A
 * client-composed entry beside server-composed ones would be indistinguishable
 * in the UI and would not exist on any other device.
 *
 * ---
 * **FOUR THINGS THE FEED DOES THAT A CONSUMER MUST NOT "FIX".**
 *
 * 1. **It includes entries the caller did not cause.** The fan-out writes one
 *    privately-owned row per affected member, so a split another member saved
 *    is *this* account's own row with its own viewer-relative sentence (§11.1,
 *    `backend/README.md` §17.1). That is the point of the endpoint, not a leak.
 * 2. **`descriptionSuffix: ""` is normal, not missing data** — it is empty on
 *    every entry whose `entityName` is `null`, and `descriptionPrefix` is then
 *    the complete sentence (§17.1 point 4, §17.10). A consumer that treats `""`
 *    as absent renders a broken feed.
 * 3. **All four `related_*` ids may be `null`, and a row must render anyway.**
 *    They are navigation hints only.
 * 4. **`activityTime` is the SERVER's clock, not the device's.** It carries no
 *    zone: it is the instant the server composed the fan-out, in UTC
 *    (`backend/README.md` §17.8 flag 3). A member in another timezone reads a
 *    time that is not theirs. `createdAt` is the only field in the response
 *    that could be rendered correctly for a second timezone, and nothing in
 *    this app does that conversion today.
 */

/**
 * Builds a query string from the subset of §11.1's parameters a caller actually
 * supplied. `undefined` and `null` are dropped rather than sent as empty
 * values: `?groupId=` is not the same request as no `groupId` at all, and the
 * server binds these as typed `UUID`s (so a blank would be a `400`, not an
 * ignored filter).
 *
 * **A deliberate four-line copy of the same private helper in
 * transactionsApi.js/statisticsApi.js, not a shared import** — ADR 0016 §1's
 * module table gives each endpoint module `apiClient` + `config` as its
 * imports, and an endpoint module importing another endpoint module is not a
 * shape that table describes. statisticsApi.js records the same reasoning for
 * the same four lines.
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
 * `GET /api/v1/activities` -> `200 PageResponse<ActivityResponse>`
 * (api-overview.md §11.1): `{ content, page, size, totalElements, totalPages }`,
 * each entry being
 * `{ id, type, activityDate, activityTime, descriptionPrefix, entityName,
 *    descriptionSuffix, relatedTransactionId, relatedGroupId,
 *    relatedContactId, relatedSplitExpenseId, iconName, glyph, tone,
 *    createdAt }`.
 *
 * **Ordering is the server's and must not be re-sorted anywhere above this
 * layer.** It is `activityDate` desc, then `activityTime` desc, then `id` desc,
 * and `createdAt` appears in no `ORDER BY` in this domain (`backend/README.md`
 * §17.1/§17.7 note 2). The `id` tie-break matters more here than on
 * `GET /transactions`: **one fan-out writes several rows from a single computed
 * instant, so two rows sharing a date *and* a time is the normal case**. A
 * client re-sort — even a stable one on the same two fields — would disagree
 * with the server about which rows belong to which page, and a user scrolling
 * would see one entry twice and another not at all (§17.2).
 *
 * **All four filters are optional and they combine as AND**
 * (`backend/README.md` §17.8 flag 4 — §11.1 states no "exactly one of" rule,
 * unlike §9.3). Two of them behave in ways worth knowing at the call site:
 *
 * - **`transactionId` matches at most the actor's own row**, because
 *   `related_transaction_id` is written only on the row of the member whose
 *   personal transaction the *server* created. This app sends
 *   `addToPersonalExpenses: false` and writes that transaction itself
 *   (`utils/splitRequests.js`), so **no server-written row in this app's data
 *   carries one today** — the filter answers an empty page rather than being
 *   broken, and it becomes useful the day a `transaction_edited` writer exists
 *   (`backend/README.md` §17.10).
 * - **`contactId` can match a contact the reader does not own** — on an
 *   individual split the id written on every row is the actor's own contact for
 *   the other party. The ids are navigation only, so the worst case is a link
 *   that resolves to nothing for that reader (§17.2).
 *
 * **An unknown, other-user or deleted id is an empty page, never a `404`**
 * (§11.1 defines no error for these parameters, and a `404` would confirm
 * whether an id is real). So the only failures a caller has to handle are the
 * transport-level ones: `400 VALIDATION_ERROR` (a malformed uuid, or a
 * `page`/`size` out of bounds — neither of which this client can produce),
 * `401` (handled by `authorizedRequest`) and `429 RATE_LIMIT_EXCEEDED`.
 *
 * **Expect a thin feed.** Of the four documented `type` values, only
 * `split_saved` and `settlement` have a writer anywhere in the backend;
 * `group_created` and `transaction_edited` can never appear
 * (`backend/README.md` §17.8 flag 8). And `type` is returned verbatim from an
 * extensible union with no vocabulary check, so **a consumer must tolerate a
 * value it does not know rather than switch exhaustively on it** (flag 7).
 *
 * @param {{ transactionId?: string | null, groupId?: string | null,
 *           contactId?: string | null, splitExpenseId?: string | null,
 *           page?: number, size?: number }} [filters]
 * @returns {Promise<object>} PageResponse<ActivityResponse>
 */
export function listActivities(filters = {}) {
  const { page = 0, size = EVENT_FEED_PAGE_SIZE, ...rest } = filters;
  return authorizedRequest(`${ACTIVITY_PATHS.list}${buildQuery({ ...rest, page, size })}`);
}
