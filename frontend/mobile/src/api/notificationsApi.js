import { authorizedRequest } from './apiClient';
import { NOTIFICATION_PATHS, EVENT_FEED_PAGE_SIZE, UNREAD_BADGE_PROBE_SIZE } from './config';

/**
 * Notifications (Domain 7) — one thin function per wired endpoint, the exact
 * shape authApi.js established and every other module in this folder already
 * follows (docs/decisions/0016-frontend-api-integration.md §3.4). Contract:
 * docs/api/api-overview.md §12.1–§12.3, implemented per `backend/README.md`
 * §17.
 *
 * **Every call here goes through `apiClient.authorizedRequest`.** All three
 * endpoints require `Authorization: Bearer <accessToken>` and are owner-scoped
 * from the JWT principal, so `sendRequest` is never used directly and raw
 * `fetch` never appears: going through `authorizedRequest` is what attaches the
 * bearer and gets the single-flight refresh-on-401, the stale-token comparison
 * and the forced logout on a terminal 401 (ADR 0016 §6.2/§6.3). None of that
 * may be re-implemented or worked around here.
 *
 * These functions return the parsed response and throw `ApiError` on any
 * failure. They hold no state and touch no store: that is what lets React Query
 * wrap them as `queryFn`s/`mutationFn`s later without this layer changing
 * (ADR 0016 §10).
 *
 * Layer rule (ADR 0016 §1): may import `apiClient` and `config`. Never React,
 * never a store.
 *
 * ---
 * **BOTH WRITES ARE `PATCH`. `read` IS THE ONLY COLUMN EITHER ONE TOUCHES.**
 *
 * §12.2 is `PATCH /notifications/{id}/read` and §12.3 is
 * `PATCH /notifications/read-all` — **not** a `POST`, on either
 * (`backend/README.md` §17.4(e) names the verb specifically). Neither carries a
 * request body: the path *is* the instruction. There is no "mark unread", no
 * delete and no create anywhere in §12 — a notification row is produced only by
 * the server's own fan-out, so this client can mark one read and nothing else.
 *
 * ---
 * **A NOTIFICATION IS NOT NAVIGABLE, AND THAT IS STRUCTURAL.**
 *
 * `NotificationResponse` is exactly seven fields —
 * `{ id, type, message, notifDate, notifTime, read, createdAt }` — with **no
 * entity ids at all**: the row does not know which group, split or settlement
 * it describes, because `message` is the whole payload (`backend/README.md`
 * §17.3). So a consumer cannot offer a tap-through to the thing a notification
 * is about, and must not invent one by parsing `message`.
 *
 * `notifTime` is the **server's** clock in UTC, not the device's, for the same
 * reason `activityTime` is (§17.8 flag 3).
 */

/**
 * Builds a query string from the subset of §12.1's parameters a caller actually
 * supplied. `undefined` and `null` are dropped rather than sent as empty
 * values — `?read=` is not the same request as no `read` at all, and the server
 * binds it as a typed `Boolean` (so a blank would be a `400`, never a silently
 * ignored filter).
 *
 * **`false` is deliberately not dropped**, which is the whole reason the filter
 * is tested against `undefined`/`null` rather than for truthiness:
 * `?read=false` is the unread-badge query and the single most important request
 * in this module.
 *
 * A four-line copy of the same private helper in
 * transactionsApi.js/statisticsApi.js/activitiesApi.js, for the reason
 * statisticsApi.js records (ADR 0016 §1's module table gives each endpoint
 * module `apiClient` + `config` and nothing else).
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
 * `GET /api/v1/notifications` -> `200 PageResponse<NotificationResponse>`
 * (api-overview.md §12.1): `{ content, page, size, totalElements, totalPages }`.
 *
 * **Ordering is the server's and must not be re-sorted above this layer.** It
 * is `notifDate` desc, then `notifTime` desc, then `id` desc, with `createdAt`
 * in no `ORDER BY` — the same shape and the same prohibition as §11.1, and the
 * same reason the `id` tie-break is load-bearing: one fan-out writes several
 * rows from one instant, so ties are the normal case and a client re-sort would
 * disagree with the server's pagination (`backend/README.md`
 * §17.3/§17.7 note 2).
 *
 * `read` is an optional boolean filter. Omitting it returns both; `false`
 * returns the unread ones and is also the badge's query (see
 * `getUnreadNotificationCount`).
 *
 * **Expect a thin feed.** Of the four documented `type` values, only
 * `group_expense` and `settlement` have a writer anywhere in the backend —
 * `overspending` and `reminder` have none at all (`backend/README.md` §17.8
 * flag 8, §17.10). And `type` is returned verbatim from an extensible union
 * with no vocabulary check, so a consumer must tolerate a value it does not
 * know (flag 7).
 *
 * Errors: `400 VALIDATION_ERROR` (a non-boolean `read`, or a `page`/`size` out
 * of bounds — neither of which this client can produce), `401` (handled by
 * `authorizedRequest`), `429 RATE_LIMIT_EXCEEDED`.
 *
 * @param {{ read?: boolean | null, page?: number, size?: number }} [filters]
 * @returns {Promise<object>} PageResponse<NotificationResponse>
 */
export function listNotifications(filters = {}) {
  const { read = null, page = 0, size = EVENT_FEED_PAGE_SIZE } = filters;
  return authorizedRequest(`${NOTIFICATION_PATHS.list}${buildQuery({ read, page, size })}`);
}

/**
 * The unread count behind the header bell's badge — `GET
 * /api/v1/notifications?read=false&size=1`, read as
 * **`PageResponse.totalElements`**.
 *
 * ---
 * **THIS IS NOT `content.length`, AND THE DIFFERENCE IS THE WHOLE POINT.**
 *
 * `content.length` is capped by `size`. An account with 40 unread rows would
 * report `20` at the default page size and `1` at this one — so the badge would
 * render `9+` or `1` depending on nothing but a page parameter.
 * `totalElements` is the account's true unread count, it is the server's own
 * `select count(*) ... where user_id = ? and read = false`, and it is an index
 * scan on `idx_notifications_user_id_read` rather than a heap scan
 * (`backend/README.md` §17.5 states all of this explicitly).
 *
 * **There is no unread-count endpoint, and this client must not call one.**
 * `GET /notifications/unread-count` is *recommended and not built* — it is an
 * addition to §12 and therefore a System Architect decision (§17.5, §17.8
 * flag 1, §17.10). Until it lands, this probe is the contract-supported source.
 *
 * `size=1` keeps the discarded page one row instead of twenty; `size=0` is a
 * `400` by the server's page-size bound, so one is the floor.
 *
 * It returns the whole `PageResponse` rather than a bare number so the caller
 * can validate the shape before trusting the figure — an empty `200` body
 * resolves to `null` (ADR 0016 §3.1), and a number taken from a response nobody
 * checked is how a badge ends up rendering `NaN`.
 *
 * @returns {Promise<object>} PageResponse<NotificationResponse>, of which only
 *   `totalElements` is meaningful to the caller.
 */
export function getUnreadNotificationCount() {
  return listNotifications({ read: false, page: 0, size: UNREAD_BADGE_PROBE_SIZE });
}

/**
 * `PATCH /api/v1/notifications/{id}/read` -> `200 NotificationResponse` with
 * `read: true` (api-overview.md §12.2), owner-scoped.
 *
 * ---
 * **IDEMPOTENT, AND THE RESPONSE DOES NOT PROVE A CHANGE OCCURRED.**
 *
 * Calling it twice is a `200` both times, and the second call **writes
 * nothing**: the server deliberately skips the update when the row is already
 * read, so `updatedAt` does not move (`backend/README.md` §17.4(b)/§17.4's
 * closing paragraph — assigning `read = true` to a row that already has it
 * would still dirty the entity, still issue an `UPDATE` and still bump the
 * timestamp for a no-op). Do not fight that behaviour and do not read the
 * `200` as "a row changed"; the only thing it asserts is that the row is read
 * *now*.
 *
 * **`404 NOTIFICATION_NOT_FOUND` is the response for a notification that is
 * not the caller's**, byte-identical to the response for an id that never
 * existed — a `403` would confirm the row exists to someone who should not know
 * (§17.4(c), api-overview.md §2's owner-scoped convention). Its copy in
 * errorMessages.js therefore names the consequence and **never implies a
 * permissions problem**.
 *
 * A malformed id is `400 VALIDATION_ERROR`, not a `404` and not a `500`
 * (§17.4(d)) — unreachable from this app, which only ever echoes back an id the
 * server issued.
 *
 * @param {string} id A NotificationResponse `id`.
 * @returns {Promise<object>} NotificationResponse (`read: true`)
 */
export function markNotificationRead(id) {
  return authorizedRequest(NOTIFICATION_PATHS.markRead(id), { method: 'PATCH' });
}

/**
 * `PATCH /api/v1/notifications/read-all` -> `200 MessageResponse`
 * (api-overview.md §12.3), owner-scoped.
 *
 * ---
 * **IT ANSWERS A MESSAGE, NOT DATA — SO THE CALLER MUST RE-READ.**
 *
 * The response is `{ "message": "All notifications marked as read." }` and
 * nothing else: no rows, no count, no `updatedAt`. This is a **bulk `UPDATE`**
 * that bypasses the persistence context entirely, and the server owns the
 * `updated_at` it writes (`backend/README.md` §17.4's `updated_at` discussion).
 * So the only correct way to learn what the list and the badge now look like is
 * to read them again — patching held rows to `read: true` locally would be a
 * second, guessed source of truth for a value this response does not carry.
 *
 * **Zero affected rows is a success**, not a `404` and not a `409`: calling it
 * on an account with nothing unread returns the identical `200`
 * (§17.4(f)). It is therefore safe to call speculatively, and there is no
 * error code specific to this endpoint at all.
 *
 * `read-all` cannot collide with `{id}/read` — one path segment versus two —
 * so it is never parsed as a notification id (§17.4).
 *
 * @returns {Promise<object>} MessageResponse
 */
export function markAllNotificationsRead() {
  return authorizedRequest(NOTIFICATION_PATHS.markAllRead, { method: 'PATCH' });
}
