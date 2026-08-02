import { CONTACT_PATHS } from '../../api/config';
import { buildOp } from './buildOp';
import { newId } from '../ids';

/**
 * `contact.create` — `POST /contacts` with a client id (ADR 0027 §3.2). The
 * invite an unmatched phone triggers fires server-side at replay.
 *
 * @param {{ name: string, phone?: string | null, email?: string | null }} values
 * @returns {object} op
 */
export function buildContactCreateOp({ name, phone = null, email = null }) {
  const id = newId();
  const body = { id, name, phone, email };
  return buildOp({
    type: 'contact.create',
    entityType: 'contact',
    entityId: id,
    method: 'POST',
    path: CONTACT_PATHS.create,
    body,
    affects: ['contacts'],
    preview: { label: name, contact: body },
  });
}
