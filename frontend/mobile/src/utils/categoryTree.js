/**
 * Pure edits of the two-level category tree (`CategoryResponse[]`, each with
 * its own `subcategories`). Moved out of `useCategoriesStore` so the
 * offline overlay (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md
 * §8.8) applies a queued category write with exactly the rules the store
 * applies to a confirmed one — one implementation, not two (constitution §25).
 *
 * One change on the move: in `applyCategoryUpdate`, an *absent* `monthlyCap`
 * keeps the held value (a queued PATCH names only the changed fields). A
 * server response always carries the key, so confirmed writes behave as before.
 */

/**
 * Inserts a created row into the tree — at the top level, or into its parent's
 * `subcategories`.
 *
 * Newest first, matching every other store's create convention
 * (`addGroup`/`addContact`/the old `addCategory`). A subsequent reload will
 * re-order it to whatever the server returns, which is fine: this keeps the
 * row the user just typed where they can see it.
 *
 * @param {object[]} categories
 * @param {object} created A CategoryResponse.
 * @param {string | null} parentCategoryId
 * @returns {object[]}
 */
export function insertCategory(categories, created, parentCategoryId) {
  const normalized = {
    ...created,
    parentCategoryId: parentCategoryId ?? null,
    monthlyCap: created.monthlyCap ?? null,
    subcategories: [],
  };

  if (!parentCategoryId) {
    return [normalized, ...categories];
  }
  return categories.map((category) =>
    category.id === parentCategoryId
      ? { ...category, subcategories: [normalized, ...(category.subcategories ?? [])] }
      : category,
  );
}

/**
 * Writes a `PATCH /categories/{id}` response back into the tree, at either
 * level.
 *
 * **The patched row's own fields come from the response; its `subcategories`
 * come from the held copy.** A `PATCH` changes one row's name, icon, glyph or
 * cap and nothing about its children (api-overview.md §3.3 — it does not even
 * accept `parentCategoryId`), so the children already in hand are still
 * correct. Taking the response's array instead would mean trusting one write's
 * echo to re-state a structure it was never asked about, and an omitted or
 * empty `subcategories` on it would silently empty an expanded parent on
 * screen.
 *
 * A child's `monthlyCap` is pinned to `null` on the way in, exactly as
 * `toCategoryTree` pins it: caps are top-level-only, enforced by a CHECK
 * constraint, and one bad row must not make a cap field appear on a
 * subcategory.
 *
 * @param {object[]} categories
 * @param {object} updated A CategoryResponse (or, from the overlay, `{ id, ...changes }`).
 * @returns {object[]}
 */
export function applyCategoryUpdate(categories, updated) {
  return categories.map((category) => {
    if (category.id === updated.id) {
      return {
        ...category,
        ...updated,
        parentCategoryId: null,
        monthlyCap: updated.monthlyCap === undefined ? category.monthlyCap ?? null : updated.monthlyCap,
        subcategories: category.subcategories ?? [],
      };
    }
    return {
      ...category,
      subcategories: (category.subcategories ?? []).map((subcategory) =>
        subcategory.id === updated.id
          ? {
              ...subcategory,
              ...updated,
              parentCategoryId: category.id,
              monthlyCap: null,
              subcategories: [],
            }
          : subcategory,
      ),
    };
  });
}

/**
 * Removes a deleted category from the tree, at either level.
 *
 * **A top-level row takes its children with it**, which mirrors the server:
 * `DELETE /categories/{id}` cascades to the subcategories in the same
 * transaction (api-overview.md §3.4). Leaving them behind locally would render
 * rows that no longer exist and whose ids now `404`.
 *
 * Budget Settings' live Category Caps list is built by mapping this array, so
 * a deleted category's cap row disappears from it with the row — which is what
 * ADR 0021's frontend follow-up 6 requires, and it needs no code there. A
 * **saved** budget period keeps its own frozen cap name untouched (§2.5), and
 * nothing here goes near it.
 *
 * @param {object[]} categories
 * @param {string} categoryId
 * @returns {object[]}
 */
export function removeCategory(categories, categoryId) {
  return categories
    .filter((category) => category.id !== categoryId)
    .map((category) => ({
      ...category,
      subcategories: (category.subcategories ?? []).filter(
        (subcategory) => subcategory.id !== categoryId,
      ),
    }));
}
