/**
 * Shared category helpers — the pure, store-free half of the two-level
 * category model (docs/decisions/0019-subcategories-one-optional-level.md
 * §10). Imported by the categories store, the hooks that read it, and the
 * screens that render it; imports nothing itself, so it stays usable from any
 * layer.
 *
 * The shape these functions work on is the API's, verbatim
 * (docs/api/api-overview.md §3.1): a **top-level array**, each entry carrying
 * `parentCategoryId` (always present, `null` at the top level) and
 * `subcategories` (always present, `[]` for a child — guaranteed by the
 * server's one-level depth rule, not by convention here). Nothing in this file
 * reshapes or renames an API field (constitution §15/§30); the one value it
 * *derives* is `parentCategoryName`, which the API deliberately does not put
 * on a child because the nesting already says it (§7).
 */

/**
 * The separator between a parent's name and its subcategory's —
 * `Food > Lunch`. U+003E GREATER-THAN SIGN.
 *
 * **This is the only definition in the app, deliberately** (ADR 0019 §10.3):
 * the separator is a presentation choice, so it has to be one line to change —
 * different punctuation, a two-line treatment, or a de-emphasized parent all
 * start here. It is also the reason the separator is never frozen into a stored
 * `category` snapshot (ADR 0019 §5): a composed string would make every past
 * record wrong the moment this value changes.
 *
 * **Changed from `›` (U+203A) to `>` on 2026-10-24**, and this edit is the
 * whole argument for the single home: it was one line. ADR 0019 §10.3
 * recommended `›` while explicitly recording that the Project Owner had not
 * confirmed it; their subcategory addendum then wrote `Food > Lunch` and
 * `Parent > Child` verbatim, which settles it. Nothing else in the app needed
 * to change, and no stored record is affected.
 */
export const CATEGORY_PATH_SEPARATOR = '>';

/**
 * The display label for a category, including its parent when it has one.
 *
 * Every surface that can show a subcategory must use this — the picker's
 * search results, Add Expense's trigger and recent list, Split Add Expense's
 * trigger, Dashboard's transaction rows and Transaction Detail. That is a
 * correctness requirement rather than polish (ADR 0019 §3/§10.2): a leaf name
 * is only unique within its parent, so two bare `Snacks` rows would be
 * indistinguishable.
 *
 * Tolerates a missing parent (`null`, `undefined` or blank) and returns the
 * name alone — which is what a top-level category, an income row, and any
 * record written before this field existed all look like.
 *
 * **Rendering never consults `subcategoriesEnabled`, anywhere** (ADR 0019
 * §6.2): a transaction tagged to a subcategory shows its full path even with
 * the preference off. History that reads differently depending on a mutable
 * setting is unstable history.
 *
 * @param {string | null | undefined} parentCategoryName
 * @param {string} name
 * @returns {string}
 */
export function formatCategoryPath(parentCategoryName, name) {
  if (!parentCategoryName) {
    return name;
  }
  return `${parentCategoryName} ${CATEGORY_PATH_SEPARATOR} ${name}`;
}

/**
 * Case-insensitive duplicate-name check against the list a new name would
 * join.
 *
 * **The signature is unchanged; the caller's responsibility is what changed**
 * (ADR 0019 §10.2/§3). Uniqueness is now per-parent, so the list passed in
 * must be the prospective **siblings**: the top-level array when creating a
 * top-level category, or that parent's `subcategories` when creating a child.
 * Passing the whole tree would wrongly block `Transport > Snacks` because
 * `Food > Snacks` exists.
 *
 * Still UX only — the server's `409 CATEGORY_NAME_ALREADY_EXISTS` is the
 * guarantee (docs/architecture/security-architecture.md §3), and the two can
 * in principle disagree on exotic Unicode case folding (ADR 0018 §6's recorded
 * limitation), where the server wins.
 *
 * @param {Array<{ name: string }>} siblings
 * @param {string} name
 * @returns {boolean}
 */
export function isDuplicateCategoryName(siblings, name) {
  const comparable = name.trim().toLowerCase();
  return siblings.some((sibling) => sibling.name.toLowerCase() === comparable);
}

/**
 * The server-side fields a create request needs, derived from a user-entered
 * name — the icon/glyph convention CategoryPickerScreen's "Add Custom" flow
 * established and ADR 0019 §10.2 keeps for "Add Subcategory": no approved
 * Ionicons concept in docs/ui/design-system.md §6 maps to a generic
 * user-defined category, so `settings-outline` (already approved, for
 * Settings) is reused as the closest neutral icon rather than inventing an
 * unapproved name. **Subcategories introduce no new icon.**
 *
 * This no longer builds a whole category record: `id`, `isDefault`,
 * `createdAt`/`updatedAt` and the echoed `parentCategoryId` all come back from
 * `POST /categories`, and a client-minted `custom-<timestamp>` id would be a
 * second, wrong identity for a row the server owns. `monthlyCap` is likewise
 * absent — neither creation form has a cap field, and a cap on a subcategory
 * is rejected (api-overview.md §3.2).
 *
 * @param {string} name already trimmed, non-empty
 * @returns {{ name: string, iconName: string, glyph: string }}
 */
export function buildCategoryCreateFields(name) {
  return {
    name,
    iconName: 'settings-outline',
    glyph: name.charAt(0).toUpperCase(),
  };
}

/**
 * Finds one row anywhere in the tree, with the parent it hangs off.
 *
 * Returns `{ category, parent }` — `parent: null` for a top-level row — or
 * `null` when the id resolves to nothing. **Both halves are needed by every
 * caller**, which is why the parent is returned rather than looked up again:
 * editing a row needs its *siblings* (per-parent name uniqueness, §3) and
 * needs to know whether it is top-level at all (caps are top-level-only).
 *
 * @param {object[]} categories The top-level array.
 * @param {string} categoryId
 * @returns {{ category: object, parent: object | null } | null}
 */
export function findCategoryEntry(categories, categoryId) {
  for (const category of categories) {
    if (category.id === categoryId) {
      return { category, parent: null };
    }
    const subcategory = (category.subcategories ?? []).find(
      (candidate) => candidate.id === categoryId,
    );
    if (subcategory) {
      return { category: subcategory, parent: category };
    }
  }
  return null;
}

/**
 * Builds the `PATCH /categories/{id}` body from a row and the edit form's
 * draft — i.e. the **diff**, and nothing else (api-overview.md §3.3).
 *
 * **Absent and `null` are different values on that endpoint, and this function
 * is where that discipline lives.** An absent field leaves the column alone; an
 * explicit `null` clears it. So a field the user did not change must not appear
 * in the result at all: sending `monthlyCap: null` alongside a renamed `name`
 * would delete a cap the user never touched. `monthlyCap` is therefore the one
 * field where `null` is a legitimate *value* (the user cleared the cap) rather
 * than an absence, and it is only emitted when it genuinely differs from what
 * the row already holds.
 *
 * A `draft` key that is absent means "the form does not edit this field" — for
 * a protected row that is `name`, and for a subcategory that is `monthlyCap`.
 * Those two exclusions are the caller's to make (`useCategories.updateCategory`
 * refuses them outright); this function only ever reports differences in what
 * it was given.
 *
 * Names and glyphs are trimmed before comparison, as the server trims before
 * its own uniqueness check — so retyping `Food ` as `Food` is correctly no
 * change at all and makes no request.
 *
 * @param {object} category The live row.
 * @param {{ name?: string, iconName?: string, glyph?: string, monthlyCap?: number | null }} draft
 * @returns {{ name?: string, iconName?: string, glyph?: string, monthlyCap?: number | null }}
 */
export function buildCategoryUpdateChanges(category, draft) {
  const changes = {};

  if (draft.name !== undefined) {
    const name = draft.name.trim();
    if (name !== category.name) {
      changes.name = name;
    }
  }
  if (draft.iconName !== undefined && draft.iconName !== category.iconName) {
    changes.iconName = draft.iconName;
  }
  if (draft.glyph !== undefined) {
    const glyph = draft.glyph.trim();
    if (glyph !== category.glyph) {
      changes.glyph = glyph;
    }
  }
  if (draft.monthlyCap !== undefined) {
    const monthlyCap = draft.monthlyCap ?? null;
    if (monthlyCap !== (category.monthlyCap ?? null)) {
      changes.monthlyCap = monthlyCap;
    }
  }

  return changes;
}

/**
 * A category plus the derived `parentCategoryName` every display surface
 * needs. This is the shape that travels out of the picker as
 * `route.params.selectedCategory`, and the shape Add Expense snapshots onto a
 * transaction.
 *
 * @param {object} category A CategoryResponse entry.
 * @param {string | null} [parentCategoryName] `null` for a top-level category.
 * @returns {object} The category with `parentCategoryName` attached.
 */
export function toCategorySelection(category, parentCategoryName = null) {
  return { ...category, parentCategoryName };
}

/**
 * Flattens the tree into one list of selectable entries, each carrying its
 * `parentCategoryName`, parents immediately followed by their own children.
 *
 * Used for search (which must match subcategory names — ADR 0019 §10.2) and
 * for resolving a transaction's frozen category snapshot back to a live row.
 * **With `includeSubcategories: false` the result is the top level only**,
 * which is how the toggle-off case offers nothing it should not (§6.1) without
 * any call site writing its own filter.
 *
 * @param {object[]} categories The top-level array.
 * @param {{ includeSubcategories?: boolean }} [options]
 * @returns {object[]} Entries with `parentCategoryName` attached.
 */
export function flattenCategoryTree(categories, { includeSubcategories = true } = {}) {
  const flattened = [];
  categories.forEach((category) => {
    flattened.push(toCategorySelection(category, null));
    if (!includeSubcategories) {
      return;
    }
    (category.subcategories ?? []).forEach((subcategory) => {
      flattened.push(toCategorySelection(subcategory, category.name));
    });
  });
  return flattened;
}

/**
 * Resolves a frozen `(parentCategoryName, categoryName)` pair back to the live
 * category row it was written from, or `null` when nothing matches.
 *
 * **Matching on the pair rather than the leaf name alone is the point** (ADR
 * 0019 §10.3): with two levels a bare `Snacks` can match two different rows,
 * and picking the first would silently resolve a transaction to the wrong
 * category. A `null`/absent parent name matches a top-level category only.
 *
 * Comparison stays exact (`===`), as it was before subcategories: these names
 * are server-written snapshots of server-stored names, not user input.
 *
 * @param {object[]} categories The top-level array.
 * @param {string | null | undefined} parentCategoryName
 * @param {string} name
 * @returns {object | null}
 */
export function findCategoryByNamePath(categories, parentCategoryName, name) {
  if (!parentCategoryName) {
    return categories.find((category) => category.name === name) ?? null;
  }
  const parent = categories.find((category) => category.name === parentCategoryName);
  if (!parent) {
    return null;
  }
  return (parent.subcategories ?? []).find((subcategory) => subcategory.name === name) ?? null;
}

/**
 * True when at least one category has children — i.e. when path labels and
 * the "a parent's cap includes its subcategories" rule are actually in play
 * for this account. Lets a surface add a word of explanation only when it is
 * relevant (ADR 0019 §10.4) instead of unconditionally.
 *
 * @param {object[]} categories The top-level array.
 * @returns {boolean}
 */
export function hasAnySubcategory(categories) {
  return categories.some((category) => hasSubcategories(category));
}

/**
 * True when this one category has children. Private: every surface that needs
 * the *rule* rather than the raw count goes through
 * `isFinalCategorySelection`/`requiresSubcategorySelection` below, so "has
 * children" is never the thing a screen reasons about.
 *
 * @param {object} category A tree entry.
 * @returns {boolean}
 */
function hasSubcategories(category) {
  return (category.subcategories ?? []).length > 0;
}

/**
 * Whether a **live tree row** is specific enough to be a transaction's final
 * category — i.e. whether it can still be narrowed.
 *
 * Final when it is a subcategory (nothing sits below it — ADR 0019 §2's
 * one-level rule), or when it is a top-level category with no children. Not
 * final when it is a top-level category that has children.
 *
 * **This encodes the Project Owner's 2026-10-24 addendum rule and nothing
 * else**: when subcategories are enabled, picking a parent that has children
 * is an unfinished choice, and the "a parent with no subcategories may be
 * picked on its own" escape is the `hasSubcategories` half of the same line.
 * The rule is deliberately expressed without reference to
 * `subcategoriesEnabled`: callers AND it with the preference
 * (`useCategories().needsSubcategorySelection`), so one function serves both
 * states and the preference stays in one place.
 *
 * **Must only be called with a row from the live tree** — a `GET /categories`
 * entry, or an entry out of `flattenCategoryTree` (which spreads one). A
 * category *snapshot* read off a transaction carries no `subcategories` array
 * and would always look final; `requiresSubcategorySelection` below is the
 * entry point that handles that case correctly.
 *
 * @param {object} category A live tree row.
 * @returns {boolean}
 */
export function isFinalCategorySelection(category) {
  if ((category.parentCategoryId ?? null) !== null) {
    return true;
  }
  return !hasSubcategories(category);
}

/**
 * Whether a chosen category still needs a subcategory picked under it, ignoring
 * the user's preference (the caller applies that).
 *
 * Takes a **selection**, which is deliberately a looser shape than a tree row:
 * it is either what the picker handed back (`toCategorySelection`, a live row
 * plus `parentCategoryName`) or what Add Expense reconstructs from a
 * transaction's frozen snapshot in edit mode (`{ name, iconName, glyph,
 * parentCategoryName }` — no `id`, no `subcategories`). So the selection is
 * resolved back to its live row by its `(parentCategoryName, name)` pair, for
 * the same reason `findCategoryByNamePath` exists: a bare leaf name can match
 * two different rows (ADR 0019 §3).
 *
 * Three answers are `false` — i.e. "nothing more is needed":
 * - a subcategory was chosen (`parentCategoryName` is set);
 * - the chosen top-level category has no children (the addendum's explicit
 *   "so the user isn't blocked" escape);
 * - the selection does not resolve to a live row at all. **That last one is
 *   not laziness, it is the rule that keeps legacy records editable:** a
 *   transaction tagged to a category that was since renamed must still save,
 *   and blocking on a row nobody can find would be an error with no action
 *   that fixes it (constitution §22).
 *
 * @param {object[]} categories The live top-level array.
 * @param {object | null | undefined} selection
 * @returns {boolean}
 */
export function requiresSubcategorySelection(categories, selection) {
  if (!selection) {
    // "Nothing selected" is its own, older validation error ("Select a
    // category."); this function must not claim that case too.
    return false;
  }
  if (selection.parentCategoryName) {
    return false;
  }
  const liveCategory = findCategoryByNamePath(categories, null, selection.name);
  if (!liveCategory) {
    return false;
  }
  return !isFinalCategorySelection(liveCategory);
}
