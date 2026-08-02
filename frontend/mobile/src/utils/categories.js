/**
 * Shared category-creation helpers — used by both Category Picker's "Add
 * Custom" flow and Budget Settings' "Add Category" flow (ADR 0010 §1), the
 * two independent creation paths that now write into the same
 * useCategoriesStore. Extracted here once both call sites needed the exact
 * same duplicate-name check and fallback icon convention, per constitution
 * Section 25 ("duplicate twice -> evaluate") and ADR 0010 §1's own explicit
 * recommendation.
 */

/**
 * Case-insensitive duplicate-name check against an existing category list.
 * @param {Array<{ name: string }>} categories
 * @param {string} name
 * @returns {boolean}
 */
export function isDuplicateCategoryName(categories, name) {
  return categories.some((category) => category.name.toLowerCase() === name.toLowerCase());
}

/**
 * Builds a new category record from a user-entered name, using the exact
 * fallback icon convention CategoryPickerScreen.jsx's "Add Custom" flow
 * already established: no approved Ionicons concept in design-system.md
 * Section 6 maps cleanly to a generic/user-defined category, so
 * `settings-outline` (already approved for the Settings concept) is reused
 * as the closest neutral, generic icon rather than inventing an unapproved
 * icon name.
 * @param {string} name - already trimmed, non-empty
 * @returns {{ id: string, name: string, iconName: string, glyph: string, monthlyCap: null }}
 */
export function buildCategoryFromName(name) {
  return {
    id: `custom-${Date.now()}`,
    name,
    iconName: 'settings-outline',
    glyph: name.charAt(0).toUpperCase(),
    monthlyCap: null,
  };
}
