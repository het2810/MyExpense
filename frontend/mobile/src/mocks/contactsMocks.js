/**
 * MOCK DATA — locally defined placeholder data, not sourced from any API.
 *
 * The `contacts` array previously exported from this file has moved to
 * src/store/useContactsStore.js (docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §2) — contact creation
 * (Split Add Expense's inline "Create Contact" form) needs a mutable,
 * reactive data source, which a plain module-level array can't provide.
 * The seed contacts themselves are unchanged, just relocated.
 *
 * `recentContactIds` is untouched by that migration — it is never mutated,
 * so it has no reason to move off a plain array. Feeds the New Group
 * modal's "Add Members" search "Recent" row (PDF p.2).
 */

export const recentContactIds = ['contact-1', 'contact-2', 'contact-3'];
