import { NOTIFICATION_PATHS } from '../../api/config';
import { buildOp } from './buildOp';

/**
 * Notification read flags — queued but neither logged nor de-duplicated
 * server-side; both endpoints are naturally idempotent (ADR 0027 §4.2).
 */

/**
 * @param {string} notificationId
 * @returns {object} op
 */
export function buildNotificationMarkReadOp(notificationId) {
  return buildOp({
    type: 'notification.markRead',
    entityType: 'notification',
    entityId: notificationId,
    method: 'PATCH',
    path: NOTIFICATION_PATHS.markRead(notificationId),
    affects: ['notifications'],
    preview: { label: 'a notification' },
  });
}

/**
 * @param {string} userId Used as the entity id so repeated read-alls order after each other.
 * @returns {object} op
 */
export function buildNotificationMarkAllReadOp(userId) {
  return buildOp({
    type: 'notification.markAllRead',
    entityType: 'notification',
    entityId: `read-all:${userId}`,
    method: 'PATCH',
    path: NOTIFICATION_PATHS.markAllRead,
    affects: ['notifications'],
    preview: { label: 'your notifications' },
  });
}
