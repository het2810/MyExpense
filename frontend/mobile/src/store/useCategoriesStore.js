import { create } from 'zustand';
import * as categoriesApi from '../api/categoriesApi';
import { isApiError } from '../api/apiError';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { buildCategoryCreateFields, findCategoryEntry } from '../utils/categories';
import { insertCategory, applyCategoryUpdate, removeCategory } from '../utils/categoryTree';
import { bindStorePersistence } from '../offline/persistence';
import {
  buildCategoryCreateOp,
  buildCategoryUpdateOp,
  buildCategoryDeleteOp,
} from '../offline/operations/categories';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import { useTransactionsStore } from './useTransactionsStore';
import {
  CACHE_CONTRACT_STATE,
  OFFLINE_WRITES_ENABLED,
  enqueueWrite,
  keepsSnapshotOnFailure,
  nowIso,
  shouldFetch,
} from './offlineStoreSupport';

/**
 * The signed-in account's categories — server-backed by `GET`/`POST
 * /api/v1/categories` (docs/api/api-overview.md §3.1/§3.2) as of Domain 3's
 * wiring step (docs/roadmap/backend-build-order.md workflow step 3), and by
 * `PATCH`/`DELETE /categories/{id}` plus the `GET /categories/{id}/usage`
 * pre-flight (§3.3–§3.5) as of the rename/delete pass. Until Domain 3's wiring
 * this held an 8-entry local mock, including the `cat-income` row that
 * docs/decisions/0018-income-is-not-a-category.md removed.
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1).
 * Every call goes through `categoriesApi`, i.e. through
 * `apiClient.authorizedRequest`. The orchestration (guard -> request ->
 * state) lives here, never in a screen (constitution §8).
 *
 * ---
 * **SHAPE: THE API'S NESTED TREE, HELD VERBATIM.**
 *
 * `categories` is the response of `GET /categories`: a **top-level array**,
 * each entry carrying `parentCategoryId` (always present, `null` here) and
 * `subcategories` (always present, `[]` for a child — the server's one-level
 * depth rule guarantees a child never has children of its own).
 *
 *   [{ id, name, iconName, glyph, monthlyCap, isDefault,
 *      parentCategoryId: null, subcategories: [ ...same shape... ],
 *      createdAt, updatedAt }]
 *
 * Nested rather than flat, and that is load-bearing rather than cosmetic
 * (docs/decisions/0019-subcategories-one-optional-level.md §1/§7): **no
 * consumer adds a filter to find the level it wants.** Budget Settings builds
 * its Category Caps rows by mapping this array, so a flat list containing
 * children would have put subcategory rows — which cannot carry a cap at all
 * — into the caps list on day one. That is the same "filters are a discipline;
 * structure is not" failure ADR 0018 was written to remove, and this codebase
 * had already demonstrated it twice.
 *
 * ---
 * **A CATEGORY WRITE NOW INVALIDATES THE TRANSACTIONS CACHE.**
 *
 * Since docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md
 * a category `PATCH` **rewrites the category snapshot fields on that
 * category's existing transactions**, server-side, and a `DELETE` reassigns
 * them to the protected `Misc` category. `useTransactionsStore`'s own
 * staleness note states the consequence and names the remedy —
 * `loadTransactions({ force: true })` — and says the pass that adds the rename
 * and delete affordances must add the call. **This is that call site**, and it
 * lives here rather than in a screen or a hook on purpose: a refetch that each
 * future call site has to remember is a refetch that will be forgotten, and
 * Dashboard and Transaction Detail would then keep rendering a name the server
 * has already changed. See `invalidateTransactionsAfterCategoryWrite` below.
 *
 * ---
 * **WHAT RESETS ON SIGN-OUT, AND WHY IT ISN'T OPTIONAL.**
 *
 * These are one account's own rows, so they are registered with
 * `signOutReset.js` and every request is epoch-guarded, exactly as
 * `useProfileStore`/`useSettingsStore` already are. Without it, signing out
 * and in as another account would render the previous user's categories — and
 * because the loader is cache-first, a `GET /categories` still in flight when
 * Log Out is tapped would write them straight back into a store that had just
 * been cleared, where they would then be *skipped over* rather than refetched
 * for the whole next session.
 */

const INITIAL_STATE = {
  /**
   * @type {object[]} Top-level categories, each with its own `subcategories`.
   * Empty until a read succeeds — deliberately, rather than seeded with the
   * server's seven defaults: a local placeholder list would be a second,
   * unauthoritative category set, and a tile the user could tap would resolve
   * to an id no transaction can reference. `hasLoaded` is what says the real
   * rows are known, and the surfaces that read this render a loading or empty
   * state until then (constitution §22).
   */
  categories: [],

  /** GET in flight. */
  isLoading: false,
  /** True once a GET has succeeded — i.e. `categories` is the server's. */
  hasLoaded: false,
  /** User-facing copy for a failed GET (constitution §22), or null. */
  loadError: null,
  /**
   * POST in flight. One slot, so the "Add Custom" and "Add Subcategory" forms
   * disable together — the same single-slot reasoning `useSettingsStore`'s
   * `pendingField` records: it bounds a user holding down a button at one
   * request per confirmed create, and removes any need to reconcile two
   * creates answered out of order.
   */
  isCreating: false,
  /**
   * A `PATCH /categories/{id}` is in flight. One slot, for the same reason
   * `isCreating` is one: Manage Categories opens one edit form at a time, and
   * two edits answered out of order would leave the tree holding whichever
   * reply happened to land last rather than whichever the user confirmed last.
   */
  isUpdating: false,
  /**
   * A `DELETE /categories/{id}` is in flight. Separate from `isUpdating` so
   * the edit form and the delete dialog each disable only themselves — they
   * are different affordances on the same row, and a delete must not look like
   * a failed save.
   */
  isDeleting: false,
  ...CACHE_CONTRACT_STATE,
};

/**
 * Validates and normalizes `GET /categories`. Returns the tree, or `null` when
 * the response is not a category list at all.
 *
 * `httpClient` already normalizes unparseable JSON, but an empty `200` body
 * resolves to `null` (ADR 0016 §3.1), and a proxy or captive portal can hand
 * back something else entirely — neither may reach a `.map()` in a screen.
 *
 * Normalization fills the two keys the contract says are always present, so
 * no consumer has to defend against their absence, and **drops any top-level
 * entry that declares a parent.** The contract says the top level contains
 * top-level rows only; this is defence in depth against a flat response (the
 * shape `/sync/pull` is allowed to use, api-overview.md §13.2, and the shape
 * this endpoint had before 2026-10-22), where children would otherwise land
 * in Budget Settings' caps list. Nothing is renamed or reshaped
 * (constitution §15/§30).
 *
 * @param {unknown} response
 * @returns {object[] | null}
 */
function toCategoryTree(response) {
  if (!Array.isArray(response)) {
    return null;
  }
  if (!response.every(isCategoryEntry)) {
    return null;
  }
  return response
    .filter((entry) => entry.parentCategoryId == null)
    .map((entry) => ({
      ...entry,
      parentCategoryId: null,
      monthlyCap: entry.monthlyCap ?? null,
      subcategories: (Array.isArray(entry.subcategories) ? entry.subcategories : [])
        .filter(isCategoryEntry)
        .map((subcategory) => ({
          ...subcategory,
          // A child's own `subcategories` is always `[]` server-side (the
          // depth rule) and its cap is always null (a CHECK constraint) — both
          // are asserted here rather than trusted, so one bad row cannot make
          // a cap field appear on a subcategory or a third level render.
          subcategories: [],
          monthlyCap: null,
        })),
    }));
}

/**
 * The minimum a row needs to be rendered and selected: an id to key and
 * reference it by, a name to show, and a glyph for `IconBadge` (which cannot
 * render without one).
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isCategoryEntry(entry) {
  return (
    entry != null &&
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.glyph === 'string'
  );
}

/**
 * True when the session changed while a request was in flight, meaning its
 * answer belongs to an account that is no longer signed in and must be
 * discarded rather than written into state (see signOutReset.js — the same
 * guard ADR 0016 §6.6 applies to a rotation that outlives its session).
 *
 * Returning without clearing the in-flight flag is deliberate and safe: the
 * sign-out reset has already restored INITIAL_STATE, flags included.
 *
 * @param {number} epochAtStart
 * @returns {boolean}
 */
function hasSessionChanged(epochAtStart) {
  return getSessionEpoch() !== epochAtStart;
}

/**
 * Validates a `GET /categories/{id}/usage` response (§3.5). Returns the two
 * counts, or `null` when the response is not a usage answer at all.
 *
 * Strict on purpose: this is the number a destructive confirmation is worded
 * from, and the caller's failure path is to warn anyway. A malformed body must
 * therefore be treated as "unknown" rather than coerced — `Number(undefined)`
 * is `NaN`, and `NaN > 0` is `false`, which is precisely the suppressed
 * warning §3.5 forbids.
 *
 * @param {unknown} response
 * @returns {{ transactionCount: number, subcategoryCount: number } | null}
 */
function toCategoryUsage(response) {
  if (
    response == null ||
    !Number.isFinite(response.transactionCount) ||
    !Number.isFinite(response.subcategoryCount)
  ) {
    return null;
  }
  return {
    transactionCount: response.transactionCount,
    subcategoryCount: response.subcategoryCount,
  };
}

/**
 * `404 CATEGORY_NOT_FOUND` — unknown, another user's, or already deleted; the
 * contract deliberately makes those indistinguishable and never answers a
 * `403` (api-overview.md §3's owner-scoped convention). Whichever it is, the
 * held row is a ghost.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isCategoryGone(error) {
  return isApiError(error) && error.code === 'CATEGORY_NOT_FOUND';
}

/**
 * Re-reads page 0 of `GET /transactions` after a confirmed category write —
 * ADR 0021's frontend follow-ups 3 and 4, and the call site
 * `useTransactionsStore`'s staleness note asks for.
 *
 * **Not awaited, deliberately.** The user's category edit is already confirmed
 * by the server; making them watch a transactions refetch before the form
 * closes would make a category rename feel as slow as the slowest list read.
 * `loadTransactions` owns its own in-flight flag, its own error copy and its
 * own session-epoch guard, and it never rejects — so there is nothing here to
 * catch and nothing to report.
 *
 * **Skipped when no transactions have been read yet**: there is no stale cache
 * to correct, `hasLoaded` is false, and `useTransactions()` will read fresh
 * rows the first time a screen asks for them. Spending a request (and
 * rate-limit budget) on data nothing is displaying would be the wrong trade.
 *
 * One residual, recorded rather than papered over: if a page-0 read happens to
 * be in flight at this moment, `loadTransactions` returns early and that
 * in-flight read may answer with pre-propagation rows. There is no request
 * cancellation in this client (ADR 0016 §3.1), the window is one request wide,
 * and the next forced read or session corrects it.
 */
function invalidateTransactionsAfterCategoryWrite() {
  const transactions = useTransactionsStore.getState();
  if (!transactions.hasLoaded) {
    return;
  }
  transactions.loadTransactions({ force: true });
}

export const useCategoriesStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads `GET /categories`. Cache-first: a second call is a no-op once a read
   * has succeeded, so the picker, Budget Settings and Add Expense's recent
   * list share one request per session rather than spending rate-limit budget
   * each time one of them mounts. Pass `{ force: true }` for an explicit
   * retry.
   *
   * Triggered by `useCategories()` at the point of use — never eagerly at app
   * start, which would put a network call in front of the splash gate for data
   * no visible screen needs yet (the same arrangement as `useUserSettings`).
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadCategories: async ({ force = false } = {}) => {
    const state = get();
    if (state.isLoading) {
      return;
    }
    if (!shouldFetch(state, force)) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    const fetchStartedAt = nowIso();
    set({ isLoading: true, loadError: null });

    try {
      const response = await categoriesApi.listCategories();
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      const categories = toCategoryTree(response);
      if (!categories) {
        throw new Error('The categories response did not match the contract.');
      }
      set({
        categories,
        isLoading: false,
        hasLoaded: true,
        loadError: null,
        fetchStartedAt,
        isFromCache: false,
      });
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (keepsSnapshotOnFailure(get(), error)) {
        set({ isLoading: false });
        return;
      }
      // `hasLoaded` stays false, so the reading surfaces show the failure with
      // a Retry instead of an empty list that looks like "you have no
      // categories". A non-ApiError (the throw above) maps to the generic copy;
      // a stack trace never reaches the user (constitution §22). A terminal 401
      // shows nothing: the session is already gone and this store is about to
      // be reset.
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * `POST /categories` — creates a **top-level** category, or a subcategory
   * when `parentCategoryId` is given. One action for both levels, because it is
   * one endpoint and one request shape (api-overview.md §3.2); the two named
   * wrappers in `useCategories()` are what make a call site say which it meant.
   *
   * **Returns its outcome rather than storing an error**, unlike this store's
   * load error: a failed create belongs to the form the user is typing in, as
   * inline copy next to the field (the `useAuthStore.submitX` convention), and
   * a message left in global state would otherwise reappear the next time any
   * create form opened. `isCreating` is state, because two forms share it.
   *
   * The server re-validates everything regardless of what the caller checked
   * (security-architecture.md §3): a duplicate sibling name is a `409`, an
   * unknown or other-user parent a `404 PARENT_CATEGORY_NOT_FOUND`, and a
   * parent that is itself a subcategory a `400 SUBCATEGORY_DEPTH_EXCEEDED` —
   * all three mapped to copy in errorMessages.js.
   *
   * @param {{ name: string, parentCategoryId?: string | null }} params `name` must be trimmed and non-empty.
   * @returns {Promise<{ success: boolean, category: object | null, error: string | null }>}
   */
  createCategory: async ({ name, parentCategoryId = null }) => {
    const state = get();
    // Never a write before a successful read: without the current rows there
    // is no sibling list to have checked the name against, and no parent to
    // attach a child to.
    if (state.isCreating || !state.hasLoaded) {
      return { success: false, category: null, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      const op = buildCategoryCreateOp({ ...buildCategoryCreateFields(name), parentCategoryId });
      const result = await enqueueWrite(op);
      const category = result.success
        ? { ...op.preview.category, monthlyCap: null, subcategories: [] }
        : null;
      return { ...result, category, id: op.entityId, pending: true };
    }

    const epochAtStart = getSessionEpoch();
    set({ isCreating: true });

    try {
      const created = await categoriesApi.createCategory({
        ...buildCategoryCreateFields(name),
        parentCategoryId,
      });
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, category: null, error: null };
      }
      if (!isCategoryEntry(created)) {
        throw new Error('The create-category response did not match the contract.');
      }
      set((current) => ({
        categories: insertCategory(current.categories, created, parentCategoryId),
        isCreating: false,
      }));
      return { success: true, category: created, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, category: null, error: null };
      }
      set({ isCreating: false });
      return {
        success: false,
        category: null,
        // A terminal 401 shows nothing: the session is already gone and the
        // form is being torn down with the rest of the screen.
        error: isSessionTerminalError(error) ? null : getErrorMessage(error),
      };
    }
  },

  /**
   * `PATCH /categories/{id}` — Manage Categories' edit form (§3.3).
   *
   * **`changes` must name only the fields the user actually changed.** Absent
   * and explicit `null` mean different things on this endpoint: absent leaves
   * the column alone, `null` clears it. Sending `monthlyCap: null` for a row
   * whose name is all the user touched would silently delete their cap. The
   * caller builds the diff (`useCategories.updateCategory`); nothing is
   * inferred here, and an empty diff never reaches the network.
   *
   * **Returns its outcome rather than storing an error**, like
   * `createCategory` above: a failed save belongs to the form the user is
   * looking at. `notFound: true` says the row is gone — it is dropped from the
   * tree, so the screen can close a form that can no longer be saved.
   *
   * The server re-validates everything the form checked
   * (security-architecture.md §3): a duplicate sibling name is a
   * `409 CATEGORY_NAME_ALREADY_EXISTS`, a cap on a subcategory a
   * `400 VALIDATION_ERROR`, a `name` on the protected row a
   * `400 CATEGORY_PROTECTED` — all mapped to copy in errorMessages.js.
   *
   * **On success the transactions cache is invalidated** (see this file's
   * module note): the server has already rewritten the snapshot fields on this
   * category's transactions, so every held row for it is stale.
   *
   * @param {string} categoryId
   * @param {{ name?: string, iconName?: string, glyph?: string, monthlyCap?: number | null }} changes
   * @returns {Promise<{ success: boolean, category: object | null, error: string | null,
   *   notFound?: boolean }>}
   */
  updateCategory: async (categoryId, changes) => {
    const state = get();
    if (state.isUpdating || !state.hasLoaded) {
      return { success: false, category: null, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      const entry = findCategoryEntry(state.categories, categoryId);
      const op = buildCategoryUpdateOp({
        categoryId,
        changes,
        label: entry?.category.name ?? 'a category',
      });
      const result = await enqueueWrite(op);
      const category = result.success && entry ? { ...entry.category, ...changes } : null;
      return { ...result, category, id: categoryId, pending: true };
    }

    const epochAtStart = getSessionEpoch();
    set({ isUpdating: true });

    try {
      const updated = await categoriesApi.updateCategory(categoryId, changes);
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, category: null, error: null };
      }
      if (!isCategoryEntry(updated)) {
        throw new Error('The update-category response did not match the contract.');
      }
      set((current) => ({
        categories: applyCategoryUpdate(current.categories, updated),
        isUpdating: false,
      }));
      invalidateTransactionsAfterCategoryWrite();
      return { success: true, category: updated, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, category: null, error: null };
      }
      set({ isUpdating: false });
      if (isCategoryGone(error)) {
        set((current) => ({ categories: removeCategory(current.categories, categoryId) }));
        return {
          success: false,
          category: null,
          error: isSessionTerminalError(error) ? null : getErrorMessage(error),
          notFound: true,
        };
      }
      return {
        success: false,
        category: null,
        // A terminal 401 shows nothing: the session is already gone and the
        // form is being torn down with the rest of the screen.
        error: isSessionTerminalError(error) ? null : getErrorMessage(error),
      };
    }
  },

  /**
   * `DELETE /categories/{id}` — Manage Categories' confirmed delete (§3.4).
   *
   * **The caller must have confirmed first**, and must have called
   * `fetchCategoryUsage` to word that confirmation (§3.5). This action does no
   * confirming of its own and has no opinion about the dialog; it is the write.
   *
   * **A `404` is success, not a failure** (§3.4): the delete is idempotent in
   * effect and not in status code, so a second attempt at an id the user
   * already confirmed — a double tap, a retry after a dropped reply, another
   * device — means the row is gone, which is the outcome they asked for.
   * Reporting "delete failed" for a category that no longer exists would be a
   * worse lie than silence. Same rule, same reasoning as
   * `useTransactionsStore.deleteTransaction`'s `404`.
   *
   * The row is removed from the tree **with its subcategories**, mirroring the
   * server's cascade (`removeCategory`).
   *
   * **The response's counts are used, never the pre-flight's** (ADR 0021's
   * follow-up 3): `reassignedTransactionCount` is what actually happened, and
   * it decides whether the transactions cache needs re-reading at all. When
   * the delete resolved through a `404` there is no body and no count, so the
   * refetch happens unconditionally — the rows may have been reassigned by
   * whoever deleted the row first, and failing towards a refetch is the safe
   * direction.
   *
   * @param {string} categoryId
   * @returns {Promise<{ success: boolean, error: string | null,
   *   reassignedTransactionCount: number | null,
   *   deletedSubcategoryCount: number | null }>}
   */
  deleteCategory: async (categoryId) => {
    const state = get();
    if (state.isDeleting || !state.hasLoaded) {
      return {
        success: false,
        error: null,
        reassignedTransactionCount: null,
        deletedSubcategoryCount: null,
      };
    }

    if (OFFLINE_WRITES_ENABLED) {
      // ADR 0027 §8.8: cached transactions in this category render under the
      // cached protected category until the pull replaces them.
      const entry = findCategoryEntry(state.categories, categoryId);
      const miscCategory = state.categories.find((category) => category.isProtected) ?? null;
      const op = buildCategoryDeleteOp({
        categoryId,
        label: entry?.category.name ?? 'a category',
        miscCategory,
      });
      const result = await enqueueWrite(op);
      return {
        ...result,
        id: categoryId,
        pending: true,
        reassignedTransactionCount: null,
        deletedSubcategoryCount: null,
      };
    }

    const epochAtStart = getSessionEpoch();
    set({ isDeleting: true });

    try {
      const response = await categoriesApi.deleteCategory(categoryId);
      if (hasSessionChanged(epochAtStart)) {
        return {
          success: false,
          error: null,
          reassignedTransactionCount: null,
          deletedSubcategoryCount: null,
        };
      }
      set((current) => ({
        categories: removeCategory(current.categories, categoryId),
        isDeleting: false,
      }));
      // §3.4's body is additive and ignorable, so it is read defensively: a
      // missing or malformed count means "unknown", which refetches, rather
      // than `0`, which would skip a refetch the user needs.
      const reassignedTransactionCount = Number.isFinite(response?.reassignedTransactionCount)
        ? response.reassignedTransactionCount
        : null;
      const deletedSubcategoryCount = Number.isFinite(response?.deletedSubcategoryCount)
        ? response.deletedSubcategoryCount
        : null;
      if (reassignedTransactionCount === null || reassignedTransactionCount > 0) {
        invalidateTransactionsAfterCategoryWrite();
      }
      return {
        success: true,
        error: null,
        reassignedTransactionCount,
        deletedSubcategoryCount,
      };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return {
          success: false,
          error: null,
          reassignedTransactionCount: null,
          deletedSubcategoryCount: null,
        };
      }
      set({ isDeleting: false });
      if (isCategoryGone(error)) {
        set((current) => ({ categories: removeCategory(current.categories, categoryId) }));
        invalidateTransactionsAfterCategoryWrite();
        return {
          success: true,
          error: null,
          reassignedTransactionCount: null,
          deletedSubcategoryCount: null,
        };
      }
      return {
        success: false,
        error: isSessionTerminalError(error) ? null : getErrorMessage(error),
        reassignedTransactionCount: null,
        deletedSubcategoryCount: null,
      };
    }
  },

  /**
   * `GET /categories/{id}/usage` — the delete pre-flight (§3.5).
   *
   * **Stores nothing, deliberately.** The counts are advisory and may be stale
   * the moment they arrive (another device), so they are read fresh each time
   * the user taps delete and handed straight to the caller. A cached copy in
   * this store would be a number with no expiry governing a destructive act.
   * It is an action rather than a direct call from the hook only because
   * `src/api/*` belongs to the store layer (ADR 0016 §1).
   *
   * **It resolves rather than rejects, including on failure**, because the
   * caller's failure path is not "stop" — it is "warn anyway". §3.5 is explicit:
   * if this call fails, the client shows the unconditional wording and must NOT
   * suppress the warning. `success: false` is therefore an instruction to the
   * dialog, not an error to render, which is why no copy is returned with it.
   *
   * @param {string} categoryId
   * @returns {Promise<{ success: boolean,
   *   usage: { transactionCount: number, subcategoryCount: number } | null }>}
   */
  fetchCategoryUsage: async (categoryId) => {
    const epochAtStart = getSessionEpoch();

    try {
      const response = await categoriesApi.getCategoryUsage(categoryId);
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, usage: null };
      }
      const usage = toCategoryUsage(response);
      if (!usage) {
        return { success: false, usage: null };
      }
      return { success: true, usage };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, usage: null };
      }
      if (isCategoryGone(error)) {
        // The row is already gone, so there is nothing to warn about and
        // nothing to delete. It is dropped from the tree and reported as a
        // failed pre-flight: the caller's own delete attempt would answer the
        // same `404`, which it treats as success.
        set((current) => ({ categories: removeCategory(current.categories, categoryId) }));
      }
      return { success: false, usage: null };
    }
  },

  /**
   * Updates one category's standing `monthlyCap` — Budget Settings' Category
   * Caps list (docs/decisions/0010-budget-settings.md §2).
   *
   * **Still local, and still top-level only** (ADR 0019 §10.1/§4). Two things
   * follow, both deliberate:
   *
   * - It maps over the top-level array only, so a subcategory is
   *   *structurally* unreachable here rather than merely not offered — which
   *   matches the server, where a cap on a child is a `400`.
   * - It does not call `PATCH /categories/{id}`. A cap set here is read by
   *   Budget Settings' save snapshot, which is itself still local
   *   (`useBudgetStore`); persisting it needs a commit point nobody has
   *   specified and belongs with Domain 5's budget wiring. Flagged rather than
   *   guessed at.
   *
   * **Two routes now write this one field, and that is the open end of this
   * round.** `updateCategory` above persists `monthlyCap` through §3.3, which
   * Manage Categories' edit form uses; this action still only writes memory.
   * So a cap typed in Budget Settings and left unsaved is overwritten by a cap
   * saved from Manage Categories (the `PATCH` response is authoritative and is
   * merged into the tree), and a cap saved from Manage Categories survives a
   * reload while one typed in Budget Settings does not. Reconciling the two is
   * Domain 5's budget wiring, where the period itself becomes server-backed —
   * recorded here and in this round's report rather than half-fixed now.
   *
   * @param {string} categoryId A top-level category's id.
   * @param {number | null} monthlyCap `null` clears it.
   */
  setCategoryCap: (categoryId, monthlyCap) =>
    set((state) => ({
      categories: state.categories.map((category) =>
        category.id === categoryId ? { ...category, monthlyCap } : category,
      ),
    })),

  /**
   * Drops this account's categories — see signOutReset.js. There is
   * deliberately no separate "clear errors" action: each operation clears its
   * own message when it starts, and sign-out clears everything.
   */
  resetCategories: () => set({ ...INITIAL_STATE }),

  /**
   * ADR 0027 §8.8 — shows the cached tree at once; the next load re-reads.
   * The cached value goes through the same validation as a network response.
   *
   * @param {{ categories: object[] }} data
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    const categories = toCategoryTree(data?.categories);
    if (!categories) {
      return;
    }
    set({ categories, hasLoaded: true, isFromCache: true, fetchStartedAt, loadError: null });
  },
}));

registerSignOutReset(() => {
  useCategoriesStore.getState().resetCategories();
});

bindStorePersistence(useCategoriesStore, {
  storeKey: 'categories',
  watch: (state) => [state.categories],
  select: (state) => ({ categories: state.categories }),
  pull: () => useCategoriesStore.getState().loadCategories({ force: true }),
  pullOrder: 3,
});
