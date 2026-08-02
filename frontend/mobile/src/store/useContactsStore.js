import { create } from 'zustand';
import * as contactsApi from '../api/contactsApi';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { getInitialsFromName } from '../utils/initials';
import { bindStorePersistence } from '../offline/persistence';
import { buildContactCreateOp } from '../offline/operations/contacts';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import {
  CACHE_CONTRACT_STATE,
  OFFLINE_WRITES_ENABLED,
  enqueueWrite,
  keepsSnapshotOnFailure,
  nowIso,
  shouldFetch,
} from './offlineStoreSupport';

/**
 * The signed-in account's contacts — server-backed by `GET /api/v1/contacts`
 * and `POST /api/v1/contacts` (docs/api/api-overview.md §6.1/§6.2).
 *
 * **Replaces the nine seeded mock contacts** this store held since
 * docs/decisions/0006-contact-group-search-and-split-tag.md §2. Nothing is
 * seeded any more and no id is invented: a contact id is a server UUID, which
 * is what `POST /split-expenses` resolves a pair from (§9.1's
 * `individualCounterpartContactId`) and what `POST /groups` names members with
 * (§7.2's `memberContactIds`).
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1).
 * Every call goes through `contactsApi`, i.e. through
 * `apiClient.authorizedRequest`. The orchestration (guard -> request -> state)
 * lives here, never in a screen (constitution §8).
 *
 * ---
 * **SHAPE: `ContactResponse`, HELD VERBATIM.**
 *
 *   { id, name, initials, phone, email, linkedUserId, createdAt, updatedAt }
 *
 * The API's own field names, nothing renamed or reshaped (constitution
 * §15/§30), exactly as `useCategoriesStore` holds `CategoryResponse`. Two
 * differences from the old mock shape are worth naming because screens read
 * them: `initials` is now **server-derived** rather than hand-written, and the
 * single `phoneOrEmail` field is gone — §6.1 carries **separate** `phone` and
 * `email`, independently optional (ADR 0015 §2 split them deliberately, and
 * `phone` is the one with behaviour attached: it is what auto-links a contact to
 * a real account and what triggers an invite).
 *
 * `linkedUserId` is the field with the largest consequence and no UI: a linked
 * contact resolves to the **shared, canonical** pairwise balance row, so a
 * balance against them can move because *they* acted (ADR 0023 §1.3).
 *
 * **Order is the server's** and nothing re-sorts it. Search is a client-side
 * substring filter over the whole list, which is honest because §6.1 is not
 * paginated.
 *
 * ---
 * **CACHE-FIRST, AND THE CREATED CONTACT IS PREPENDED.**
 *
 * One `GET /contacts` per session unless something forces a reload — the same
 * arrangement as `useCategoriesStore`, and it matters against a 120 req/min
 * per-user budget. A created contact is prepended so it is visible immediately
 * in the list the user is looking at, matching every other store's create
 * convention.
 *
 * ---
 * **RESET ON SIGN-OUT.** Registered with signOutReset.js like every other
 * per-account cache: these are one account's address-book entries, and because
 * the loader is cache-first a `GET /contacts` still in flight when Log Out is
 * tapped would otherwise write them back into a store that had just been
 * cleared.
 */

const INITIAL_STATE = {
  /** @type {object[]} `ContactResponse[]` in the server's order. */
  contacts: [],
  /** The list read is in flight. */
  isLoading: false,
  /** True once a list read has succeeded. */
  hasLoaded: false,
  /** User-facing copy for a failed list read (constitution §22), or null. */
  loadError: null,
  /** A `POST /contacts` is in flight. */
  isSaving: false,
  ...CACHE_CONTRACT_STATE,
};

/**
 * The minimum one contact needs to be keyed, searched and sent back as an id.
 *
 * `phone`/`email`/`linkedUserId` are **not** required — all three are
 * legitimately null (§6.1) — and `initials` is not either, because it is a
 * display value with a safe derivation while `id` and `name` are not.
 *
 * `httpClient` already normalizes unparseable JSON, but an empty `200` body
 * resolves to `null` (ADR 0016 §3.1) and a proxy can hand back something else
 * entirely; neither may reach a `.toLowerCase()` in a search filter.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isContactEntry(entry) {
  return (
    Boolean(entry) &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.name === 'string'
  );
}

/**
 * Fills the present-but-null keys every consumer reads, so no row renderer has
 * to defend against their absence. Nothing is renamed and nothing is re-sorted.
 *
 * `initials` falls back to the same first-plus-last-word rule the server uses
 * (`utils/initials.js`), so a response that omitted it still renders a badge
 * rather than an empty circle.
 *
 * @param {object} contact
 * @returns {object}
 */
function normalizeContact(contact) {
  return {
    ...contact,
    initials: contact.initials || getInitialsFromName(contact.name),
    phone: contact.phone ?? null,
    email: contact.email ?? null,
    linkedUserId: contact.linkedUserId ?? null,
  };
}

/**
 * True when the session changed while the request was in flight, meaning its
 * answer belongs to an account that is no longer signed in and must be
 * discarded rather than written into state (see signOutReset.js — the same
 * guard every other per-account store applies).
 *
 * Returning without clearing the in-flight flag is deliberate and safe: the
 * sign-out reset has already restored INITIAL_STATE, flags included.
 *
 * @param {number} epochAtStart
 * @returns {boolean}
 */
function hasSessionChanged(epochAtStart) {
  return getSessionEpoch() !== epochAtStart;
}

export const useContactsStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads `GET /contacts` (§6.1). Cache-first: a second call is a no-op once a
   * read has succeeded, so Split Add Expense's contact picker and New Group's
   * member list share one request per session. `{ force: true }` is the
   * explicit retry.
   *
   * Triggered by `useContacts()` at the point of use — never eagerly at app
   * start, which would put a network call in front of the splash gate for a
   * screen nobody has opened (the same arrangement as `useCategories`).
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadContacts: async ({ force = false } = {}) => {
    const state = get();
    if (state.isLoading) {
      return;
    }
    if (!shouldFetch(state, force)) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    const fetchStartedAt = nowIso();
    set({ isLoading: true, loadError: null });

    try {
      const response = await contactsApi.listContacts();
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (!Array.isArray(response) || !response.every(isContactEntry)) {
        throw new Error('The contacts response did not match the contract.');
      }
      set({
        contacts: response.map(normalizeContact),
        isLoading: false,
        hasLoaded: true,
        loadError: null,
        fetchStartedAt,
        isFromCache: false,
      });
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (keepsSnapshotOnFailure(get(), error)) {
        set({ isLoading: false });
        return;
      }
      // `hasLoaded` stays false, so a save that needs this list refuses
      // rather than treating it as empty — which would create a second
      // contact for somebody the account already has, and then split with the
      // wrong one of the two (`useDeviceContactResolver`).
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * `POST /contacts` (§6.2) — called by `useDeviceContactResolver` at save
   * time, for a picked device number no existing contact has.
   *
   * **Returns its outcome rather than storing an error**, like
   * `useTransactionsStore.createTransaction`: a failed save belongs to the form
   * the user is looking at, and a message left in global state would reappear
   * the next time any form opened. `isSaving` is state, because the Save button
   * reads it.
   *
   * `inviteStatus` is returned **raw** for the caller to put through
   * `utils/contactInviteStatus.js`. It is not an error and never blocks: the
   * contact is created whether or not an invite was applicable, queued or
   * refused (`backend/README.md` §15.2). And it does **not** mean a message was
   * delivered — see that module.
   *
   * Empty strings are sent as `null`: §6.2 treats an empty `phone` as absent
   * anyway, and a request that says what it means is easier to read in a log.
   *
   * @param {{ name: string, phone?: string | null, email?: string | null }} values
   * @returns {Promise<{ success: boolean, contact: object | null,
   *   inviteStatus: string | null, error: string | null }>}
   */
  createContact: async ({ name, phone = null, email = null }) => {
    if (get().isSaving) {
      return { success: false, contact: null, inviteStatus: null, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      // ADR 0027 §8.8. The invite (if any) fires server-side at replay, so
      // there is no `inviteStatus` to report yet.
      const op = buildContactCreateOp({ name, phone: phone || null, email: email || null });
      const result = await enqueueWrite(op);
      const contact = result.success ? normalizeContact(op.preview.contact) : null;
      return { ...result, contact, inviteStatus: null, id: op.entityId, pending: true };
    }

    const epochAtStart = getSessionEpoch();
    set({ isSaving: true });

    try {
      const created = await contactsApi.createContact({
        name,
        phone: phone || null,
        email: email || null,
      });
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, contact: null, inviteStatus: null, error: null };
      }
      if (!isContactEntry(created)) {
        throw new Error('The create-contact response did not match the contract.');
      }
      const contact = normalizeContact(created);
      set((current) => ({
        contacts: [contact, ...current.contacts],
        isSaving: false,
      }));
      return {
        success: true,
        contact,
        inviteStatus: created.inviteStatus ?? null,
        error: null,
      };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, contact: null, inviteStatus: null, error: null };
      }
      set({ isSaving: false });
      return {
        success: false,
        contact: null,
        inviteStatus: null,
        error: isSessionTerminalError(error) ? null : getErrorMessage(error),
      };
    }
  },

  /**
   * ADR 0027 §8.8 — shows the cached contacts at once; the next load re-reads.
   *
   * @param {{ contacts: object[] }} data
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    if (!Array.isArray(data?.contacts) || !data.contacts.every(isContactEntry)) {
      return;
    }
    set({
      contacts: data.contacts.map(normalizeContact),
      hasLoaded: true,
      isFromCache: true,
      fetchStartedAt,
      loadError: null,
    });
  },

  /** Drops this account's contacts — see signOutReset.js. */
  resetContacts: () => set({ ...INITIAL_STATE }),
}));

registerSignOutReset(() => {
  useContactsStore.getState().resetContacts();
});

bindStorePersistence(useContactsStore, {
  storeKey: 'contacts',
  watch: (state) => [state.contacts],
  select: (state) => ({ contacts: state.contacts }),
  pull: () => useContactsStore.getState().loadContacts({ force: true }),
  pullOrder: 6,
});
