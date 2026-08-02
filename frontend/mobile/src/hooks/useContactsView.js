import { useMemo } from 'react';
import { useContactsStore } from '../store/useContactsStore';
import { overlayContacts } from '../offline/overlays/contacts';
import { useActiveOps } from './useActiveOps';

/**
 * Contacts with queued creates added, so pickers and search see them
 * (ADR 0027 §8.8).
 *
 * @returns {object[]}
 */
export function useContactsView() {
  const contacts = useContactsStore((state) => state.contacts);
  const fetchStartedAt = useContactsStore((state) => state.fetchStartedAt);
  const ops = useActiveOps('contacts', fetchStartedAt);
  return useMemo(() => overlayContacts(contacts, ops), [contacts, ops]);
}
