import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useDeviceContactsStore } from '../store/useDeviceContactsStore';
import { openAppSettings } from '../device/deviceContacts';

/**
 * The device address book for a contact picker, and the load trigger for it.
 *
 * While `enabled` (the picker is on screen), access is requested — the system
 * prompt appears the first time — and the address book is read once granted.
 * While the picker stays open, returning to the app re-checks access, so
 * allowing it in Settings takes effect without reopening anything.
 *
 * @param {boolean} enabled
 * @returns {{
 *   status: 'idle' | 'requesting' | 'denied' | 'blocked' | 'loading' | 'ready' | 'error',
 *   contacts: object[],
 *   requestAccess: () => void,
 *   reload: () => void,
 *   openSettings: () => void,
 * }}
 */
export function useDeviceContacts(enabled) {
  const status = useDeviceContactsStore((state) => state.status);
  const contacts = useDeviceContactsStore((state) => state.contacts);
  const requestAccess = useDeviceContactsStore((state) => state.requestAccess);
  const recheckAccess = useDeviceContactsStore((state) => state.recheckAccess);
  const loadContacts = useDeviceContactsStore((state) => state.loadContacts);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    requestAccess();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        recheckAccess();
      }
    });
    return () => subscription.remove();
  }, [enabled, requestAccess, recheckAccess]);

  const reload = useCallback(() => {
    loadContacts({ force: true });
  }, [loadContacts]);

  const openSettings = useCallback(() => {
    openAppSettings().catch(() => {});
  }, []);

  return { status, contacts, requestAccess, reload, openSettings };
}
