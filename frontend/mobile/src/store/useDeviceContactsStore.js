import { create } from 'zustand';
import {
  hasContactsPermission,
  readDeviceContacts,
  requestContactsPermission,
} from '../device/deviceContacts';
import { normalizeDeviceContacts } from '../utils/deviceContacts';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';

/**
 * The device address book, read for the contact pickers (Split Add Expense's
 * CONTACT field, New Group's member list).
 *
 * **In memory only, deliberately.** Device contacts are third-party PII
 * (docs/decisions/0006-contact-group-search-and-split-tag.md §1), so this store
 * is never bound to offline persistence, never synced and cleared on sign-out.
 * It is read once per session when a picker first opens; `reload()` re-reads.
 *
 * `status`:
 * - `'idle'` — nothing asked yet.
 * - `'requesting'` — the permission prompt may be on screen.
 * - `'denied'` — refused; asking again can show the prompt.
 * - `'blocked'` — refused for good; only Settings can change it.
 * - `'loading'` — granted, reading.
 * - `'ready'` — `contacts` holds the address book (possibly empty).
 * - `'error'` — granted, but the read failed.
 */

const INITIAL_STATE = {
  status: 'idle',
  /** @type {object[]} Normalized device contacts (`utils/deviceContacts.js`). */
  contacts: [],
};

const READ_ERROR_STATUS = 'error';

export const useDeviceContactsStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads the address book. A no-op while a read is running or once one has
   * succeeded, unless `force`.
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadContacts: async ({ force = false } = {}) => {
    const { status } = get();
    if (status === 'loading' || (status === 'ready' && !force)) {
      return;
    }
    const epochAtStart = getSessionEpoch();
    set({ status: 'loading' });
    try {
      const raw = await readDeviceContacts();
      if (getSessionEpoch() !== epochAtStart) {
        return;
      }
      set({ status: 'ready', contacts: normalizeDeviceContacts(raw) });
    } catch {
      // The native error is not shown (it can carry device details) and not
      // logged (it can carry contact data).
      if (getSessionEpoch() !== epochAtStart) {
        return;
      }
      set({ status: READ_ERROR_STATUS, contacts: [] });
    }
  },

  /**
   * The picker's entry point: asks for access (the system prompt appears only
   * when the OS still allows one), then reads. Already granted and read: a
   * no-op.
   *
   * @returns {Promise<void>}
   */
  requestAccess: async () => {
    const { status } = get();
    if (status === 'requesting' || status === 'loading' || status === 'ready') {
      return;
    }
    const epochAtStart = getSessionEpoch();
    set({ status: 'requesting' });
    let permission;
    try {
      permission = await requestContactsPermission();
    } catch {
      permission = null;
    }
    if (getSessionEpoch() !== epochAtStart) {
      return;
    }
    if (permission === 'granted') {
      set({ status: 'idle' });
      await get().loadContacts();
      return;
    }
    set({ status: permission ?? READ_ERROR_STATUS });
  },

  /**
   * Re-checks without prompting — called when the app returns to the
   * foreground, since the user may have just allowed access in Settings.
   *
   * @returns {Promise<void>}
   */
  recheckAccess: async () => {
    const { status } = get();
    if (status !== 'denied' && status !== 'blocked') {
      return;
    }
    let granted = false;
    try {
      granted = await hasContactsPermission();
    } catch {
      granted = false;
    }
    if (granted && get().status === status) {
      await get().loadContacts();
    }
  },

  /** Drops the address book — see signOutReset.js. */
  resetDeviceContacts: () => set({ ...INITIAL_STATE }),
}));

registerSignOutReset(() => {
  useDeviceContactsStore.getState().resetDeviceContacts();
});
