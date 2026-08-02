import { create } from 'zustand';

/**
 * Zustand store holding the flat, app-wide activity log — docs/decisions/
 * 0008-activity-log-system.md §1. Backs two surfaces: Transaction Detail's
 * ACTIVITY card (filtered to one transaction) and the global Activities
 * screen (unfiltered, reached from Profile). In-memory only, no `persist`
 * middleware — same pattern as every other store in this app at this phase.
 *
 * Item shape (ADR 0008 §1):
 * {
 *   id: string,                 // `activity-${Date.now()}`, or
 *                                // `activity-${Date.now()}-${n}` for
 *                                // entries minted in the same synchronous
 *                                // batch (ADR 0008 §2.1's multi-field-edit
 *                                // id-collision guard).
 *   type: 'transaction_edited' | 'split_saved' | 'group_created' | 'settlement',
 *                                // an extensible union — future event types
 *                                // are added here without touching this
 *                                // shape's other fields. 'settlement' added
 *                                // by docs/decisions/
 *                                // 0009-split-detail-and-settle-up.md §6.3.
 *   date: string,                // 'YYYY-MM-DD' — getTodayIsoDate() at
 *                                // creation (when the EDIT/SAVE happened,
 *                                // not the transaction's own date).
 *   time: string,                // 'HH:mm' — getCurrentTimeString() at
 *                                // creation. Kept as two fields (not a
 *                                // combined timestamp) so dateDisplay.js's
 *                                // existing getDateDisplayLabel/getTimeLabel
 *                                // can render it with zero new parsing logic
 *                                // (ADR 0008 §1.1).
 *   descriptionPrefix: string,   // sentence text BEFORE the linked entity
 *                                // name — or the COMPLETE sentence when
 *                                // entityName is null.
 *   entityName: string | null,   // the one linked group/contact name
 *                                // rendered inline in accent.text; null when
 *                                // the entry has no single entity to
 *                                // highlight (every transaction_edited
 *                                // entry). Frozen at creation time — a
 *                                // historical record, not live-derived
 *                                // (ADR 0008 §1.3).
 *   descriptionSuffix: string,   // sentence text AFTER the linked entity
 *                                // name — '' when entityName is null.
 *   relatedTransactionId: string | null,
 *   relatedGroupId: string | null,
 *   relatedContactId: string | null,
 *   relatedSplitExpenseId: string | null,  // populated only by split_saved
 *                                // entries.
 *   iconName: string,            // Ionicons name (future — not yet rendered
 *                                // anywhere, mirrors every other iconName
 *                                // field in this codebase today).
 *   glyph: string,                // the single character IconBadge actually
 *                                // renders today.
 *   tone: 'neutral' | 'accent' | 'success' | 'warning' | 'negative' | 'positive', // IconBadge tone
 * }
 *
 * No cascading deletes (ADR 0008 §1.4): deleting a transaction/group/contact
 * does NOT remove or update any activity log entries referencing it —
 * relatedTransactionId etc. may become an orphaned reference by design, so
 * an audit-style log still shows what happened even after the thing it
 * happened to is gone. Mirrors ADR 0007's own "no cascading into
 * useSplitExpensesStore" convention.
 */
export const useActivityLogStore = create((set) => ({
  activities: [],

  /**
   * Prepends one entry — mirrors every other store's "newest first"
   * convention (useTransactionsStore.addTransaction, useGroupsStore.addGroup).
   * @param {object} activity
   */
  addActivity: (activity) =>
    set((state) => ({ activities: [activity, ...state.activities] })),

  /**
   * Prepends multiple entries at once, preserving the caller's own array
   * order (does NOT call addActivity in a loop, which would reverse a
   * multi-entry batch's relative order). Needed because a single
   * transaction edit can produce more than one entry in one Save.
   * @param {object[]} newActivities
   */
  addActivities: (newActivities) =>
    set((state) => ({ activities: [...newActivities, ...state.activities] })),
}));
