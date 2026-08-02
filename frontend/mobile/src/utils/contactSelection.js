/**
 * The rules of Split Add Expense's multi-select CONTACT field —
 * docs/decisions/0026-multi-contact-individual-splits.md §8.1/§8.3.
 *
 * Pure functions, no state. The hook (`hooks/useSplitContactSelection.js`)
 * holds the selection; the field component renders it. Since the field lists
 * the device address book, a selection is a device number
 * (`utils/deviceContacts.js#toDeviceSelection`) whose `id` is keyed by the
 * number, so "already selected" also catches the same number stored under two
 * device entries. Searching and excluding live in `utils/deviceContacts.js`.
 */

/**
 * The most contacts one individual split may name: `participants` is capped at
 * 50 server-side, and the caller plus 49 counterparts fills it (ADR 0026 §5.1).
 */
export const MAX_SPLIT_COUNTERPARTS = 49;

/**
 * Why `contact` cannot be added to the selection, or null when it can.
 *
 * The linked-account check is a **UX pre-check only** (ADR 0026 §8.1): two
 * address-book entries linked to the same registered user are one person, and
 * the server rejects that split (§5.1 C6). `linkedUserId` is compared and
 * nothing more — resolving it into an identity stays the server's job (ADR
 * 0023 §1.3).
 *
 * @param {object} contact A `ContactResponse` (§6.1).
 * @param {object[]} selectedContacts
 * @returns {string | null} User-facing copy.
 */
export function getContactAddRejection(contact, selectedContacts) {
  const selected = selectedContacts ?? [];
  if (selected.some((entry) => entry.id === contact.id)) {
    return `${contact.name} is already in this split.`;
  }
  if (
    contact.linkedUserId &&
    selected.some((entry) => entry.linkedUserId && entry.linkedUserId === contact.linkedUserId)
  ) {
    return 'That person is already in this split.';
  }
  if (selected.length >= MAX_SPLIT_COUNTERPARTS) {
    return `A split can include up to ${MAX_SPLIT_COUNTERPARTS} people besides you.`;
  }
  return null;
}

/**
 * A stable key for the selection — the joined ids, in selection order. The
 * split-config reset effect keys on this rather than on array identity, so a
 * re-render never resets a custom split (ADR 0026 §8.3).
 *
 * @param {object[]} selectedContacts
 * @returns {string}
 */
export function getContactSelectionKey(selectedContacts) {
  return (selectedContacts ?? []).map((contact) => contact.id).join(',');
}
