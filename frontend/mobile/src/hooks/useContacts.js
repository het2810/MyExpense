import { useCallback, useEffect } from 'react';
import { useContactsStore } from '../store/useContactsStore';
import { useContactsView } from './useContactsView';

/**
 * The single entry point to the account's contacts — `GET`/`POST
 * /api/v1/contacts` (docs/api/api-overview.md §6.1/§6.2). Its consumer is
 * `useDeviceContactResolver`, which turns device-contact selections into
 * backend contact ids when a split or group is saved — the pickers themselves
 * list the device address book, not this list.
 *
 * **This hook is the load trigger**, the same arrangement as
 * `useCategories`/`useTransactions`/`useUserSettings`. The loader is cache-first,
 * so both surfaces share one `GET /contacts` per session unless `reload()` asks
 * for another.
 *
 * It owns no business logic of its own, deliberately: orchestration lives in
 * the store, so this is the thin seam that keeps screens out of `src/api/`
 * (ADR 0016 §1) and gives both consumers one shape to read.
 *
 * @returns {{
 *   contacts: object[],
 *   hasLoaded: boolean,
 *   isLoading: boolean,
 *   loadError: string | null,
 *   isSaving: boolean,
 *   createContact: (values: { name: string, phone?: string | null,
 *     email?: string | null }) => Promise<object>,
 *   reload: () => void,
 * }}
 */
export function useContacts() {
  // Snapshot + queued creates (ADR 0027 §8.8).
  const contacts = useContactsView();
  const hasLoaded = useContactsStore((state) => state.hasLoaded);
  const isLoading = useContactsStore((state) => state.isLoading);
  const loadError = useContactsStore((state) => state.loadError);
  const isSaving = useContactsStore((state) => state.isSaving);
  const loadContacts = useContactsStore((state) => state.loadContacts);
  const createContact = useContactsStore((state) => state.createContact);

  useEffect(() => {
    // A no-op once a read has succeeded; after a failure `hasLoaded` is still
    // false, so re-entering the screen retries. Same effect, same reasoning as
    // `useCategories`'.
    loadContacts();
  }, [loadContacts]);

  const reload = useCallback(() => {
    loadContacts({ force: true });
  }, [loadContacts]);

  return {
    contacts,
    hasLoaded,
    isLoading,
    loadError,
    isSaving,
    createContact,
    reload,
  };
}
