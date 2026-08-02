import { GROUP_PATHS } from '../../api/config';
import { buildOp } from './buildOp';
import { newId } from '../ids';

/**
 * `group.create` — `POST /groups` with a client id (ADR 0027 §3.2). Depends on
 * any pending contact create it names (`referencedIds`).
 *
 * `group.addMember` has no builder: no screen can add a member to an existing
 * group, and `GROUP_PATHS` deliberately has no members path (config.js). The
 * engine's classification already handles its `409 ALREADY_A_MEMBER` for when
 * the affordance lands.
 *
 * @param {{ name: string, memberContactIds?: string[], members?: object[] }} values
 *   `members`: display rows for the overlay (name, contact id).
 * @returns {object} op
 */
export function buildGroupCreateOp({ name, memberContactIds = [], members = [] }) {
  const id = newId();
  const body = { id, name, memberContactIds };
  return buildOp({
    type: 'group.create',
    entityType: 'group',
    entityId: id,
    method: 'POST',
    path: GROUP_PATHS.create,
    body,
    referencedIds: memberContactIds,
    affects: ['groups'],
    preview: { label: name, group: { id, name, members } },
  });
}
