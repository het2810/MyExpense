import { useCallback, useMemo, useState } from 'react';
import { getContactAddRejection, getContactSelectionKey } from '../utils/contactSelection';

/**
 * The selected counterparts of an Individual split, in selection order —
 * docs/decisions/0026-multi-contact-individual-splits.md §8.1.
 *
 * Owned by Split Add Expense (which builds participants and the request from
 * it) and rendered by `components/SplitContactField.jsx`. The add rules live in
 * `utils/contactSelection.js`.
 *
 * @returns {{
 *   selectedContacts: object[],
 *   selectionKey: string,
 *   addContact: (contact: object) => { added: boolean, error: string | null },
 *   removeContact: (contactId: string) => void,
 * }}
 */
export function useSplitContactSelection() {
  const [selectedContacts, setSelectedContacts] = useState([]);

  const addContact = useCallback(
    (contact) => {
      const rejection = getContactAddRejection(contact, selectedContacts);
      if (rejection) {
        return { added: false, error: rejection };
      }
      setSelectedContacts((prev) => [...prev, contact]);
      return { added: true, error: null };
    },
    [selectedContacts],
  );

  const removeContact = useCallback((contactId) => {
    setSelectedContacts((prev) => prev.filter((contact) => contact.id !== contactId));
  }, []);

  const selectionKey = useMemo(() => getContactSelectionKey(selectedContacts), [selectedContacts]);

  return { selectedContacts, selectionKey, addContact, removeContact };
}
