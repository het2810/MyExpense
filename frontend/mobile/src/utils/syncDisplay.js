/**
 * User-facing copy for offline/sync state —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.8/§8.9/§9.
 * Pure, so the exact wording is testable and lives in one place.
 */

/** Prefix for an estimated amount (§8.8). */
export const ESTIMATE_PREFIX = '≈ ';

/**
 * @param {number} count
 * @returns {string} e.g. "1 change", "3 changes"
 */
export function pluralizeChanges(count) {
  return `${count} change${count === 1 ? '' : 's'}`;
}

/**
 * "Estimated · {n} change(s) waiting to sync" (§8.8). With nothing waiting
 * (the ops were sent but the pull has not landed yet) the count is omitted.
 *
 * @param {number} pendingOpCount
 * @returns {string}
 */
export function describeEstimate(pendingOpCount) {
  if (!pendingOpCount) {
    return 'Estimated · syncing';
  }
  return `Estimated · ${pluralizeChanges(pendingOpCount)} waiting to sync`;
}

/**
 * Applies the estimate label to a `getBalanceTrailing` result for a row the
 * overlay marked `isEstimate`. Rows without the flag pass through unchanged.
 *
 * @param {{ trailingText: string, trailingSubtext?: string, trailingTone: string }} trailing
 * @param {{ isEstimate?: boolean, pendingOpCount?: number }} row
 * @returns {{ trailingText: string, trailingSubtext?: string, trailingTone: string }}
 */
export function labelEstimatedTrailing(trailing, row) {
  if (!row?.isEstimate) {
    return trailing;
  }
  return {
    ...trailing,
    trailingText: `${ESTIMATE_PREFIX}${trailing.trailingText}`,
    trailingSubtext: describeEstimate(row.pendingOpCount ?? 0),
  };
}

/**
 * Offline banner copy (§8.9).
 *
 * @param {{ kind: 'offline' | 'syncing' | 'failed' | 'hidden', waitingCount: number,
 *   failedCount: number, isLarge: boolean }} banner
 * @returns {{ message: string, actionLabel: string | null } | null}
 */
export function describeBanner(banner) {
  switch (banner.kind) {
    case 'offline': {
      let message =
        "You're offline. Changes are saved on this device and will sync when you reconnect.";
      if (banner.waitingCount > 0) {
        message += ` ${banner.waitingCount} waiting.`;
      }
      if (banner.isLarge) {
        message += ' Connect to the internet to sync.';
      }
      return { message, actionLabel: null };
    }
    case 'syncing':
      return { message: `Syncing ${pluralizeChanges(banner.waitingCount)}…`, actionLabel: null };
    case 'failed':
      return {
        message: `${pluralizeChanges(banner.failedCount)} couldn't sync.`,
        actionLabel: 'Review',
      };
    default:
      return null;
  }
}

/**
 * Row chip copy (§8.8).
 *
 * @param {'pending' | 'failed' | 'blocked' | null | undefined} localSyncStatus
 * @returns {string | null}
 */
export function describeLocalSyncStatus(localSyncStatus) {
  if (localSyncStatus === 'pending') {
    return 'Waiting to sync';
  }
  if (localSyncStatus === 'failed' || localSyncStatus === 'blocked') {
    return "Couldn't sync";
  }
  return null;
}

const OP_TYPE_LABELS = {
  'transaction.create': 'Add expense',
  'transaction.update': 'Edit expense',
  'transaction.delete': 'Delete expense',
  'category.create': 'Add category',
  'category.update': 'Edit category',
  'category.delete': 'Delete category',
  'budget.save': 'Save budget',
  'contact.create': 'Add contact',
  'group.create': 'Create group',
  'group.addMember': 'Add group member',
  'split.create': 'Split expense',
  'split.update': 'Edit split expense',
  'split.delete': 'Delete split expense',
  'settlement.create': 'Settle up',
  'settings.update': 'Change settings',
  'notification.markRead': 'Mark notification read',
  'notification.markAllRead': 'Mark all notifications read',
};

/**
 * "Add expense · Lunch"
 *
 * @param {{ type: string, preview?: { label?: string | null } }} op
 * @returns {string}
 */
export function describeOp(op) {
  const action = OP_TYPE_LABELS[op.type] ?? 'Change';
  const label = op.preview?.label ?? op.label;
  return label ? `${action} · ${label}` : action;
}

/**
 * Sync Status's per-notice line.
 *
 * @param {{ kind: string, opType: string, label: string | null }} notice
 * @returns {string}
 */
export function describeNotice(notice) {
  const subject = describeOp({ type: notice.opType, label: notice.label });
  if (notice.kind === 'superseded') {
    return `${subject}: a newer change was kept instead of this one.`;
  }
  if (notice.kind === 'discarded') {
    return `${subject}: discarded from this device.`;
  }
  return `${subject}: couldn't be synced.`;
}

/**
 * Profile's sign-out warning (§8.9).
 *
 * @param {number} unsyncedCount
 * @returns {string}
 */
export function describeUnsyncedSignOut(unsyncedCount) {
  const verb = unsyncedCount === 1 ? "hasn't" : "haven't";
  const pronoun = unsyncedCount === 1 ? 'it' : 'they';
  return `${pluralizeChanges(unsyncedCount)} ${verb} synced yet. If you sign out now ${pronoun} will be deleted from this device.`;
}
