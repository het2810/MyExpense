import { formatDateTimeLabel } from './dateDisplay';

/**
 * Renders one `ChangeLogEntryResponse` (api-overview.md §15.6) as copy —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §6.6.
 * Pure. Field names are the API's (§6.3).
 */

const FIELD_LABELS = {
  title: 'Title',
  amount: 'Amount',
  type: 'Type',
  categoryId: 'Category',
  categoryName: 'Category',
  parentCategoryName: 'Parent category',
  txnDate: 'Date',
  txnTime: 'Time',
  scope: 'Scope',
  groupId: 'Group',
  paymentMode: 'Payment mode',
  cashAmount: 'Cash',
  onlineAmount: 'Online',
  notes: 'Notes',
  receiptPublicId: 'Receipt',
  splitExpenseId: 'Split',
  deletedAt: 'Deleted',
  name: 'Name',
  monthlyCap: 'Monthly cap',
  periodType: 'Period type',
  startDate: 'Start date',
  endDate: 'End date',
  overspendingAlertsEnabled: 'Overspending alerts',
  paymentModeEnabled: 'Payment mode tracking',
  subcategoriesEnabled: 'Subcategories',
};

/** Ids are not meaningful to a person; the name fields beside them are. */
const HIDDEN_FIELDS = new Set(['categoryId', 'groupId', 'splitExpenseId', 'parentCategoryId']);
const MONEY_FIELDS = new Set(['amount', 'cashAmount', 'onlineAmount', 'monthlyCap']);
const ONE_MINUTE_MS = 60 * 1000;

/**
 * @param {string} field
 * @param {unknown} value
 * @param {string} currencySymbol
 * @returns {string}
 */
export function formatChangeValue(field, value, currencySymbol) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (MONEY_FIELDS.has(field) && Number.isFinite(Number(value))) {
    return `${currencySymbol}${Number(value).toLocaleString('en-IN')}`;
  }
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }
  if (typeof value === 'object') {
    return Array.isArray(value) ? `${value.length} item(s)` : 'Updated';
  }
  return String(value);
}

/**
 * "Amount ₹250 → ₹300" per visible change. A queued (pending) entry has no
 * `before`, so only the attempted value is shown.
 *
 * @param {object} entry
 * @param {string} currencySymbol
 * @returns {string[]}
 */
export function describeChangeLines(entry, currencySymbol) {
  return (entry.changes || [])
    .filter((change) => !HIDDEN_FIELDS.has(change.field))
    .map((change) => {
      const label = FIELD_LABELS[change.field] ?? change.field;
      const after = formatChangeValue(change.field, change.after, currencySymbol);
      if (entry.localSyncStatus || entry.operation === 'create') {
        return `${label}: ${after}`;
      }
      const before = formatChangeValue(change.field, change.before, currencySymbol);
      return `${label} ${before} → ${after}`;
    });
}

/**
 * @param {object} entry
 * @returns {string}
 */
export function describeChangeHeadline(entry) {
  if (entry.localSyncStatus) {
    return entry.localSyncStatus === 'pending' ? 'Waiting to sync' : "Couldn't sync";
  }
  if (entry.outcome === 'superseded') {
    return entry.supersededReason === 'deleted'
      ? 'Not applied — it had been deleted'
      : 'Not applied — a newer change was kept';
  }
  if (entry.operation === 'create') {
    return 'Created';
  }
  if (entry.operation === 'delete') {
    return 'Deleted';
  }
  return 'Edited';
}

/**
 * "made offline 10:03, synced 11:20" when the device time and the server
 * receipt time differ by more than a minute (§6.6); otherwise the one time.
 * "on another device" when the entry's device is not this one.
 *
 * @param {object} entry
 * @param {string | null} thisDeviceId
 * @returns {string}
 */
export function describeChangeTiming(entry, thisDeviceId) {
  const madeAt = entry.clientUpdatedAt ?? entry.createdAt;
  const parts = [];
  if (entry.clientUpdatedAt && entry.createdAt) {
    const gap = Math.abs(Date.parse(entry.createdAt) - Date.parse(entry.clientUpdatedAt));
    if (gap > ONE_MINUTE_MS) {
      parts.push(
        `made offline ${formatDateTimeLabel(entry.clientUpdatedAt)}, synced ${formatDateTimeLabel(
          entry.createdAt,
        )}`,
      );
    } else {
      parts.push(formatDateTimeLabel(entry.createdAt));
    }
  } else if (madeAt) {
    parts.push(formatDateTimeLabel(madeAt));
  }
  if (entry.deviceId && thisDeviceId && entry.deviceId !== thisDeviceId) {
    parts.push('on another device');
  }
  return parts.join(' · ');
}
