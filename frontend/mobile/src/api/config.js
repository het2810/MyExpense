import { NativeModules } from 'react-native';

/**
 * API configuration — docs/decisions/0016-frontend-api-integration.md §2.
 *
 * This is the ONLY file that decides where the backend lives. Everything
 * else in src/api/ asks this module. That containment is deliberate: when a
 * real production environment (or a .env / build-flavor scheme) eventually
 * exists, it is a one-file change here rather than a hunt through the
 * transport layer.
 *
 * Layer rule (ADR 0016 §1): this file may import from `react-native` only.
 * It must never import React, a store, or another api/ module.
 *
 * ---
 * CLEARTEXT (http://) IN DEVELOPMENT — checked against this project's actual
 * native config, because ADR 0016 §2 flags it as an afternoon-sized trap.
 * **No native change was needed on either platform; do not "fix" this.**
 *
 * - Android: `AndroidManifest.xml` already carries
 *   `android:usesCleartextTraffic="${usesCleartextTraffic}"`, and React
 *   Native's own Gradle plugin sets that placeholder to `true` for the debug
 *   build types and `false` for release. Debug therefore already permits
 *   cleartext to any host, including a LAN IP; release already blocks it.
 *   There is no `network_security_config.xml` in this project, and adding one
 *   would NARROW what debug currently allows.
 * - iOS: `Info.plist` already sets `NSAllowsArbitraryLoads=false` with
 *   `NSAllowsLocalNetworking=true`, which permits cleartext to localhost and
 *   to private/link-local (RFC 1918) addresses — i.e. exactly a dev machine's
 *   LAN IP — without opening up public cleartext.
 *
 * Production remains HTTPS-only (security-architecture.md §6): PROD_API_BASE_URL
 * must be an https:// URL, and release builds block cleartext regardless.
 */

// 1. Explicit local override for a developer's own machine.
//    MUST remain null in committed source (ADR 0016 §2) — any diff that sets
//    this to a real value is a review blocker. Set it locally (and revert
//    before committing) when testing on a physical Android device over
//    `adb reverse`, where neither the Metro-derived host nor the platform
//    fallback below can produce a reachable address.
const DEV_API_HOST_OVERRIDE = null;

// 2. Production base URL. No deployed backend exists yet (ADR 0016 §2 /
//    "Out of scope"). Deliberately null so a release build fails loudly
//    instead of silently pointing at nothing. Must be https:// when it is
//    filled in — docs/architecture/security-architecture.md §6.
const PROD_API_BASE_URL = null;

const API_PORT = 8080;
const API_PREFIX = '/api/v1';

/** Default request timeout. Mobile networks: long enough not to false-positive
 *  on a slow connection, short enough that a dead backend doesn't hang the UI
 *  indefinitely (ADR 0016 §3.1). */
export const DEFAULT_TIMEOUT_MS = 15000;

/** Logout must not make the user wait on a dead network (ADR 0016 §6.4). */
export const LOGOUT_TIMEOUT_MS = 5000;

/** Refresh this long before the access token actually expires (ADR 0016 §6.2). */
export const REFRESH_SKEW_MS = 60000;

export const AUTH_PATHS = {
  register: '/auth/register',
  login: '/auth/login',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  forgotPassword: '/auth/forgot-password',
};

/**
 * User & Settings — docs/api/api-overview.md §2. Every one of these requires
 * a bearer token, so they are reached through `apiClient.authorizedRequest`
 * rather than `sendRequest` (see usersApi.js).
 *
 * There is deliberately no `/users/{id}`: the backend exposes `/users/me`
 * only, with the principal taken from the JWT (api-overview.md §2 /
 * security-architecture.md §2), so there is no client-supplied id to build a
 * path from here.
 */
export const USER_PATHS = {
  me: '/users/me',
  settings: '/users/me/settings',
  premium: '/users/me/premium',
};

/**
 * Categories — docs/api/api-overview.md §3. Every one requires a bearer
 * token, so they are reached through `apiClient.authorizedRequest` (see
 * categoriesApi.js).
 *
 * Subcategories ride on this same collection (`POST /categories` takes an
 * optional `parentCategoryId`), so there is **no
 * `/categories/{id}/subcategories` sub-resource** to add a path for
 * (docs/decisions/0019-subcategories-one-optional-level.md §7).
 *
 * **`byId` and `usage` added with the category rename/delete pass**
 * (api-overview.md §3.3/§3.4/§3.5,
 * docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md).
 * The two notes that used to sit here — "there is no DELETE" and "`PATCH
 * /categories/{id}` has no entry on purpose: nothing in the app can call it
 * yet" — are both discharged: the endpoints exist and Manage Categories now
 * calls all four. The rule those notes came from is unchanged and still
 * applies to the next endpoint (ADR 0016 §3.4): a path is added here only when
 * something in the app can actually call it.
 *
 * `byId` serves BOTH `PATCH` (§3.3) and `DELETE` (§3.4) — one path shape, one
 * place it is written, exactly as `TRANSACTION_PATHS.byId` serves three
 * methods. `usage` is a read-only sub-resource of a single category (§3.5),
 * not a second collection; it is the delete pre-flight and nothing else reads
 * it. Both percent-encode the id for the reason TRANSACTION_PATHS records.
 */
export const CATEGORY_PATHS = {
  list: '/categories',
  create: '/categories',
  /**
   * `PATCH` (§3.3) and `DELETE` (§3.4).
   *
   * @param {string} id A CategoryResponse `id`.
   * @returns {string} e.g. '/categories/8f1c…'
   */
  byId: (id) => `/categories/${encodeURIComponent(id)}`,
  /**
   * `GET` only — the delete pre-flight count (§3.5).
   *
   * @param {string} id A CategoryResponse `id`.
   * @returns {string} e.g. '/categories/8f1c…/usage'
   */
  usage: (id) => `/categories/${encodeURIComponent(id)}/usage`,
};

/**
 * Transactions — docs/api/api-overview.md §4. Every one requires a bearer
 * token, so they are reached through `apiClient.authorizedRequest` (see
 * transactionsApi.js).
 *
 * `byId` was **the first parameterized path in this file** and is the one the
 * two in CATEGORY_PATHS above now follow. It is a function rather than a
 * template the caller assembles so that the `/transactions/{id}`
 * shape is written exactly once. The id is a server-issued UUID the client only
 * ever echoes back, but it is still percent-encoded: a path segment built from
 * data is a path segment built from data, and the encoding costs nothing
 * (security-architecture.md §3 — never trust a value just because we believe we
 * know where it came from).
 *
 * `POST /receipts/upload-signature` (§4's endpoint table, added 2026-10-23) has
 * no entry here **on purpose**: that endpoint is not implemented on the backend
 * and nothing in the app can call it, so neither its path nor a wrapper for it
 * is added — the same rule and the same reasoning as `PATCH /users/me` in
 * USER_PATHS, and the rule CATEGORY_PATHS above records as still standing now
 * that its own two deferrals are discharged (ADR 0016 §3.4). The consequence
 * for this round is recorded in transactionsApi.js: `receiptPublicId` is a
 * field the app reads and can clear, never one it can populate.
 *
 * There is deliberately **no `sort` query parameter** either — §4.1 defines
 * none, and the server's ordering is a fixed literal in its repository
 * (`txnDate desc, txnTime desc, createdAt desc, id desc`). A client-supplied
 * sort string would be inventing contract.
 */
export const TRANSACTION_PATHS = {
  list: '/transactions',
  create: '/transactions',
  /**
   * @param {string} id A TransactionResponse `id`.
   * @returns {string} e.g. '/transactions/8f1c…'
   */
  byId: (id) => `/transactions/${encodeURIComponent(id)}`,
};

/**
 * Page size for `GET /transactions` (§4.1).
 *
 * **Deliberately the contract's own documented default (`20`) rather than a
 * larger number.** §4.1 states a default and no maximum, so any larger value
 * would be relying on an undocumented server limit; asking for exactly the
 * documented default cannot be clamped or rejected. It is sent explicitly
 * rather than omitted so the client's own page arithmetic is based on a value
 * this file states, not on a default that could change under it.
 */
export const TRANSACTION_PAGE_SIZE = 20;

/**
 * Statistics — docs/api/api-overview.md §14, specified by
 * docs/decisions/0022-statistics-expenses-by-parent-category.md. It requires a
 * bearer token and is owner-scoped from the JWT principal, so it is reached
 * through `apiClient.authorizedRequest` (see statisticsApi.js).
 *
 * **One path, and there is deliberately nothing else to put here.** §14 defines
 * a single endpoint. The drill-down behind a tapped category is
 * `GET /transactions?categoryId=&dateFrom=&dateTo=` (§4.1) — i.e.
 * `TRANSACTION_PATHS.list` above, which already rolls a parent up over its
 * subcategories server-side — because *this endpoint owns every total and
 * `GET /transactions` owns every list* (ADR 0022 §6). No
 * `/statistics/categories/{id}/transactions` exists, and writing one here
 * would be inventing contract.
 *
 * Not a function, unlike the two parameterized paths above: §14 takes no path
 * segment, only the optional `dateFrom`/`dateTo` query parameters that
 * statisticsApi.js builds and encodes. **There is no `type` parameter to
 * spell** — §14 counts `type = 'expense'` as a server-side invariant and income
 * is structurally unreachable rather than filtered out (ADR 0022 §1), so there
 * is nothing for a caller to pass.
 *
 * The rule the two blocks above record still applies (ADR 0016 §3.4): a path is
 * added here only when something in the app can actually call it. The
 * Statistics tab can.
 */
export const STATISTICS_PATHS = {
  categories: '/statistics/categories',
};

/**
 * Budget — docs/api/api-overview.md §5. Owner-scoped, bearer-token only (see
 * budgetApi.js). `GET /budget/periods/{id}` (§5.3) has no entry: nothing in
 * the app reads a period other than the active one yet (ADR 0016 §3.4).
 */
export const BUDGET_PATHS = {
  activePeriod: '/budget/active-period',
  upsertPeriod: '/budget/periods',
};

/**
 * Contacts — docs/api/api-overview.md §6. Owner-scoped, bearer-token only, so
 * both are reached through `apiClient.authorizedRequest` (see contactsApi.js).
 *
 * **`POST /contacts/{id}/invite` (§6.3) has no entry here on purpose.** The app
 * has no resend-invite affordance: an invite fires implicitly when a contact is
 * created with an unmatched phone (§6.2), and nothing in the UI can re-trigger
 * one. A path for an endpoint nothing can call is dead code — the same rule
 * TRANSACTION_PATHS records for `POST /receipts/upload-signature` (ADR 0016
 * §3.4). It lands with the affordance, not before it.
 */
export const CONTACT_PATHS = {
  list: '/contacts',
  create: '/contacts',
};

/**
 * Groups — docs/api/api-overview.md §7. All membership-gated (never
 * owner-scoped), bearer-token only; see groupsApi.js.
 *
 * `byId` serves `GET /groups/{id}` (§7.3) only, and it exists because there is
 * a real caller: **a settlement re-reads its group afterwards** rather than
 * mutating a held `yourBalance`, since a group balance is shared state that
 * another member can move (ADR 0023 §1, its Frontend follow-up). Percent-encoded
 * for the reason TRANSACTION_PATHS records.
 *
 * **`POST /groups/{id}/members` (§7.4) has no entry here on purpose**, the same
 * rule as §6.3 above: membership is only ever set at creation time in this app
 * (`memberContactIds` on §7.2), and no screen can add a member to an existing
 * group. Its `409 ALREADY_A_MEMBER` is nonetheless mapped in errorMessages.js —
 * see the note there.
 */
export const GROUP_PATHS = {
  list: '/groups',
  create: '/groups',
  /**
   * `GET` only (§7.3).
   *
   * @param {string} id A GroupResponse `id`.
   * @returns {string} e.g. '/groups/8f1c…'
   */
  byId: (id) => `/groups/${encodeURIComponent(id)}`,
};

/**
 * The shared ledger — individual balances (§8.1), split expenses (§9.1/§9.3)
 * and settlements (§10.1). All membership-gated, all bearer-token only; see
 * splitsApi.js.
 *
 * `splitExpenseById` (§9.2/§9.4/§9.5) and the two feed paths (§7.5/§8.2) were
 * added with docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md:
 * Split Expense Detail now opens, edits and deletes one split, and Split Detail
 * reads the feeds. The rule of ADR 0016 §3.4 still holds — each has a caller.
 *
 * Note the two different prefixes, which are the contract's own and not a typo:
 * balances and settlements live under `/splits`, while split expenses are a
 * top-level `/split-expenses` collection.
 */
export const SPLIT_PATHS = {
  individualBalances: '/splits/individuals',
  splitExpenses: '/split-expenses',
  settle: '/splits/settle',
  /**
   * `GET` (§9.2), `PUT` (§9.4) and `DELETE` (§9.5) — docs/decisions/
   * 0028-split-expense-edit-delete-feeds-and-balance-copy.md §6/§11.1. The
   * "no `byId` on purpose" note above is discharged: Split Expense Detail now
   * opens one split on its own, and edits and deletes it.
   *
   * @param {string} id A SplitExpenseResponse `id`.
   * @returns {string}
   */
  splitExpenseById: (id) => `/split-expenses/${encodeURIComponent(id)}`,
  /**
   * `GET` only — the group feed (§7.5, ADR 0028 §7).
   *
   * @param {string} groupId
   * @returns {string}
   */
  groupFeed: (groupId) => `/groups/${encodeURIComponent(groupId)}/feed`,
  /**
   * `GET` only — the pair feed (§8.2, ADR 0028 §7).
   *
   * @param {string} individualBalanceId
   * @returns {string}
   */
  pairFeed: (individualBalanceId) =>
    `/splits/individuals/${encodeURIComponent(individualBalanceId)}/feed`,
};

/**
 * Page size for the two split feeds (§7.5/§8.2). The contract's own documented
 * default (`30`, max `100`), sent explicitly for the reason
 * TRANSACTION_PAGE_SIZE records.
 */
export const SPLIT_FEED_PAGE_SIZE = 30;

/**
 * Activity log — docs/api/api-overview.md §11. Owner-scoped, bearer-token only;
 * see activitiesApi.js.
 *
 * **One path, and §11 defines nothing else.** There is a single `GET` and no
 * write endpoint of any kind: an `activities` row is immutable, written only by
 * the server's own fan-out, and an audit trail that a client can rewrite is not
 * an audit trail (`backend/README.md` §17's opening block). So there is no
 * `create`, no `byId` and nothing here for a mutation to use — adding one would
 * be inventing contract (constitution §15/§30).
 *
 * The four optional `related_*` filters (`transactionId`, `groupId`,
 * `contactId`, `splitExpenseId`) are **query parameters, not path segments**, so
 * they are built and encoded in activitiesApi.js rather than spelled here —
 * exactly as STATISTICS_PATHS leaves `dateFrom`/`dateTo` to its own module.
 * There is deliberately **no `settlementId`**: `activities` has no
 * `related_settlement_id` column at all (`backend/README.md` §17.2), so a
 * settlement entry is filterable by its group or its contact and by nothing
 * else.
 *
 * No `sort` parameter either (§17.7 note 9): the ordering is a literal inside
 * the server's own query and nothing a client sends reaches an `ORDER BY`.
 */
export const ACTIVITY_PATHS = {
  list: '/activities',
};

/**
 * Notifications — docs/api/api-overview.md §12. Owner-scoped, bearer-token
 * only; see notificationsApi.js.
 *
 * **Note the verbs: both writes are `PATCH`** (§12's own endpoint table, and
 * `backend/README.md` §17.4(e) calls it out specifically). A `POST` to
 * `/read-all` is not the contract.
 *
 * `markAllRead` is a fixed single-segment path and `markRead` is a
 * two-segment one, which is what keeps `read-all` from ever being parsed as a
 * notification id (§17.4). `markRead` percent-encodes its id for the reason
 * TRANSACTION_PATHS records.
 *
 * **There is deliberately no `unreadCount` entry.**
 * `GET /notifications/unread-count` is *recommended and not built*
 * (`backend/README.md` §17.5/§17.8 flag 1/§17.10 — it needs a System Architect
 * ruling because it is an addition to §12). Until it exists the badge reads
 * `totalElements` off `?read=false&size=1`, so there is no second path to add
 * and nothing in this app can call one (ADR 0016 §3.4's rule: a path lands here
 * only when something can actually call it).
 */
export const NOTIFICATION_PATHS = {
  list: '/notifications',
  /**
   * `PATCH` only — mark one read (§12.2).
   *
   * @param {string} id A NotificationResponse `id`.
   * @returns {string} e.g. '/notifications/8f1c…/read'
   */
  markRead: (id) => `/notifications/${encodeURIComponent(id)}/read`,
  /** `PATCH` only — mark every unread one read (§12.3). */
  markAllRead: '/notifications/read-all',
};

/**
 * Change log — docs/api/api-overview.md §15.6/§15.7,
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §6.5.
 * Owner-scoped, bearer-token only, read-only; see changeLogApi.js.
 *
 * `entityType` / `entityId` / `page` / `size` are query parameters built and
 * encoded in changeLogApi.js, exactly as ACTIVITY_PATHS leaves its filters to
 * its own module. `byId` percent-encodes for the reason TRANSACTION_PATHS
 * records.
 */
export const CHANGE_LOG_PATHS = {
  list: '/change-log',
  /**
   * @param {string} id A ChangeLogEntryResponse `id`.
   * @returns {string} e.g. '/change-log/8f1c…'
   */
  byId: (id) => `/change-log/${encodeURIComponent(id)}`,
};

/**
 * Page size for `GET /activities` (§11.1) and `GET /notifications` (§12.1).
 *
 * Both contracts state a default of `20` and no maximum, so — exactly as
 * TRANSACTION_PAGE_SIZE records — this is the documented default rather than a
 * larger guess: a bigger value would be relying on an undocumented server
 * limit, while asking for precisely the documented default cannot be clamped or
 * rejected. (The server's real cap is `100`, but that number is derived rather
 * than specified — `backend/README.md` §17.8 flag 5 — so this client does not
 * build on it.) Sent explicitly rather than omitted so the page arithmetic in
 * the stores is based on a value this file states.
 *
 * One constant for both feeds, not two: they are the two halves of the same
 * event-feed surface and there is no reason for them to drift apart.
 */
export const EVENT_FEED_PAGE_SIZE = 20;

/**
 * The page size used **only** by the unread-badge probe.
 *
 * The badge is `PageResponse.totalElements` from
 * `GET /notifications?read=false&size=1` — the account's true unread count,
 * which is **not** `content.length` (that is capped by `size` and would render
 * a 20-unread account as `9+` or as `9` depending on nothing but the page size;
 * `backend/README.md` §17.5 is explicit about it).
 *
 * `1` rather than `0` because `size=0` is a `400 VALIDATION_ERROR` by the
 * server's page-size bound, so one is the floor: the one discarded row is the
 * unavoidable cost of there being no count endpoint yet (§17.5's recommended,
 * unbuilt `GET /notifications/unread-count`).
 */
export const UNREAD_BADGE_PROBE_SIZE = 1;

/**
 * Pulls the host out of a URL without relying on a full URL parser (React
 * Native's `URL` implementation is partial and platform-dependent).
 *
 * @param {string | undefined | null} url e.g. 'http://192.168.1.5:8081/index.bundle?platform=android'
 * @returns {string | null} e.g. '192.168.1.5'
 */
function parseHost(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  const match = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/:?#]+)/);
  return match ? match[1] : null;
}

/**
 * Reads Metro's bundle URL.
 *
 * Under the New Architecture `SourceCode` is a TurboModule, so its constants
 * may be exposed either directly on the NativeModules proxy or only through
 * `getConstants()` depending on how the module is reached. Both are tried;
 * if neither is available the caller falls back to the platform default,
 * which is the correct answer on an emulator/simulator anyway.
 *
 * @returns {string | null}
 */
function readMetroScriptUrl() {
  const sourceCode = NativeModules?.SourceCode;
  if (!sourceCode) {
    return null;
  }
  if (typeof sourceCode.scriptURL === 'string') {
    return sourceCode.scriptURL;
  }
  if (typeof sourceCode.getConstants === 'function') {
    return sourceCode.getConstants()?.scriptURL || null;
  }
  return null;
}

/**
 * Dev-only host resolution (ADR 0016 §2).
 *
 * `NativeModules.SourceCode.scriptURL` in a dev build is the Metro bundler
 * URL. The device is *already* talking to the dev machine over that address —
 * that is how it got its JS bundle — so for a physical device it is, by
 * construction, a reachable LAN IP obtained at runtime and never committed.
 *
 * When Metro is reached through `adb reverse` (the default for
 * `react-native run-android`) the host is `localhost`, which says nothing
 * about where the API is; that is exactly the case the platform fallback
 * covers. The one case neither covers — a physical Android device over
 * `adb reverse` — is what DEV_API_HOST_OVERRIDE exists for.
 */
function resolveDevHost() {
  const metroHost = parseHost(readMetroScriptUrl());
  if (metroHost && metroHost !== 'localhost' && metroHost !== '127.0.0.1') {
    return metroHost;
  }
  // Metro resolving to localhost means the bundle arrived through an adb
  // tunnel (`adb reverse tcp:8081`), which react-native run-android sets up
  // for emulators *and* physical devices alike. The same tunnel mechanism
  // carries the API port, so `localhost` is correct for both — provided
  // `adb reverse tcp:8080 tcp:8080` has been run (see backend/README.md).
  //
  // This deliberately does NOT return Android's 10.0.2.2 here. That address
  // is the *emulator's* alias for the host machine and is unroutable on a
  // physical device, so returning it produced a request that hung until the
  // timeout instead of failing fast — the exact symptom seen on 2026-09-13.
  // An emulator running without the API port forwarded is the one case that
  // still needs DEV_API_HOST_OVERRIDE = '10.0.2.2'.
  return 'localhost';
}

/**
 * @returns {string} Base URL including the /api/v1 prefix, no trailing slash.
 * @throws {Error} In a release build with no PROD_API_BASE_URL configured.
 */
export function getApiBaseUrl() {
  if (!__DEV__) {
    if (!PROD_API_BASE_URL) {
      throw new Error('No production API base URL is configured.');
    }
    return PROD_API_BASE_URL;
  }
  const host = DEV_API_HOST_OVERRIDE || resolveDevHost();
  return `http://${host}:${API_PORT}${API_PREFIX}`;
}

/**
 * @param {string} path A leading-slash path relative to the API prefix, e.g. '/auth/login'.
 * @returns {string}
 */
export function buildUrl(path) {
  return `${getApiBaseUrl()}${path}`;
}
