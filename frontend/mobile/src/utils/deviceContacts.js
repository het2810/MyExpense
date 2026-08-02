import { getInitialsFromName } from './initials';
import { digitsOf, toE164 } from './phoneNumbers';

/**
 * Pure rules for the device address book — shaping what `react-native-contacts`
 * returns, searching it, and turning a picked number into a selection.
 *
 * **Device contacts are third-party PII** (docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §1): they are read for display and
 * selection only, held in memory, never logged, never persisted and never sent
 * anywhere. The one exception is a number the user actually picks and then
 * saves a split or group with — that becomes a backend contact at save time
 * (`hooks/useDeviceContactResolver.js`), never at selection time.
 */

/** Prefix of a selection's local id, so it can never collide with a server UUID. */
const DEVICE_SELECTION_PREFIX = 'device:';

/**
 * @param {object} raw A `react-native-contacts` `Contact`.
 * @returns {string}
 */
function displayNameOf(raw) {
  if (typeof raw.displayName === 'string' && raw.displayName.trim()) {
    return raw.displayName.trim();
  }
  const parts = [raw.givenName, raw.middleName, raw.familyName]
    .filter((part) => typeof part === 'string' && part.trim())
    .map((part) => part.trim());
  if (parts.length > 0) {
    return parts.join(' ');
  }
  return typeof raw.company === 'string' ? raw.company.trim() : '';
}

/**
 * One device contact in the shape the pickers render.
 *
 * Numbers are normalized to E.164 and **de-duplicated per contact**: the same
 * number stored twice (`98765 43210` as Mobile and `+919876543210` as Home) is
 * one entry. Numbers that cannot be normalized are dropped from `phones` and
 * counted in `unusablePhoneCount`, so the row can say why it is not selectable.
 *
 * @param {object} raw A `react-native-contacts` `Contact`.
 * @returns {{ recordID: string, name: string, initials: string,
 *   thumbnailUri: string | null,
 *   phones: Array<{ e164: string, display: string, label: string }>,
 *   unusablePhoneCount: number } | null} null for an entry with neither a name
 *   nor a number — there is nothing to show for it.
 */
export function normalizeDeviceContact(raw) {
  if (!raw || typeof raw.recordID !== 'string') {
    return null;
  }

  const phones = [];
  const seen = new Set();
  let unusablePhoneCount = 0;
  (Array.isArray(raw.phoneNumbers) ? raw.phoneNumbers : []).forEach((entry) => {
    const display = typeof entry?.number === 'string' ? entry.number.trim() : '';
    if (!display) {
      return;
    }
    const e164 = toE164(display);
    if (!e164) {
      unusablePhoneCount += 1;
      return;
    }
    if (seen.has(e164)) {
      return;
    }
    seen.add(e164);
    phones.push({ e164, display, label: typeof entry.label === 'string' ? entry.label : '' });
  });

  const name = displayNameOf(raw) || phones[0]?.display || '';
  if (!name) {
    return null;
  }

  return {
    recordID: raw.recordID,
    name,
    initials: getInitialsFromName(name),
    thumbnailUri: raw.hasThumbnail && raw.thumbnailPath ? raw.thumbnailPath : null,
    phones,
    unusablePhoneCount,
  };
}

/**
 * @param {object[]} rawContacts
 * @returns {object[]} Normalized, sorted by name.
 */
export function normalizeDeviceContacts(rawContacts) {
  return (Array.isArray(rawContacts) ? rawContacts : [])
    .map(normalizeDeviceContact)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Live search by name (case-insensitive substring) or by phone number.
 *
 * A query made only of digits and phone punctuation (`+`, spaces, `-`, `()`)
 * also matches by number, digits against digits, so `98765`, `+91 98765` and
 * `098765` all find `+919876543210`.
 *
 * @param {object[]} contacts Normalized device contacts.
 * @param {string} query
 * @returns {object[]} Every contact when the trimmed query is empty.
 */
export function filterDeviceContacts(contacts, query) {
  const list = contacts ?? [];
  const trimmed = (query ?? '').trim();
  if (!trimmed) {
    return list;
  }
  const lowered = trimmed.toLowerCase();
  const isNumberQuery = /^[\d\s+\-()]+$/.test(trimmed);
  // A typed trunk '0' is not part of the stored E.164 digits.
  const queryDigits = digitsOf(trimmed).replace(/^0+/, '');

  return list.filter((contact) => {
    if (contact.name.toLowerCase().includes(lowered)) {
      return true;
    }
    if (!isNumberQuery || !queryDigits) {
      return false;
    }
    return contact.phones.some(
      (phone) => digitsOf(phone.e164).includes(queryDigits) || digitsOf(phone.display).includes(queryDigits),
    );
  });
}

/**
 * The local id of the selection for one number. Keyed by the number, not the
 * device record, so the same person stored twice on the device is still one
 * selection.
 *
 * @param {string} e164
 * @returns {string}
 */
export function getDeviceSelectionId(e164) {
  return `${DEVICE_SELECTION_PREFIX}${e164}`;
}

/**
 * @param {{ id?: string } | null | undefined} contact
 * @returns {boolean} whether this is a device selection still awaiting a
 *   backend contact id.
 */
export function isDeviceSelection(contact) {
  return typeof contact?.id === 'string' && contact.id.startsWith(DEVICE_SELECTION_PREFIX);
}

/**
 * Split participants with every device selection id swapped for its resolved
 * backend contact id. `participantId` is left alone on purpose: the split
 * configuration (amounts, payers) is keyed by it, and the request builder reads
 * the contact id only through `participantContactId`.
 *
 * @param {object[] | null} participants
 * @param {Map<string, string>} contactIdBySelectionId
 * @returns {object[] | null}
 */
export function withResolvedContactIds(participants, contactIdBySelectionId) {
  if (!Array.isArray(participants)) {
    return participants;
  }
  return participants.map((participant) =>
    contactIdBySelectionId.has(participant.participantContactId)
      ? { ...participant, participantContactId: contactIdBySelectionId.get(participant.participantContactId) }
      : participant,
  );
}

/**
 * A picked device number, in the contact shape the split and group forms
 * already consume (`id`, `name`, `initials`, `phone`, `linkedUserId`).
 *
 * `id` is local (`device:+91…`). It never reaches the server: the form swaps it
 * for a backend contact id at save time.
 *
 * @param {object} contact Normalized device contact.
 * @param {{ e164: string }} phone One of `contact.phones`.
 * @returns {object}
 */
export function toDeviceSelection(contact, phone) {
  return {
    id: getDeviceSelectionId(phone.e164),
    name: contact.name,
    initials: contact.initials,
    phone: phone.e164,
    thumbnailUri: contact.thumbnailUri,
    linkedUserId: null,
  };
}

/**
 * `contacts` without the numbers already selected; a contact whose every
 * number is selected disappears, so the picker never offers someone who is
 * already a chip. Contacts with no usable number are kept (they render as
 * unselectable, which is the honest answer to "where is X?").
 *
 * @param {object[]} contacts Normalized device contacts.
 * @param {Array<{ id: string }>} selections
 * @returns {object[]}
 */
export function excludeSelectedNumbers(contacts, selections) {
  const selectedIds = new Set((selections ?? []).map((selection) => selection.id));
  if (selectedIds.size === 0) {
    return contacts ?? [];
  }
  return (contacts ?? []).reduce((kept, contact) => {
    if (contact.phones.length === 0) {
      kept.push(contact);
      return kept;
    }
    const phones = contact.phones.filter((phone) => !selectedIds.has(getDeviceSelectionId(phone.e164)));
    if (phones.length > 0) {
      kept.push(phones.length === contact.phones.length ? contact : { ...contact, phones });
    }
    return kept;
  }, []);
}
