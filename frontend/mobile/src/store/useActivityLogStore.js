import { create } from 'zustand';

/**
 * Local, per-transaction edit history — the only thing left of the formerly
 * app-wide local activity log (docs/decisions/0008-activity-log-system.md §1).
 *
 * ---
 * **THIS NO LONGER BACKS THE GLOBAL ACTIVITIES FEED. DO NOT ADD IT BACK.**
 *
 * Domain 7's wiring step made `GET /api/v1/activities` (api-overview.md §11.1)
 * the single source of the Activities screen — see `useActivitiesStore`.
 * `activities` rows are immutable and are written **only** by the server's own
 * fan-out, in the same transaction as the ledger event that caused them, and
 * §11 defines no write endpoint at all (`backend/README.md` §17's opening
 * block). So the three events this store used to mint locally — a split save,
 * a group creation, a settlement — are now the server's, and their builders
 * were deleted from `utils/activityLogEntries.js` rather than left to run: a
 * client-composed entry beside a server-composed one describing the same event
 * would look identical in the feed, count that event twice, and exist on no
 * other device.
 *
 * ---
 * **WHAT REMAINS, AND WHY IT IS STILL HERE.**
 *
 * `transaction_edited` is the one documented activity type with **no writer
 * anywhere in the backend** (`backend/README.md` §17.8 flag 8, and §17.10 names
 * it as the most likely next ask precisely because this app already renders
 * it). Nor could §11.1's `transactionId` filter substitute: the server writes
 * `related_transaction_id` only on the row of the member whose personal
 * transaction *it* created, and this app sends `addToPersonalExpenses: false`
 * and writes that transaction itself — so that filter answers an empty page for
 * every row this app's data contains (§17.2).
 *
 * The entries here are therefore honest **local** records of edits made on this
 * device, rendered in exactly one place: Transaction Detail's own ACTIVITY
 * card, filtered to one transaction. **Nothing merges them into the §11.1
 * feed** — the Activities screen does not read this store at all — so a
 * server-composed sentence and a device-composed one are never shown side by
 * side.
 *
 * **Follow-up, and it is a deletion rather than a migration:** when the backend
 * gains a `transaction_edited` writer, this store, `activityLogEntries.js` and
 * AddExpenseScreen's call into it all go away, and Transaction Detail reads
 * `GET /activities?transactionId=` instead. That is a Backend-Engineer /
 * System-Architect decision first (the sentence, icon, glyph, tone and
 * recipient rule for the type are all unspecified — §17.8 flag 8), which is why
 * it is flagged here rather than pre-empted.
 *
 * In-memory only, no `persist` middleware — so this history is per-session, a
 * limitation that is real and that the server-side writer above is the fix for.
 *
 * ---
 * Item shape — **§11.1's `ActivityResponse` field names**, so one row component
 * (`ActivityLogItem`) renders both this and the server feed with no translation
 * layer and no duplicate component (constitution §8):
 * {
 *   id: string,                 // `activity-${Date.now()}-${n}` — the batch
 *                                // index is ADR 0008 §2.1's id-collision
 *                                // guard for a multi-field edit saved in one
 *                                // synchronous call.
 *   type: 'transaction_edited',
 *   activityDate: string,       // 'YYYY-MM-DD' — this DEVICE's clock at the
 *                                // moment of the edit. A server row's
 *                                // equivalent is UTC at the instant the
 *                                // fan-out ran (`backend/README.md` §17.8
 *                                // flag 3), which is the one place the two
 *                                // sources legitimately differ.
 *   activityTime: string,       // 'HH:mm'
 *   descriptionPrefix: string,  // the complete sentence, since entityName is
 *                                // always null for this type.
 *   entityName: null,
 *   descriptionSuffix: '',      // '' is NORMAL beside a null entityName, not
 *                                // missing data — the same convention §11.1's
 *                                // own rows follow.
 *   relatedTransactionId: string,
 *   relatedGroupId: null,
 *   relatedContactId: null,
 *   relatedSplitExpenseId: null,
 *   iconName: string,           // Ionicons name (not rendered yet).
 *   glyph: string,              // the single character IconBadge renders.
 *   tone: string,               // an IconBadge tone.
 * }
 *
 * No cascading deletes (ADR 0008 §1.4): deleting a transaction does NOT remove
 * the entries referencing it, so `relatedTransactionId` may become an orphaned
 * reference by design. The server's own feed behaves the same way — its FKs are
 * `ON DELETE SET NULL` and the row stays readable because its snapshot columns
 * survive (`backend/README.md` §17.2).
 */
export const useActivityLogStore = create((set) => ({
  activities: [],

  /**
   * Prepends multiple entries at once, preserving the caller's own array order.
   * Needed because a single transaction edit can produce more than one entry in
   * one Save.
   *
   * **The only writer is AddExpenseScreen's edit branch.** The single-entry
   * `addActivity` that used to sit beside this was removed with its three
   * callers: those events are the server's now (see this file's note).
   *
   * @param {object[]} newActivities
   */
  addActivities: (newActivities) =>
    set((state) => ({ activities: [...newActivities, ...state.activities] })),
}));
