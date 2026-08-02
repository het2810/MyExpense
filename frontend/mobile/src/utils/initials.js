/**
 * Avatar initials from one display-name string — first letter of the first
 * word plus first letter of the last word, uppercased; a single-word name
 * yields one letter.
 *
 * **Promoted from SplitAddExpenseScreen's private `getInitialsFromName`, not
 * newly invented** (docs/decisions/0006-contact-group-search-and-split-tag.md
 * §3). It had one call site and the note "not promoted to a shared utility
 * since this is its only call site"; wiring the shared ledger adds two more and
 * crosses constitution §25's threshold:
 *
 * - **a group member** — `GroupResponse.members[]` (api-overview.md §7.1)
 *   carries a server-resolved `name` and **no `initials` field**, unlike
 *   `ContactResponse` (§6.1), which does and whose value must be used as-is;
 * - **a settlement counterpart** — picked from that same member list.
 *
 * It is deliberately the same rule the backend applies when it derives
 * `contacts.initials` (`backend/README.md` §15.1), so a contact and a group
 * member with the same name render the same two letters. `Avatar` slices to two
 * characters anyway, so a name that produces more is harmless.
 *
 * @param {string | null | undefined} name
 * @returns {string} e.g. 'Aditi Sharma' -> 'AS', 'Aditi' -> 'A', '' -> ''
 */
export function getInitialsFromName(name) {
  const words = typeof name === 'string' ? name.trim().split(/\s+/).filter(Boolean) : [];
  if (words.length === 0) {
    return '';
  }
  if (words.length === 1) {
    return words[0].charAt(0).toUpperCase();
  }
  const first = words[0].charAt(0);
  const last = words[words.length - 1].charAt(0);
  return `${first}${last}`.toUpperCase();
}
