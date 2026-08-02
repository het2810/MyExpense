import { create } from 'zustand';

/**
 * Zustand store holding the app's expense category list — promoted from
 * what was previously a plain exported array (`categories` in
 * src/mocks/categoryMocks.js), per docs/decisions/0010-budget-settings.md
 * §1. Mirrors useContactsStore's exact promotion precedent (docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §2): a plain module-level array
 * can't support creating a new category reactively, and two independent
 * creation paths now exist — Category Picker's "Add Custom" and Budget
 * Settings' "Add Category" — both of which need the result to be visible
 * everywhere categories are read (the ADR's explicit requirement that a
 * category created in either place appears in both). In-memory only, no
 * persistence, same pattern as every other store in this phase.
 *
 * `categoryMocks.js`'s `recentCategoryIds` is untouched by this migration —
 * it is never mutated, so it has no reason to move (ADR 0010 §1).
 *
 * Item shape:
 * {
 *   id: string,
 *   name: string,
 *   iconName: string,          // approved Ionicons name, design-system.md §6
 *   glyph: string,              // single-character glyph rendered by the
 *                                // current IconBadge fallback
 *   monthlyCap: number | null,  // NEW (ADR 0010 §1) — this category's own
 *                                // standing default cap. Present-but-null
 *                                // when no cap is set, mirroring the
 *                                // groupId/cashAmount/onlineAmount
 *                                // "present-but-null" convention ADR 0003 §2
 *                                // established. Distinct from a saved budget
 *                                // period's own `categoryCaps` snapshot
 *                                // (useBudgetStore.js), which copies this
 *                                // value at save time rather than reading it
 *                                // live.
 * }
 */
const initialCategories = [
  { id: 'cat-food', name: 'Food', iconName: 'cafe-outline', glyph: 'F', monthlyCap: null },
  { id: 'cat-transport', name: 'Transport', iconName: 'car-outline', glyph: 'T', monthlyCap: null },
  { id: 'cat-groceries', name: 'Groceries', iconName: 'cart-outline', glyph: 'G', monthlyCap: null },
  {
    id: 'cat-entertainment',
    name: 'Entertainment',
    iconName: 'film-outline',
    glyph: 'E',
    monthlyCap: null,
  },
  { id: 'cat-income', name: 'Income', iconName: 'cash-outline', glyph: 'I', monthlyCap: null },
  { id: 'cat-home', name: 'Home / Rent', iconName: 'home-outline', glyph: 'H', monthlyCap: null },
  { id: 'cat-shopping', name: 'Shopping', iconName: 'bag-outline', glyph: 'S', monthlyCap: null },
  {
    id: 'cat-fitness',
    name: 'Fitness / Leisure',
    iconName: 'barbell-outline',
    glyph: 'W',
    monthlyCap: null,
  },
];

export const useCategoriesStore = create((set) => ({
  categories: initialCategories,

  /**
   * Prepends a newly created category — used by both Category Picker's "Add
   * Custom" flow and Budget Settings' "Add Category" flow (ADR 0010 §1),
   * mirroring every other store's "newest first" convention
   * (useGroupsStore.addGroup, useContactsStore.addContact, etc.).
   * @param {object} category
   */
  addCategory: (category) => set((state) => ({ categories: [category, ...state.categories] })),

  /**
   * Updates one category's standing `monthlyCap` — Budget Settings' Category
   * Caps list (ADR 0010 §2). `monthlyCap` is a number, or `null` to clear it.
   * @param {string} categoryId
   * @param {number | null} monthlyCap
   */
  setCategoryCap: (categoryId, monthlyCap) =>
    set((state) => ({
      categories: state.categories.map((category) =>
        category.id === categoryId ? { ...category, monthlyCap } : category,
      ),
    })),
}));
