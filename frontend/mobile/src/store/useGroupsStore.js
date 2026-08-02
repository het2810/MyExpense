import { create } from 'zustand';

/**
 * Zustand store holding the group list that feeds the Split Groups List
 * screen's "Active Groups" section.
 *
 * Migrated from what was previously a plain exported array (`activeGroups`
 * in src/mocks/splitMocks.js) — same reasoning as useTransactionsStore:
 * creating a group from the New Group modal needs to show up on the Split
 * tab immediately, which a plain module-level array can't do reactively.
 * In-memory only, no persistence, same pattern as
 * useAuthStore/useThemeStore/useSettingsStore.
 *
 * Item shape — `memberContactIds` added per
 * docs/decisions/0005-split-add-expense-flow.md §2.1 (a pre-existing data
 * gap: rendering per-person rows for a group split, and deriving the
 * group's own participant list, is impossible without knowing who the
 * members actually are — a bare `memberCount` number wasn't enough):
 * {
 *   id: string,
 *   name: string,
 *   memberContactIds: string[], // references contactsMocks.js contact ids.
 *                                // Does NOT include the current user — "you"
 *                                // are implicitly a member of every group
 *                                // (mirrors NewGroupScreen.jsx's own existing
 *                                // "+1 accounts for the current user"
 *                                // comment). Mirrors the groupId-reference
 *                                // (not denormalize) precedent from ADR 0003 §2.
 *   lastActivity: string,   // short activity summary line
 *   yourBalance: number,    // positive = you are owed, negative = you owe, 0 = settled
 * }
 *
 * `memberCount` is intentionally NOT stored — it is now a derived value
 * (`group.memberContactIds.length + 1`), computed by consumers (e.g.
 * SplitGroupsListScreen.jsx's group-card subtitle). Storing both would
 * create exactly the kind of redundant, driftable dual-source-of-truth ADR
 * 0003 §2 already rejected for `groupName` (ADR 0005 §2.1).
 */
const initialGroups = [
  {
    id: 'group-1',
    name: 'Flatmates',
    // 3 ids -> memberCount derives to 4, matching the original seed value.
    memberContactIds: ['contact-1', 'contact-2', 'contact-3'],
    lastActivity: 'Electricity bill • 2 days ago',
    yourBalance: 1600,
  },
  {
    id: 'group-2',
    name: 'Goa Trip',
    // 5 ids -> memberCount derives to 6, matching the original seed value.
    memberContactIds: ['contact-2', 'contact-3', 'contact-4', 'contact-5', 'contact-6'],
    lastActivity: 'Hotel booking • 5 days ago',
    yourBalance: -1400,
  },
  {
    id: 'group-3',
    name: 'Office Lunch Club',
    // ADR 0005 §2.1 flagged that the original memberCount (8, i.e. 7
    // members + you) exceeds the mock contact pool available at seed-data
    // authoring time and left the resolution to the Frontend Engineer's
    // mock-data call: either reuse the small contact pool or adjust
    // memberCount down to fit. Reusing all 6 original contacts (rather than
    // also pulling in the 3 contacts added for useIndividualSplitsStore's
    // seed data, which represent distinct 1-on-1 relationships) and
    // adjusting memberCount down to 7 (6 ids + you) was chosen as the
    // simpler, least-surprising option.
    memberContactIds: ['contact-1', 'contact-2', 'contact-3', 'contact-4', 'contact-5', 'contact-6'],
    lastActivity: 'Friday lunch • 1 week ago',
    yourBalance: 0,
  },
];

export const useGroupsStore = create((set) => ({
  groups: initialGroups,

  /**
   * Prepends a newly created group so it appears at the top of the Split
   * tab's Active Groups list.
   * @param {object} group
   */
  addGroup: (group) => set((state) => ({ groups: [group, ...state.groups] })),

  /**
   * Updates a group's aggregate balance/activity after a split expense is
   * saved against it — docs/decisions/0005-split-add-expense-flow.md §6.3.
   * Always called (independent of whether the split's "add to my expenses"
   * checkbox was checked), using the net-position-delta formula:
   * `(paidById === 'self' ? totalAmount : 0) - yourConsumptionShare`.
   * @param {string} groupId
   * @param {number} balanceDelta - netPositionDelta, added to the group's existing yourBalance
   * @param {string} activityLabel - e.g. `${title} • Today`
   */
  applySplitExpense: (groupId, balanceDelta, activityLabel) =>
    set((state) => ({
      groups: state.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              yourBalance: group.yourBalance + balanceDelta,
              lastActivity: activityLabel,
            }
          : group,
      ),
    })),

  /**
   * Settle Up (docs/decisions/0009-split-detail-and-settle-up.md §6.3) —
   * zeroes the group's aggregate `yourBalance` and stamps `lastActivity`
   * with the same `"• Today"` suffix convention every other lastActivity
   * write already uses. A dedicated action, not a reuse of
   * `applySplitExpense` with a manufactured negative delta — see the ADR for
   * why. Does not touch useTransactionsStore (ADR 0009 §6.1) or
   * useSplitExpensesStore.
   * @param {string} groupId
   */
  settleBalance: (groupId) =>
    set((state) => ({
      groups: state.groups.map((group) =>
        group.id === groupId
          ? { ...group, yourBalance: 0, lastActivity: 'Settled up • Today' }
          : group,
      ),
    })),
}));
