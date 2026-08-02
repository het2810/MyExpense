import { USER_PATHS } from '../../api/config';
import { buildOp } from './buildOp';

/**
 * `settings.update` — `PATCH /users/me/settings` under LWW (ADR 0027 §5).
 * For `user_settings` the entity id is the user's own id (§6.2).
 *
 * @param {{ userId: string, changes: object }} input
 * @returns {object} op
 */
export function buildSettingsUpdateOp({ userId, changes }) {
  return buildOp({
    type: 'settings.update',
    entityType: 'user_settings',
    entityId: userId,
    method: 'PATCH',
    path: USER_PATHS.settings,
    body: changes,
    affects: ['settings'],
    preview: { label: 'your settings', patch: changes },
  });
}
