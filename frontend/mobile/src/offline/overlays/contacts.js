import { toLocalSyncStatus } from './activeOps';

/**
 * Contacts overlay — ADR 0027 §8.8: a queued `contact.create` is added to the
 * list so pickers and search see it. Pure.
 *
 * @param {object[]} contacts Snapshot.
 * @param {object[]} ops Active ops affecting `contacts`, queue order.
 * @returns {object[]}
 */
export function overlayContacts(contacts, ops) {
  if (ops.length === 0) {
    return contacts;
  }
  const held = new Set(contacts.map((contact) => contact.id));
  const added = ops
    .filter((op) => op.type === 'contact.create' && op.preview?.contact && !held.has(op.entityId))
    .map((op) => ({
      ...op.preview.contact,
      initials: op.preview.contact.initials ?? null,
      linkedUserId: null,
      localSyncStatus: toLocalSyncStatus(op),
    }))
    .reverse();
  return added.length === 0 ? contacts : [...added, ...contacts];
}
