import { create } from 'zustand';

/**
 * Zustand store holding the app's in-app contact list — promoted from what
 * was previously a plain exported array (`contacts` in
 * src/mocks/contactsMocks.js), per docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §2. A plain module-level array
 * can't support creating a new contact reactively (Split Add Expense's
 * inline "Create Contact" form, ADR 0006 §3) — the same reasoning that
 * already moved useGroupsStore/useIndividualSplitsStore off their own
 * former plain-array mocks. In-memory only, no persistence, same pattern as
 * every other store in this phase.
 *
 * `recentContactIds` (src/mocks/contactsMocks.js) is untouched by this
 * migration — it is never mutated, so it has no reason to move.
 *
 * Item shape:
 * {
 *   id: string,
 *   name: string,
 *   initials: string,
 *   phoneOrEmail?: string,  // NEW (ADR 0006 §2) — only present on contacts
 *                            // created via the new Create Contact form
 *                            // (SplitAddExpenseScreen.jsx). Absent
 *                            // (undefined) on the 9 seed contacts below —
 *                            // nothing in the app reads/displays a
 *                            // contact's phone/email yet, so the 9 seeds
 *                            // are deliberately not backfilled with
 *                            // invented values (ADR 0006 §2).
 * }
 */
const initialContacts = [
  { id: 'contact-1', name: 'Rahul Mehta', initials: 'RM' },
  { id: 'contact-2', name: 'Priya Nair', initials: 'PN' },
  { id: 'contact-3', name: 'Simran Kaur', initials: 'SK' },
  { id: 'contact-4', name: 'Arjun Verma', initials: 'AV' },
  { id: 'contact-5', name: 'Neha Kapoor', initials: 'NK' },
  { id: 'contact-6', name: 'Karan Singh', initials: 'KS' },
  { id: 'contact-7', name: 'Aditi Sharma', initials: 'AS' },
  { id: 'contact-8', name: 'Rohan Mehta', initials: 'RM' },
  { id: 'contact-9', name: 'Karan Verma', initials: 'KV' },
];

export const useContactsStore = create((set) => ({
  contacts: initialContacts,

  /**
   * Prepends a newly created contact — mirrors useGroupsStore.addGroup /
   * useIndividualSplitsStore.addIndividualSplit exactly (ADR 0006 §2).
   * @param {object} contact
   */
  addContact: (contact) => set((state) => ({ contacts: [contact, ...state.contacts] })),
}));
