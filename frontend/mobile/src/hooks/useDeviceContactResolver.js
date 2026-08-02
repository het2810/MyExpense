import { useCallback } from 'react';
import { useContacts } from './useContacts';
import { isDeviceSelection } from '../utils/deviceContacts';
import { toE164 } from '../utils/phoneNumbers';

const NOT_LOADED_ERROR =
  "Your saved contacts couldn't be loaded, so this can't be saved yet. Check your connection and try again.";
const CREATE_FAILED_ERROR = "Couldn't save this contact. Try again.";

/**
 * Turns device selections into backend contact ids **at save time** — ruled by
 * the Project Owner on 2026-11-12. Selecting a device contact persists nothing;
 * saving a split or group with one does, because `POST /split-expenses` and
 * `POST /groups` name people by contact id (docs/api/api-overview.md
 * §9.1/§7.2).
 *
 * For each device selection, by its E.164 number:
 * - an existing backend contact with the same number is **reused** (first in
 *   the server's order), so picking the same person again never creates a
 *   second contact and a second, separate balance with them;
 * - otherwise `POST /contacts { name, phone }` creates one. Offline, that
 *   create is queued with a client id and the split/group op waits for it
 *   (ADR 0027 §7.4).
 *
 * Note: `POST /contacts` with a number that matches no account records an
 * invite server-side (§6.2). That side effect is the backend's and is not
 * surfaced here — invitations are a later phase.
 *
 * A selection that is already a backend contact passes through unchanged.
 *
 * @returns {{
 *   resolveContactIds: (selections: object[]) => Promise<{ success: boolean,
 *     error: string | null, contactIdBySelectionId: Map<string, string> }>,
 * }}
 */
export function useDeviceContactResolver() {
  // Also the load trigger for the backend list the lookup runs against.
  const { contacts, hasLoaded, createContact, reload } = useContacts();

  const resolveContactIds = useCallback(
    async (selections) => {
      const contactIdBySelectionId = new Map();
      const deviceSelections = (selections ?? []).filter(isDeviceSelection);
      if (deviceSelections.length === 0) {
        return { success: true, error: null, contactIdBySelectionId };
      }
      if (!hasLoaded) {
        // Creating without the list could duplicate a contact the account
        // already has, splitting one person's balance in two.
        reload();
        return { success: false, error: NOT_LOADED_ERROR, contactIdBySelectionId };
      }

      const contactIdByPhone = new Map();
      contacts.forEach((contact) => {
        const phone = toE164(contact.phone);
        if (phone && !contactIdByPhone.has(phone)) {
          contactIdByPhone.set(phone, contact.id);
        }
      });

      for (const selection of deviceSelections) {
        let contactId = contactIdByPhone.get(selection.phone);
        if (!contactId) {
          // Sequential on purpose: the store refuses a second create while
          // one is in flight.
          const result = await createContact({ name: selection.name, phone: selection.phone });
          if (!result.success || !result.contact) {
            return {
              success: false,
              error: result.error ?? CREATE_FAILED_ERROR,
              contactIdBySelectionId,
            };
          }
          contactId = result.contact.id;
          contactIdByPhone.set(selection.phone, contactId);
        }
        contactIdBySelectionId.set(selection.id, contactId);
      }

      return { success: true, error: null, contactIdBySelectionId };
    },
    [contacts, hasLoaded, createContact, reload],
  );

  return { resolveContactIds };
}
