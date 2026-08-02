/**
 * Pure builder for `useActivityLogStore` entries — docs/decisions/
 * 0008-activity-log-system.md §2. No store access, no React — mirrors
 * dateDisplay.js/currency.js's existing precedent of pure, store-agnostic
 * formatting/business logic (constitution §8). AddExpenseScreen's `handleSave`
 * calls the builder here, then calls `useActivityLogStore().addActivities`
 * itself.
 *
 * ---
 * **ONE BUILDER LEFT, AND THE OTHER THREE WERE DELETED RATHER THAN KEPT.**
 *
 * Domain 7's wiring step made `GET /api/v1/activities` (api-overview.md §11.1)
 * the source of the global Activities feed, and the server's own fan-out — not
 * this client — composes an activity row whenever a split is saved or a
 * settlement is recorded (`backend/README.md` §17). So
 * `buildSplitSavedActivity`, `buildGroupCreatedActivity` and
 * `buildSettlementActivity` are gone: an entry minted on this device would sit
 * beside a server entry describing the same event, looking identical and
 * counting it twice, and it would not exist on any other device. ADR 0008 §2.2,
 * §2.3 and ADR 0009 §6.3 are now implemented server-side.
 *
 * `buildTransactionEditActivities` survives because **`transaction_edited` has
 * no writer anywhere in the backend** (`backend/README.md` §17.8 flag 8,
 * §17.10 — which names it as the most likely next ask precisely because this
 * app already renders it). It is local, per-transaction edit history, shown
 * only in Transaction Detail's own ACTIVITY card, and it is **not merged into
 * the §11.1 feed anywhere** — nothing on the Activities screen reads this
 * store. When that writer lands, this builder and the local store go with it;
 * see `useActivityLogStore`'s own note.
 *
 * **Its output uses the API's field names** (`activityDate`/`activityTime`,
 * not `date`/`time`), because `ActivityLogItem` now renders one §11.1
 * `ActivityResponse` shape and there is exactly one row component
 * (constitution §8 — no duplicate components, and no second vocabulary for the
 * same fields).
 */

import { getExactDateLabel, getTodayIsoDate, getCurrentTimeString } from './dateDisplay';
import { formatCategoryPath } from './categories';

const ENTRY_TYPE_LABELS = { expense: 'Debit', income: 'Credit' };
const SCOPE_LABELS = { personal: 'Personal', group: 'Group' };
const PAYMENT_MODE_LABELS = { cash: 'Cash', online: 'Online', both: 'Both' };

function formatRupees(amount) {
  return Number(amount).toLocaleString('en-IN');
}

/**
 * Event source 1 — Transaction edited (ADR 0008 §2.1). Diffs
 * `oldTransaction` against `newFields` (the intended values the caller is
 * about to save) using the curated, explicit field list —
 * `categoryIconName`/`categoryGlyph`/`categoryTone`/`splitExpenseId` are never
 * logged (they are derived/implementation fields), and `txnTime` is never
 * logged (it is not editable at all).
 *
 * **Field names are the API's as of Domain 4's wiring step** — `categoryName`,
 * `txnDate`, `receiptPublicId` — because `useTransactionsStore` now holds
 * `TransactionResponse` verbatim (docs/api/api-overview.md §4.1) and nothing
 * in the app renames a contract field (constitution §15/§30). Both sides of
 * every comparison use the same names, so this stays a field-by-field diff
 * with no translation in the middle. **`newFields` is the caller's intended
 * values, NOT the `PATCH` body**: that body is a diff in which an unchanged
 * field is deliberately absent (§4.4's absent-vs-null rule), which would make
 * every untouched field read here as "cleared".
 *
 * Clustered-field skip rules: the category is only logged when `type` did NOT
 * also change (a Debit<->Credit switch changes the category snapshot as an
 * automatic side effect, not a user choice) **and only for an expense** (an
 * income row has no category at all — docs/decisions/0018-income-is-not-a-category.md);
 * `groupId` is only logged when `scope` stayed 'group' on both sides (a
 * Personal<->Group switch changes groupId as a direct consequence); the
 * cash/online split is only logged when `paymentMode` stayed 'both' on both
 * sides.
 *
 * @param {object} params
 * @param {string} params.transactionId
 * @param {object} params.oldTransaction - the full record before the edit
 * @param {object} params.newFields - the intended values, in API field names
 * @param {Array} params.groups - useGroupsStore().groups, for resolving a changed groupId to a name
 * @returns {object[]} zero or more activity entries, one per meaningfully changed field
 */
export function buildTransactionEditActivities({ transactionId, oldTransaction, newFields, groups }) {
  const descriptions = [];

  if (oldTransaction.title !== newFields.title) {
    descriptions.push(`Name changed from "${oldTransaction.title}" to "${newFields.title}".`);
  }

  if (oldTransaction.amount !== newFields.amount) {
    descriptions.push(
      `Amount changed from ₹${formatRupees(oldTransaction.amount)} to ₹${formatRupees(newFields.amount)}.`,
    );
  }

  const typeChanged = oldTransaction.type !== newFields.type;
  if (typeChanged) {
    descriptions.push(
      `Entry type changed from ${ENTRY_TYPE_LABELS[oldTransaction.type]} to ${ENTRY_TYPE_LABELS[newFields.type]}.`,
    );
  }

  // Only log the category when `type` itself did NOT change, and only for an
  // expense (clustered-field rule). The income branch is not a special case
  // being handled — it is the absence of a category: an income row's snapshot
  // is a server constant, so there is never a user-made category change to
  // report on one, and comparing against it would log a phantom line on an
  // income-to-income edit.
  //
  // Compared as the full PATH, not the leaf name alone (docs/decisions/
  // 0019-subcategories-one-optional-level.md §5): moving a transaction from
  // `Food › Snacks` to `Transport › Snacks` is a real change that a leaf-name
  // comparison would silently miss, and the logged line should read the way
  // the user saw it.
  const oldCategoryPath = formatCategoryPath(
    oldTransaction.parentCategoryName,
    oldTransaction.categoryName,
  );
  const newCategoryPath = formatCategoryPath(newFields.parentCategoryName, newFields.categoryName);
  if (!typeChanged && newFields.type === 'expense' && oldCategoryPath !== newCategoryPath) {
    descriptions.push(`Category changed from ${oldCategoryPath} to ${newCategoryPath}.`);
  }

  if (oldTransaction.txnDate !== newFields.txnDate) {
    descriptions.push(
      `Date changed from ${getExactDateLabel(oldTransaction.txnDate)} to ${getExactDateLabel(newFields.txnDate)}.`,
    );
  }

  const scopeChanged = oldTransaction.scope !== newFields.scope;
  if (scopeChanged) {
    descriptions.push(
      `Type changed from ${SCOPE_LABELS[oldTransaction.scope]} to ${SCOPE_LABELS[newFields.scope]}.`,
    );
  }

  // Only log groupId when scope stayed 'group' on both sides (clustered-field rule).
  if (
    !scopeChanged &&
    oldTransaction.scope === 'group' &&
    newFields.scope === 'group' &&
    oldTransaction.groupId !== newFields.groupId
  ) {
    const oldGroupName = groups.find((group) => group.id === oldTransaction.groupId)?.name ?? 'a group';
    const newGroupName = groups.find((group) => group.id === newFields.groupId)?.name ?? 'a group';
    descriptions.push(`Group changed from ${oldGroupName} to ${newGroupName}.`);
  }

  const paymentModeChanged = oldTransaction.paymentMode !== newFields.paymentMode;
  if (paymentModeChanged) {
    descriptions.push(
      `Payment mode changed from ${PAYMENT_MODE_LABELS[oldTransaction.paymentMode]} to ${PAYMENT_MODE_LABELS[newFields.paymentMode]}.`,
    );
  }

  // Only log the cash/online split when paymentMode stayed 'both' on both sides.
  if (
    !paymentModeChanged &&
    oldTransaction.paymentMode === 'both' &&
    newFields.paymentMode === 'both' &&
    (oldTransaction.cashAmount !== newFields.cashAmount ||
      oldTransaction.onlineAmount !== newFields.onlineAmount)
  ) {
    descriptions.push(
      `Cash/Online split changed from ₹${formatRupees(oldTransaction.cashAmount)} cash / ₹${formatRupees(oldTransaction.onlineAmount)} online to ₹${formatRupees(newFields.cashAmount)} cash / ₹${formatRupees(newFields.onlineAmount)} online.`,
    );
  }

  // Notes/Receipt — presence-based copy, not full before/after text (avoids
  // dumping arbitrarily long free text, or a meaningless uri, into the log).
  if (oldTransaction.notes !== newFields.notes) {
    if (!oldTransaction.notes && newFields.notes) {
      descriptions.push('Notes added.');
    } else if (oldTransaction.notes && !newFields.notes) {
      descriptions.push('Notes removed.');
    } else {
      descriptions.push('Notes updated.');
    }
  }

  // The receipt is compared on `receiptPublicId` — the Cloudinary reference
  // the server stores — and never on a local device URI, which is not a
  // receipt reference at all (§4.1). Presence-based copy as before: the id is
  // safe to log on its own but says nothing a user would read.
  //
  // Only the "removed" branch is reachable today, because the app can clear a
  // receipt but cannot upload one (no signing endpoint — see
  // transactionsApi.js's TODO). The other two are kept rather than deleted:
  // they are correct, they cost nothing, and the pass that adds upload should
  // not also have to re-derive this copy.
  if (oldTransaction.receiptPublicId !== newFields.receiptPublicId) {
    if (!oldTransaction.receiptPublicId && newFields.receiptPublicId) {
      descriptions.push('Receipt photo added.');
    } else if (oldTransaction.receiptPublicId && !newFields.receiptPublicId) {
      descriptions.push('Receipt photo removed.');
    } else {
      descriptions.push('Receipt photo replaced.');
    }
  }

  // `activityDate`/`activityTime` are §11.1's own field names — the shape
  // `ActivityLogItem` renders. These are the device's clock, not the server's,
  // which is the one place a local entry and a server entry legitimately
  // differ (a server row's time is UTC at the instant the fan-out ran —
  // `backend/README.md` §17.8 flag 3).
  const activityDate = getTodayIsoDate();
  const activityTime = getCurrentTimeString();
  const batchTimestamp = Date.now();

  // Id collision guard (ADR 0008 §2.1) — Date.now() alone isn't guaranteed
  // unique across every entry minted within the same synchronous Save call.
  return descriptions.map((descriptionPrefix, index) => ({
    id: `activity-${batchTimestamp}-${index}`,
    type: 'transaction_edited',
    activityDate,
    activityTime,
    descriptionPrefix,
    entityName: null,
    descriptionSuffix: '',
    relatedTransactionId: transactionId,
    relatedGroupId: null,
    relatedContactId: null,
    relatedSplitExpenseId: null,
    iconName: 'create-outline',
    glyph: '✎',
    tone: 'neutral',
  }));
}
