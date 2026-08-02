import { create } from 'zustand';
import { useContactsStore } from './useContactsStore';

/**
 * Zustand store holding the Individual (1-on-1) split entries that feed the
 * Split screen's "Individual" tab (docs/decisions/0004-split-individual-tab.md).
 *
 * Migrated from what was previously a plain exported array
 * (`individualSplits` in src/mocks/splitMocks.js) — ADR 0004 §4 explicitly
 * left this as a plain array "if a future pass adds a way to create/settle
 * an Individual split, `individualSplits` should migrate to a Zustand
 * store at that time, mirroring `useGroupsStore`'s own precedent exactly."
 * docs/decisions/0005-split-add-expense-flow.md §2.2 is that future pass —
 * saving a Split Add Expense against a contact needs to update this list
 * reactively (and, for a brand-new contact relationship, create a new
 * entry), which a plain module-level array can't do.
 *
 * Item shape (mirrors the group entry shape, `name` -> `personName`,
 * `memberCount`/`memberContactIds` dropped — no 1-on-1 equivalent).
 * `contactId` is NEW (ADR 0005 §2.2) — a stable reference back to
 * useContactsStore.js (formerly contactsMocks.js's plain array — promoted
 * to a store by ADR 0006 §2), used to reliably find-or-create the right
 * aggregate entry when a split is saved, instead of matching on the
 * fragile, non-unique `personName` string:
 * {
 *   id: string,
 *   contactId: string,      // references useContactsStore.js contact ids
 *   personName: string,
 *   lastActivity: string,   // short activity summary line
 *   yourBalance: number,    // positive = you are owed, negative = you owe, 0 = settled
 * }
 *
 * Seed data migration (ADR 0005 §2.2): each of the 4 original seed entries
 * needed a `contactId` matched to whichever contactsMocks.js contact its
 * personName corresponds to. Only "Priya Nair" matched an existing contact
 * (contact-2); the other three (Aditi Sharma, Rohan Mehta, Karan Verma) had
 * no match, so 3 new contacts were added to contactsMocks.js (contact-7/8/9)
 * rather than mismatching an existing contact to a different name.
 */
const initialIndividualSplits = [
  {
    id: 'individual-1',
    contactId: 'contact-7',
    personName: 'Aditi Sharma',
    lastActivity: 'Dinner split • 3 days ago',
    yourBalance: 450,
  },
  {
    id: 'individual-2',
    contactId: 'contact-8',
    personName: 'Rohan Mehta',
    lastActivity: 'Movie tickets • 6 days ago',
    yourBalance: -300,
  },
  {
    id: 'individual-3',
    contactId: 'contact-2',
    personName: 'Priya Nair',
    lastActivity: 'Cab fare • 1 week ago',
    yourBalance: 0,
  },
  {
    id: 'individual-4',
    contactId: 'contact-9',
    personName: 'Karan Verma',
    lastActivity: 'Concert tickets • 2 weeks ago',
    yourBalance: -850,
  },
];

export const useIndividualSplitsStore = create((set, get) => ({
  individualSplits: initialIndividualSplits,

  /**
   * Prepends a new entry — exposed for symmetry with useGroupsStore's
   * addGroup and for any future flow that needs to create an entry
   * directly. The Split Add Expense save flow itself goes through
   * applySplitExpense below, which already handles the find-or-create rule
   * internally.
   * @param {object} entry
   */
  addIndividualSplit: (entry) =>
    set((state) => ({ individualSplits: [entry, ...state.individualSplits] })),

  /**
   * Updates the aggregate entry for `contactId` (yourBalance += balanceDelta,
   * lastActivity replaced) — or, per the find-or-create rule (ADR 0005
   * §2.2), creates a brand-new entry if this is the first split ever
   * recorded with that contact:
   * `{ id: 'individual-${contactId}', contactId, personName: contact.name,
   *    lastActivity, yourBalance: balanceDelta }`.
   *
   * `personName` for a newly-created entry is resolved from
   * useContactsStore.js by `contactId` (reading live state via `.getState()`
   * so a contact created moments earlier via Split Add Expense's inline
   * Create Contact form — ADR 0006 §3 — resolves correctly here too, not
   * just a frozen seed snapshot) — this action's signature intentionally
   * matches ADR 0005 §6.3's exact call shape
   * (`applySplitExpense(contactId, balanceDelta, activityLabel)`), which
   * doesn't carry the full contact object.
   *
   * Returns the resulting entry (existing, updated, or newly created) so
   * the caller (SplitAddExpenseScreen's handleSave) can read its `id` for
   * the split-expense record's `individualId` field (ADR 0005 §2.3) without
   * a second lookup.
   *
   * @param {string} contactId
   * @param {number} balanceDelta - netPositionDelta
   * @param {string} activityLabel - e.g. `${title} • Today`
   * @returns {object} the resulting individualSplits entry
   */
  applySplitExpense: (contactId, balanceDelta, activityLabel) => {
    const state = get();
    const existingIndex = state.individualSplits.findIndex(
      (entry) => entry.contactId === contactId,
    );

    if (existingIndex !== -1) {
      const existing = state.individualSplits[existingIndex];
      const updatedEntry = {
        ...existing,
        yourBalance: existing.yourBalance + balanceDelta,
        lastActivity: activityLabel,
      };
      set({
        individualSplits: state.individualSplits.map((entry, index) =>
          index === existingIndex ? updatedEntry : entry,
        ),
      });
      return updatedEntry;
    }

    const contact = useContactsStore
      .getState()
      .contacts.find((candidate) => candidate.id === contactId);
    const newEntry = {
      id: `individual-${contactId}`,
      contactId,
      personName: contact ? contact.name : 'Unknown Contact',
      lastActivity: activityLabel,
      yourBalance: balanceDelta,
    };
    set({ individualSplits: [newEntry, ...state.individualSplits] });
    return newEntry;
  },

  /**
   * Settle Up (docs/decisions/0009-split-detail-and-settle-up.md §6.3) —
   * zeroes this entry's aggregate `yourBalance` and stamps `lastActivity`
   * with the same `"• Today"` suffix convention every other lastActivity
   * write already uses. A dedicated action, not a reuse of
   * `applySplitExpense` with a manufactured negative delta — see the ADR for
   * why. Does not touch useTransactionsStore (ADR 0009 §6.1) or
   * useSplitExpensesStore.
   * @param {string} individualId - the individualSplits entry's own id
   */
  settleBalance: (individualId) =>
    set((state) => ({
      individualSplits: state.individualSplits.map((entry) =>
        entry.id === individualId
          ? { ...entry, yourBalance: 0, lastActivity: 'Settled up • Today' }
          : entry,
      ),
    })),
}));
