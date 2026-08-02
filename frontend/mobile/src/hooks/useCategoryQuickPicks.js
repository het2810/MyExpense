import { useMemo } from 'react';
import { useCategories } from './useCategories';
import { useRecentCategories } from './useRecentCategories';
import { findCategoryByNamePath, toCategorySelection } from '../utils/categories';

// How many rows the inline CATEGORY dropdown may list before "Search more".
//
// Four, per the Project Owner's 2026-11-01 correction: "only last 4 used should
// be shown and below that search more option should be there". This replaces
// the 2026-10-29 value of eight, which was set to the number of seeded
// categories and therefore listed effectively every category an account had —
// a shortlist that is not short is not a shortlist. The full tree, search and
// subcategories stay one tap away in CategoryPicker.
const MAX_QUICK_PICK_CATEGORIES = 4;

/**
 * How many recents to *ask* `useRecentCategories` for — twice what the dropdown
 * can show, because a recent subcategory is listed as its top-level ancestor and
 * several recents can collapse onto the same one. Three recent meals under
 * `Food` are one row, and without a wider window the three slots they did not
 * fill would go to the alphabetical fill rather than to the categories the user
 * actually used next. Eight is not shown to anyone: it is the length of the walk
 * behind four rows.
 */
const RECENT_CATEGORY_LOOKBACK = MAX_QUICK_PICK_CATEGORIES * 2;

/**
 * The rows the inline CATEGORY dropdown offers on Add Expense and Split Add
 * Expense: **top-level categories only**, at most `MAX_QUICK_PICK_CATEGORIES`,
 * most-recently-used first, with any remaining slots filled from the account's
 * own top-level categories **in alphabetical order by name**.
 *
 * ## Why this exists (bug fix, 2026-10-29)
 *
 * The dropdown previously rendered `useRecentCategories()` and nothing else.
 * That list is derived from the user's loaded expense transactions, so on a new
 * account — or any account whose loaded page holds no expense yet — it is
 * empty, and the dropdown collapsed to its single "Search more" row: the
 * Project Owner's "category drop down directly shows search more, it doesn't
 * display the existing categories". `useRecentCategories` itself is correct (it
 * reads the API's `categoryName`/`parentCategoryName` snapshot fields); it
 * simply has nothing to report before the first expense exists, and "recent" is
 * not the same question as "what are my categories". The fill is what keeps the
 * dropdown from ever being empty for a signed-in user, and that guarantee must
 * not regress.
 *
 * Recents keep their position and their meaning — the fill only appends, never
 * reorders the recent list itself (`useRecentCategories`' contract: "fewer than
 * 3 is a valid result — callers must not pad with placeholders").
 *
 * **The fill is alphabetical by displayed name** (Project Owner, 2026-11-01:
 * "for new user if there are no last 4 used category then you should display
 * the 4 category alphabetically then once user start using it we'll have the 4
 * categories"). Alphabetical rather than the API's own `GET /categories` order,
 * because that order is the server's seed order for a fresh account and seed
 * order is arbitrary to the person reading the list — four names in no order
 * they can predict. The comparison is `localeCompare`, so case and accents sort
 * sensibly instead of by code point. **The sort is on a copy**: `categories` is
 * `useCategoriesStore`'s live array, and sorting it in place would silently
 * reorder every other category surface (the picker, Budget Settings), which
 * read the server's order on purpose.
 *
 * ## One level, deliberately (2026-11-01)
 *
 * **A parent and its own subcategory must never both be listed.** The Project
 * Owner saw exactly that: "currently Food and Food > Breakfast both are visible
 * in the list which should not happen". It happened because recents are leaves
 * (`Food > Breakfast` is what the transaction was tagged to) while the fill
 * walked the top level (`Food`), so the two lists could describe the same
 * subtree twice and the dropdown read as though they were alternatives.
 *
 * The rule is therefore: **every row is a top-level category, and a recent
 * subcategory is represented by — and lends its recency to — its top-level
 * ancestor.** So a recent `Food > Breakfast` surfaces as `Food`, in the
 * position `Food > Breakfast` earned, and `Food` is listed once however many of
 * its children are recent. The leaf is not lost: tapping a row that still has
 * subcategories under it continues straight into CategoryPicker **expanded on
 * that row**, which is the Project Owner's "it should display the main category
 * as a drop down and user can select subcategory from it". That handoff already
 * exists in both screens (`handleSelectQuickPickCategory` →
 * `useCategories().needsSubcategorySelection` → `openCategoryPicker(category)`,
 * which passes `currentSelection`); this hook adds no second expansion
 * mechanism of its own.
 *
 * Rows are consequently always `parentCategoryName: null`, so callers'
 * `formatCategoryPath` renders a bare name here and the dropdown has no mixed
 * depths. Callers need no change for that — the path helper tolerates a null
 * parent by design.
 *
 * Business logic lives here rather than in the two screens (constitution §8,
 * and §25 now that there are two surfaces: the first already duplicated the
 * recents-plus-"Search more" list). Both screens must stay consistent, which is
 * the other reason the composition has exactly one home.
 *
 * No new request: both hooks read stores that the calling screens already
 * trigger (`useTransactions`/`useSplitExpenseSave` for transactions,
 * `useCategories` for the tree), and both are cache-first.
 *
 * @returns {Array<{id: string, name: string, iconName: string, glyph: string,
 *   parentCategoryName: null}>} 0 to `MAX_QUICK_PICK_CATEGORIES` top-level
 *   categories, most-recently-used first then alphabetically.
 *   `parentCategoryName` is always null because every row is top-level.
 */
export function useCategoryQuickPicks() {
  const { categories } = useCategories();
  const recentCategories = useRecentCategories(RECENT_CATEGORY_LOOKBACK);

  return useMemo(() => {
    const quickPicks = [];
    const seenIds = new Set();

    function addTopLevelCategory(category) {
      if (quickPicks.length >= MAX_QUICK_PICK_CATEGORIES || seenIds.has(category.id)) {
        return;
      }
      seenIds.add(category.id);
      // Attached through the same shared helper the picker and the recents list
      // use, so every consumer sees one selection shape.
      quickPicks.push(toCategorySelection(category, null));
    }

    recentCategories.forEach((recentCategory) => {
      if (!recentCategory.parentCategoryName) {
        addTopLevelCategory(recentCategory);
        return;
      }
      // A recent leaf: list its ancestor instead. Resolved against the live
      // tree rather than reconstructed, because the dropdown row has to be a
      // real tree row for `needsSubcategorySelection` to be able to answer
      // "can this still be narrowed?" about it.
      const parentCategory = findCategoryByNamePath(
        categories,
        null,
        recentCategory.parentCategoryName,
      );
      if (!parentCategory) {
        // Nothing to show for this recent. Skipped rather than rendered broken,
        // reusing `useRecentCategories`' own skip semantics (constitution §22).
        return;
      }
      addTopLevelCategory(parentCategory);
    });

    const alphabeticalCategories = [...categories].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    alphabeticalCategories.forEach((category) => {
      addTopLevelCategory(category);
    });

    return quickPicks;
  }, [recentCategories, categories]);
}
