import { useCallback, useEffect, useMemo } from 'react';
import { useCategoriesStore } from '../store/useCategoriesStore';
import { useCategoriesView } from './useCategoriesView';
import { useUserSettings } from './useUserSettings';
import {
  buildCategoryUpdateChanges,
  findCategoryEntry,
  flattenCategoryTree,
  isDuplicateCategoryName,
  requiresSubcategorySelection,
} from '../utils/categories';

/**
 * The single entry point to the account's categories — `GET`/`POST
 * /api/v1/categories` (docs/api/api-overview.md §3) — for the three surfaces
 * that read them: Category Picker, Budget Settings, and Add Expense's recent
 * list (through `useRecentCategories`).
 *
 * **This hook is the load trigger**, the same arrangement as
 * `useUserSettings`/`useCurrentUserProfile`. The loader is cache-first and
 * single-flight, so all three surfaces share one request per session unless
 * `reload()` asks for another.
 *
 * It also owns the client-side category rules, so no screen re-implements them
 * (constitution §8).
 *
 * **Two create rules:** a name must be non-blank, and it must not duplicate
 * one of its **prospective siblings** case-insensitively. That second rule is
 * now parent-scoped (docs/decisions/0019-subcategories-one-optional-level.md
 * §3/§10.2) — `Food › Snacks` and `Transport › Snacks` may coexist, so the
 * check compares against one level, never the whole tree. Both are UX only;
 * the server's `409` is the guarantee
 * (docs/architecture/security-architecture.md §3).
 *
 * **And one selection rule**, added 2026-10-24 for the Project Owner's
 * subcategory addendum: `needsSubcategorySelection(selection)` — when the
 * preference is on, a top-level category that *has* children is an unfinished
 * choice. This one is **client-side only and that is deliberate, not an
 * oversight**: ADR 0019 §6.1 made `subcategoriesEnabled` a UI affordance that
 * gates no endpoint, and the server has no idea whether a given user has the
 * toggle on, so "must pick a leaf" cannot be a server rule without
 * contradicting that decision. See the handoff note.
 *
 * **Why it reads settings too.** `subcategoriesEnabled` decides what the
 * picker *offers* (§6.1), and `useUserSettings` is lazily loaded — until
 * something reads it, the store holds the documented default (`false`). A user
 * who turned subcategories on would otherwise see none of them until they
 * happened to open Profile in that session, which is not the preference
 * behaving, it is the preference not having been read yet. So the surfaces
 * that depend on it trigger it, which is exactly the one-line remedy
 * `useUserSettings`'s own note describes.
 *
 * **And two edit rules, added with the rename/delete pass** (api-overview.md
 * §3.3/§3.4): a rename obeys the same two create rules, compared against the
 * row's siblings **excluding itself** so re-saving an unchanged name is not a
 * duplicate of itself; and a `monthlyCap` is refused for a subcategory, which
 * is top-level-only and a `400` server-side. Protected rows are handled by
 * *omission* rather than by a rule here — the form offers no name field for one
 * — see `useCategoryEditForm`.
 *
 * @returns {{
 *   categories: object[],
 *   subcategoriesEnabled: boolean,
 *   selectableCategories: object[],
 *   hasLoaded: boolean,
 *   isLoading: boolean,
 *   loadError: string | null,
 *   isCreating: boolean,
 *   isUpdating: boolean,
 *   isDeleting: boolean,
 *   needsSubcategorySelection: (selection: object | null) => boolean,
 *   createCategory: (name: string) => Promise<{ success: boolean, error: string | null }>,
 *   createSubcategory: (
 *     parentCategoryId: string,
 *     name: string,
 *   ) => Promise<{ success: boolean, error: string | null }>,
 *   updateCategory: (
 *     categoryId: string,
 *     draft: { name?: string, glyph?: string, monthlyCap?: number | null },
 *   ) => Promise<{ success: boolean, error: string | null, notFound?: boolean }>,
 *   deleteCategory: (categoryId: string) => Promise<{ success: boolean, error: string | null,
 *     reassignedTransactionCount: number | null, deletedSubcategoryCount: number | null }>,
 *   fetchCategoryUsage: (categoryId: string) => Promise<{ success: boolean,
 *     usage: { transactionCount: number, subcategoryCount: number } | null }>,
 *   reload: () => void,
 * }}
 */
export function useCategories() {
  // Snapshot + queued category writes (ADR 0027 §8.8).
  const categories = useCategoriesView();
  const isLoading = useCategoriesStore((state) => state.isLoading);
  const hasLoaded = useCategoriesStore((state) => state.hasLoaded);
  const loadError = useCategoriesStore((state) => state.loadError);
  const isCreating = useCategoriesStore((state) => state.isCreating);
  const isUpdating = useCategoriesStore((state) => state.isUpdating);
  const isDeleting = useCategoriesStore((state) => state.isDeleting);
  const loadCategories = useCategoriesStore((state) => state.loadCategories);
  const createCategoryInStore = useCategoriesStore((state) => state.createCategory);
  const updateCategoryInStore = useCategoriesStore((state) => state.updateCategory);
  const deleteCategory = useCategoriesStore((state) => state.deleteCategory);
  const fetchCategoryUsage = useCategoriesStore((state) => state.fetchCategoryUsage);

  const { subcategoriesEnabled } = useUserSettings();

  useEffect(() => {
    // A no-op once a read has succeeded; after a failure `hasLoaded` is still
    // false, so re-entering the screen retries. Same effect, same reasoning as
    // useUserSettings'.
    loadCategories();
  }, [loadCategories]);

  /**
   * Every row a user may pick right now, flattened, each carrying its
   * `parentCategoryName`. With the toggle off this is the top level only —
   * nothing unselectable is offered anywhere (§6.1), and no call site writes
   * that filter itself.
   */
  const selectableCategories = useMemo(
    () => flattenCategoryTree(categories, { includeSubcategories: subcategoriesEnabled }),
    [categories, subcategoriesEnabled],
  );

  /**
   * Whether `selection` is still too broad to save against — the Project
   * Owner's 2026-10-24 rule, with the preference folded in here so no screen
   * reads `subcategoriesEnabled` to decide validation.
   *
   * Always `false` while the preference is off, which is what keeps the
   * toggle-off flow byte-for-byte what it was. Also `false` for a selection
   * that is already a subcategory, for a childless top-level category (the
   * addendum's explicit escape so a user cannot be blocked), and for a
   * selection that no longer resolves to a live row — see
   * `requiresSubcategorySelection` for why that last one matters.
   */
  const needsSubcategorySelection = useCallback(
    (selection) => subcategoriesEnabled && requiresSubcategorySelection(categories, selection),
    [categories, subcategoriesEnabled],
  );

  const createCategory = useCallback(
    async (name) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return { success: false, error: 'Enter a category name.' };
      }
      if (isDuplicateCategoryName(categories, trimmed)) {
        return { success: false, error: 'That category already exists.' };
      }
      const result = await createCategoryInStore({ name: trimmed, parentCategoryId: null });
      return { success: result.success, error: result.error };
    },
    [categories, createCategoryInStore],
  );

  const createSubcategory = useCallback(
    async (parentCategoryId, name) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return { success: false, error: 'Enter a subcategory name.' };
      }
      const parent = categories.find((category) => category.id === parentCategoryId);
      if (!parent) {
        // Only reachable if the tree was reloaded out from under the open
        // form. The server would answer `404 PARENT_CATEGORY_NOT_FOUND`
        // anyway; saying so here saves a round trip and reads the same.
        return {
          success: false,
          error:
            'That parent category is no longer available. Reload your categories and try again.',
        };
      }
      // Scoped to this parent's own children — the whole point of §3's
      // per-parent uniqueness. Comparing against the top level instead would
      // block a subcategory that shares its name with a category.
      if (isDuplicateCategoryName(parent.subcategories ?? [], trimmed)) {
        return {
          success: false,
          error: `${parent.name} already has a subcategory with that name.`,
        };
      }
      const result = await createCategoryInStore({ name: trimmed, parentCategoryId });
      return { success: result.success, error: result.error };
    },
    [categories, createCategoryInStore],
  );

  /**
   * `PATCH /categories/{id}` (§3.3), given the row's id and the form's draft.
   *
   * **The draft's KEYS decide what may change.** A key the form does not render
   * must not be present, because this hook turns the draft into a diff and an
   * absent field is what tells the server to leave a column alone
   * (`buildCategoryUpdateChanges` owns that discipline). So a protected row
   * arrives with no `name` key and a subcategory with no `monthlyCap` key —
   * omission, not a flag.
   *
   * An unchanged draft resolves `{ success: true }` **without a request**:
   * opening an edit form and saving it untouched is not a write, and the
   * propagating UPDATE behind this endpoint is not something to trigger for
   * nothing.
   */
  const updateCategory = useCallback(
    async (categoryId, draft) => {
      const entry = findCategoryEntry(categories, categoryId);
      if (!entry) {
        // Only reachable if the tree was reloaded out from under the open form.
        // The server would answer `404 CATEGORY_NOT_FOUND`; saying so here
        // saves a round trip and reads the same (the same pre-check
        // `createSubcategory` makes for a vanished parent).
        return {
          success: false,
          error: 'That category is no longer available. Reload your categories and try again.',
        };
      }

      const { category, parent } = entry;

      if (draft.name !== undefined) {
        const trimmed = draft.name.trim();
        if (!trimmed) {
          return { success: false, error: 'Enter a category name.' };
        }
        // Siblings only, and never the row being edited — comparing against
        // itself would reject every save that left the name alone, and
        // comparing against the whole tree would reject a rename that is
        // legitimate under a different parent (§3's per-parent uniqueness).
        const siblings = (parent ? (parent.subcategories ?? []) : categories).filter(
          (sibling) => sibling.id !== categoryId,
        );
        if (isDuplicateCategoryName(siblings, trimmed)) {
          return {
            success: false,
            error: parent
              ? `${parent.name} already has a subcategory with that name.`
              : 'That category already exists.',
          };
        }
      }

      if (draft.monthlyCap !== undefined && parent) {
        // Defence in depth: the form renders no cap field for a child. The
        // server answers `400 VALIDATION_ERROR` for the same reason, and this
        // pre-check reaches the identical conclusion a round trip earlier.
        return { success: false, error: 'Only main categories can have a monthly cap.' };
      }

      const changes = buildCategoryUpdateChanges(category, draft);
      if (Object.keys(changes).length === 0) {
        return { success: true, error: null };
      }

      const result = await updateCategoryInStore(categoryId, changes);
      return { success: result.success, error: result.error, notFound: result.notFound };
    },
    [categories, updateCategoryInStore],
  );

  const reload = useCallback(() => {
    loadCategories({ force: true });
  }, [loadCategories]);

  return {
    categories,
    subcategoriesEnabled,
    selectableCategories,
    hasLoaded,
    isLoading,
    loadError,
    isCreating,
    isUpdating,
    isDeleting,
    needsSubcategorySelection,
    createCategory,
    createSubcategory,
    updateCategory,
    // Exposed as the store's own actions, unwrapped: a delete has nothing to
    // validate client-side (the one ineligible row is `isProtected`, and the UI
    // renders no affordance for it at all), and the usage pre-flight is a read.
    // A pass-through wrapper would only add a name to read past.
    deleteCategory,
    fetchCategoryUsage,
    reload,
  };
}
