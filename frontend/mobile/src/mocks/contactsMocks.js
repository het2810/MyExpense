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
 * `recentContactIds` was untouched by that migration — it is never mutated,
 * so it had no reason to move off a plain array. It fed the New Group modal's
 * "Add Members" → "Recent" row (PDF p.2).
 *
 * ---
 * **NOTHING IMPORTS THIS FILE ANY MORE, AS OF DOMAIN 6'S WIRING STEP.**
 *
 * Contacts are server data now (`GET /api/v1/contacts`,
 * docs/api/api-overview.md §6.1), so these three hand-written ids can never
 * match a real contact id and the "Recent" row they drove could only ever have
 * rendered empty — it was removed rather than left as dead UI (see
 * NewGroupScreen.jsx's header note).
 *
 * The file is left in place rather than deleted: **§6.1 exposes no recency or
 * usage signal**, so "which contacts does this user reach for most" is an
 * unanswered product question, not a solved one, and a client-side guess
 * (most recently created? most split with?) would be fabricating a rule.
 * Flagged in this round's report; delete it, or replace the constant with a
 * real signal, when that question is answered.
 */

export const recentContactIds = ['contact-1', 'contact-2', 'contact-3'];
