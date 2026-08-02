/**
 * The confirmation copy for deleting a category (api-overview.md §3.4/§3.5,
 * docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md
 * §2.2).
 *
 * It lives in its own module for one reason: **one sentence of it is the
 * Project Owner's own wording and must appear verbatim**, so it is written
 * once, in a constant, where a well-meaning reword is a visible diff rather
 * than a quiet edit inside a screen. Keeping the whole message here also keeps
 * the three-state decision (count known and non-zero / known and zero /
 * unknown) out of the dialog, which only renders a string.
 *
 * Layer rule: a pure function of its arguments. No React, no store, no api —
 * the same shape as `utils/categories.js`.
 */

/**
 * **VERBATIM — the Project Owner's own wording. Do not reword, re-punctuate or
 * "fix the grammar".** It is quoted in ADR 0021's Context and in
 * api-overview.md §3.5, both of which are the contract this screen implements.
 */
export const CATEGORY_TRANSACTIONS_WARNING =
  'You are deleting the category having some transactions which will be now consider in the misc category';

/**
 * Shown ahead of the warning when the §3.5 pre-flight did not answer, so the
 * sentence above is not read as a statement of fact we do not have. The
 * warning itself is still shown — **failing closed is the only safe direction
 * for a destructive act** (§3.5, constitution §22), and a dialog that implied
 * the category was empty because a count request timed out would be the one
 * outcome that cannot be allowed.
 */
const USAGE_UNKNOWN_NOTE = 'We could not check this category for transactions just now.';

const IRREVERSIBLE_NOTE = 'This cannot be undone.';

/**
 * Builds the `ConfirmationDialog` message for deleting one category.
 *
 * **`transactionCount` is the server's number or nothing.** Pass
 * `isUsageKnown: false` when the pre-flight failed; never pass a count derived
 * from `useTransactionsStore`, which holds one filtered page of a paginated
 * list and would under-report by construction (§3.5 rejects that option by
 * name).
 *
 * **`subcategoryCount` may legitimately come from the held tree** when the
 * pre-flight failed, and the caller does exactly that. That is not the same
 * mistake: `GET /categories` is not paginated and returns the user's whole
 * tree, so the children of a row the app is displaying are fully known
 * locally. The server's count is still preferred when it is available, because
 * another device may have added a child since the last read.
 *
 * @param {{
 *   categoryName: string,
 *   transactionCount: number,
 *   subcategoryCount: number,
 *   isUsageKnown: boolean,
 * }} params
 * @returns {string} Dialog body copy. Paragraphs, newest concern first.
 */
export function buildCategoryDeleteMessage({
  categoryName,
  transactionCount,
  subcategoryCount,
  isUsageKnown,
}) {
  const paragraphs = [`"${categoryName}" will be deleted.`];

  // Said BEFORE the user confirms, not reported afterwards: deleting a parent
  // destroys its children too (§3.4's cascade), and the deletion response's
  // `deletedSubcategoryCount` arrives after the irreversible act.
  if (subcategoryCount > 0) {
    paragraphs.push(
      subcategoryCount === 1
        ? 'Its 1 subcategory will be deleted with it.'
        : `Its ${subcategoryCount} subcategories will be deleted with it.`,
    );
  }

  if (!isUsageKnown) {
    paragraphs.push(USAGE_UNKNOWN_NOTE);
    paragraphs.push(CATEGORY_TRANSACTIONS_WARNING);
  } else if (transactionCount > 0) {
    paragraphs.push(CATEGORY_TRANSACTIONS_WARNING);
  }

  paragraphs.push(IRREVERSIBLE_NOTE);

  return paragraphs.join('\n\n');
}
