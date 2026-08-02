import { authorizedRequest } from './apiClient';
import { CATEGORY_PATHS } from './config';

/**
 * Categories (Domain 3) — one thin function per wired endpoint, the exact
 * shape authApi.js established and usersApi.js already follows
 * (docs/decisions/0016-frontend-api-integration.md §3.4). Contract:
 * docs/api/api-overview.md §3.1–§3.5, two-level shape per
 * docs/decisions/0019-subcategories-one-optional-level.md §7.
 *
 * **Every call here goes through `apiClient.authorizedRequest`.** All five
 * category endpoints require `Authorization: Bearer <accessToken>`
 * (api-overview.md §3), so `sendRequest` is never used directly and raw
 * `fetch` never appears: going through `authorizedRequest` is what attaches
 * the bearer and gets the single-flight refresh-on-401, the stale-token
 * comparison and the forced logout on a terminal 401 (ADR 0016 §6.2/§6.3).
 * None of that may be re-implemented or worked around here.
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
 * **`PATCH` (§3.3), `DELETE` (§3.4) and the usage pre-flight (§3.5) are wired
 * as of the rename/delete pass**
 * (docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md).
 * The previous note here said `PATCH` was deliberately absent because nothing
 * in the app could call it — Manage Categories now can, so it lands with the
 * screen that needs it, exactly as that note said it would (constitution
 * §3.5).
 *
 * **One consequence of ADR 0021 that is not visible in these signatures:** a
 * successful `PATCH` or `DELETE` here rewrites the category snapshot fields on
 * *transactions*, server-side. This module cannot act on that — it holds no
 * state and touches no store (ADR 0016 §1/§10) — so the refetch is
 * `useCategoriesStore`'s job, and that store's `updateCategory`/`deleteCategory`
 * own it. Do not add a cross-store call here.
 *
 * Category caps are still only half this module's business. Budget Settings
 * writes `monthlyCap` into `useCategoriesStore` as the user types and Save
 * snapshots it into the (still local) budget period
 * (docs/decisions/0010-budget-settings.md §2/§3), and that path is unchanged.
 * `updateCategory` below *can* persist a cap, because §3.3 accepts one and
 * Manage Categories' edit form sends it — the two surfaces now write the same
 * field by different routes, which is flagged in this round's report rather
 * than reconciled here.
 */

/**
 * `GET /api/v1/categories` -> `200 CategoryResponse[]`.
 *
 * **A two-level tree, not a flat list** (api-overview.md §3.1): the array
 * contains TOP-LEVEL categories only, and each one carries its children in
 * its own `subcategories` array. Each entry is
 * `{ id, name, iconName, glyph, monthlyCap, isDefault, isProtected,
 *    parentCategoryId, subcategories, createdAt, updatedAt }`, with
 * `parentCategoryId: null` and `subcategories: []` present rather than
 * omitted.
 *
 * **`isProtected` (added 2026-10-25, §3.1) is `true` on exactly one row per
 * user** — the seeded `Misc` category, which is the reassignment target
 * `deleteCategory` depends on. It cannot be renamed or deleted, so a client
 * reads this field to decide whether to offer those affordances and **never
 * matches the name `Misc`**: nothing in this API resolves a category by name,
 * and a user may own a separate category called `misc`.
 *
 * On a subcategory entry the server guarantees `subcategories: []` (the
 * one-level depth rule), `monthlyCap: null` (caps are top-level only) and
 * `isDefault: false` (nothing seeded is a child).
 *
 * Not paginated — this is a per-user list of a few dozen rows at most, and
 * §3.1 defines no `PageResponse` wrapper for it.
 *
 * @returns {Promise<object[]>} CategoryResponse[] (top-level entries)
 */
export function listCategories() {
  return authorizedRequest(CATEGORY_PATHS.list);
}

/**
 * `POST /api/v1/categories` -> `201 CategoryResponse`.
 *
 * One request shape creates **either level** (api-overview.md §3.2): omit
 * `parentCategoryId` (or send `null`) for a top-level category, or send one of
 * the caller's own top-level category ids to create a subcategory under it.
 *
 * `monthlyCap` is deliberately not a parameter: the only two creation surfaces
 * in the app (Category Picker's "Add Custom"/"Add Subcategory" and Budget
 * Settings' "Add Category") have no cap field, a cap on a subcategory is a
 * `400 VALIDATION_ERROR`, and a new top-level category's cap is set
 * afterwards. Adding it here would be a field no caller can fill.
 *
 * Errors worth knowing at the call site, all mapped to copy in
 * errorMessages.js: `409 CATEGORY_NAME_ALREADY_EXISTS` (case-insensitive,
 * scoped to the row's own siblings), `404 PARENT_CATEGORY_NOT_FOUND`,
 * `400 SUBCATEGORY_DEPTH_EXCEEDED`.
 *
 * @param {{ name: string, iconName: string, glyph: string, parentCategoryId?: string | null }} category
 * @returns {Promise<object>} CategoryResponse (`isDefault: false`, `subcategories: []`)
 */
export function createCategory({ name, iconName, glyph, parentCategoryId = null }) {
  return authorizedRequest(CATEGORY_PATHS.create, {
    method: 'POST',
    // `parentCategoryId` is sent as an explicit `null` for a top-level
    // create rather than omitted — §3.2 documents both as equivalent, and an
    // always-present key keeps one request shape for both levels.
    body: { name, iconName, glyph, parentCategoryId },
  });
}

/**
 * `PATCH /api/v1/categories/{id}` -> `200 CategoryResponse` (updated),
 * owner-scoped (api-overview.md §3.3).
 *
 * **Takes a prebuilt partial body**, the same signature and the same reason as
 * `transactionsApi.updateTransaction`: absent vs. explicit `null` is
 * meaningful here, so only the caller knows which fields the user actually
 * changed. A field the user did not touch **must not appear in the body at
 * all** — `null` is not "unchanged", it is "clear it", which for `monthlyCap`
 * means deleting a cap the user never went near. `useCategoriesStore` builds
 * the diff; nothing in this module reshapes it.
 *
 * Accepted fields: `name`, `iconName`, `glyph`, and `monthlyCap` (`null`
 * clears it). `parentCategoryId` is deliberately NOT one of them — a row's
 * level is fixed at creation and reparenting is still undesigned
 * (docs/decisions/0021-...md §2.6), so a mis-parented subcategory is deleted
 * and re-created rather than moved. `monthlyCap` on a **subcategory** is a
 * `400 VALIDATION_ERROR`; caps are top-level-only.
 *
 * **A successful name/icon/glyph change PROPAGATES to this category's
 * transactions, server-side** (§3.3, ADR 0021 §1) — two UPDATEs: the rows
 * tagged to this category, and `parentCategoryName` on the rows tagged to its
 * children. So every held `TransactionResponse` for those rows is stale the
 * moment this resolves. See the module note on whose job that is.
 *
 * Errors, all mapped to copy in errorMessages.js: `400 VALIDATION_ERROR`,
 * `400 CATEGORY_PROTECTED` (a `name` change on the protected row — its icon,
 * glyph and cap are still accepted), `404 CATEGORY_NOT_FOUND` (unknown or
 * another user's — never a `403`), `409 CATEGORY_NAME_ALREADY_EXISTS`
 * (case-insensitive, among this row's own siblings).
 *
 * @param {string} id
 * @param {{ name?: string, iconName?: string, glyph?: string, monthlyCap?: number | null }} changes
 *   Only the fields that changed.
 * @returns {Promise<object>} CategoryResponse (updated)
 */
export function updateCategory(id, changes) {
  return authorizedRequest(CATEGORY_PATHS.byId(id), {
    method: 'PATCH',
    body: changes,
  });
}

/**
 * `DELETE /api/v1/categories/{id}` -> `200 CategoryDeletionResponse`,
 * owner-scoped (api-overview.md §3.4).
 *
 * **No request body**, and `200` with a body rather than `204` — unlike
 * `transactionsApi.deleteTransaction`. The reason is in §3.4 and is worth
 * knowing at the call site: this delete mutates rows the caller did not name.
 * In one server-side transaction it reassigns every transaction tagged to this
 * category **or to one of its subcategories** to the protected `Misc`
 * category, then hard-deletes the subcategories and the row itself.
 *
 * `{ reassignedTransactionCount, deletedSubcategoryCount }` are
 * **after-the-fact facts, not a confirmation protocol** — there is no
 * two-phase delete, no token, and the §3.5 pre-flight count is never sent
 * back. They exist so a client can invalidate exactly what changed.
 *
 * **A second `DELETE` of the same id is `404 CATEGORY_NOT_FOUND`, and that is
 * success, not an error** (§3.4): the operation is idempotent in effect, not
 * in status code, and the row genuinely no longer exists. `useCategoriesStore`
 * applies that rule — the same arrangement `deleteTransaction`'s `404` already
 * has.
 *
 * Errors: `400 VALIDATION_ERROR` (malformed uuid),
 * `400 CATEGORY_PROTECTED` (the protected row can never be deleted — it is
 * the reassignment target every other delete depends on, which is why the UI
 * must not render the affordance at all), `404 CATEGORY_NOT_FOUND`.
 *
 * @param {string} id
 * @returns {Promise<object>} `{ reassignedTransactionCount, deletedSubcategoryCount }`
 */
export function deleteCategory(id) {
  return authorizedRequest(CATEGORY_PATHS.byId(id), { method: 'DELETE' });
}

/**
 * `GET /api/v1/categories/{id}/usage` -> `200 { categoryId,
 * transactionCount, subcategoryCount }`, owner-scoped and side-effect-free
 * (api-overview.md §3.5).
 *
 * **The delete pre-flight, and the only honest source of that count.** The
 * confirmation dialog has to warn *before* the user confirms, and §3.5 rejects
 * the two cheaper-looking alternatives with reasons: a count on
 * `GET /categories` would put an aggregate on the app's most-read structural
 * read, and deriving one from `useTransactionsStore` would be wrong by
 * construction — that store holds **one filtered page** of a paginated list,
 * so a category with 300 transactions, none of them on the loaded page, would
 * delete with no warning at all. **A client must never derive a total from a
 * paginated list.**
 *
 * `transactionCount` is computed over exactly the id set the delete reassigns
 * (`{id}` plus its subcategories when `{id}` is top-level), so the user cannot
 * be warned about one number and have another happen.
 *
 * **Advisory, never authoritative.** It may be stale by the time the `DELETE`
 * runs (another device), and **if this call fails the caller must show the
 * warning anyway rather than suppress it** — failing closed is the only safe
 * direction for a destructive act (§3.5, constitution §22).
 *
 * Asking about the protected category is a legal question with a legal answer:
 * there is no `CATEGORY_PROTECTED` here, only `400 VALIDATION_ERROR`
 * (malformed uuid) and `404 CATEGORY_NOT_FOUND`.
 *
 * @param {string} id
 * @returns {Promise<object>} `{ categoryId, transactionCount, subcategoryCount }`
 */
export function getCategoryUsage(id) {
  return authorizedRequest(CATEGORY_PATHS.usage(id));
}
