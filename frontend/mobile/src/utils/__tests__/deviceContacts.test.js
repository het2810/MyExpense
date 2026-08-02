/**
 * Device-contact picking — phone normalization (+91 default, Project Owner
 * 2026-11-12), address-book shaping, search, selection and the save-time id
 * swap.
 */
import { toE164 } from '../phoneNumbers';
import {
  excludeSelectedNumbers,
  filterDeviceContacts,
  getDeviceSelectionId,
  isDeviceSelection,
  normalizeDeviceContact,
  normalizeDeviceContacts,
  toDeviceSelection,
  withResolvedContactIds,
} from '../deviceContacts';
import { getContactAddRejection } from '../contactSelection';

function raw(overrides) {
  return {
    recordID: 'r1',
    displayName: 'Raj Mehta',
    givenName: 'Raj',
    familyName: 'Mehta',
    phoneNumbers: [],
    hasThumbnail: false,
    thumbnailPath: '',
    ...overrides,
  };
}

describe('toE164', () => {
  it.each([
    ['+91 98765 43210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['098765 43210', '+919876543210'],
    ['0091 9876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['(+1) 415-555-0100', '+14155550100'],
  ])('%s -> %s', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each([[''], ['   '], ['123'], ['*121#'], [null], ['+0123456789']])(
    'rejects %p',
    (input) => {
      expect(toE164(input)).toBeNull();
    },
  );
});

describe('normalizeDeviceContact', () => {
  it('collapses the same number stored twice into one entry', () => {
    const contact = normalizeDeviceContact(
      raw({
        phoneNumbers: [
          { label: 'mobile', number: '98765 43210' },
          { label: 'home', number: '+919876543210' },
          { label: 'work', number: '022 2345 6789' },
        ],
      }),
    );
    expect(contact.phones.map((phone) => phone.e164)).toEqual(['+919876543210', '+912223456789']);
    expect(contact.phones[0]).toEqual({ e164: '+919876543210', display: '98765 43210', label: 'mobile' });
    expect(contact.initials).toBe('RM');
  });

  it('keeps a contact without numbers, unselectable, and counts unusable ones', () => {
    expect(normalizeDeviceContact(raw({})).phones).toEqual([]);
    const odd = normalizeDeviceContact(raw({ phoneNumbers: [{ label: 'x', number: '*121#' }] }));
    expect(odd.phones).toEqual([]);
    expect(odd.unusablePhoneCount).toBe(1);
  });

  it('falls back to name parts, then the number, and drops an empty entry', () => {
    expect(normalizeDeviceContact(raw({ displayName: null })).name).toBe('Raj Mehta');
    const numberOnly = normalizeDeviceContact(
      raw({ displayName: '', givenName: '', familyName: '', phoneNumbers: [{ label: '', number: '9876543210' }] }),
    );
    expect(numberOnly.name).toBe('9876543210');
    expect(normalizeDeviceContact(raw({ displayName: '', givenName: '', familyName: '' }))).toBeNull();
  });

  it('uses the photo only when the device has one', () => {
    expect(normalizeDeviceContact(raw({})).thumbnailUri).toBeNull();
    expect(
      normalizeDeviceContact(raw({ hasThumbnail: true, thumbnailPath: 'content://photo/1' })).thumbnailUri,
    ).toBe('content://photo/1');
  });

  it('sorts the address book by name', () => {
    const list = normalizeDeviceContacts([
      raw({ recordID: 'b', displayName: 'Zoya' }),
      raw({ recordID: 'a', displayName: 'Amit' }),
      null,
    ]);
    expect(list.map((contact) => contact.name)).toEqual(['Amit', 'Zoya']);
  });
});

describe('filterDeviceContacts', () => {
  const contacts = normalizeDeviceContacts([
    raw({ recordID: 'raj', displayName: 'Raj Mehta', phoneNumbers: [{ label: '', number: '98765 43210' }] }),
    raw({ recordID: 'amit', displayName: 'Amit 2', phoneNumbers: [{ label: '', number: '+91 91234 56789' }] }),
  ]);

  it('matches name substrings, case-insensitively', () => {
    expect(filterDeviceContacts(contacts, ' MEH ').map((c) => c.recordID)).toEqual(['raj']);
  });

  it('matches numbers in any typed format', () => {
    for (const query of ['98765', '+91 98765', '098765', '4321']) {
      expect(filterDeviceContacts(contacts, query).map((c) => c.recordID)).toEqual(['raj']);
    }
  });

  it('returns everything for an empty query', () => {
    expect(filterDeviceContacts(contacts, '  ')).toHaveLength(2);
  });

  it('matches digits in a name as name text only', () => {
    expect(filterDeviceContacts(contacts, 'Amit 2').map((c) => c.recordID)).toEqual(['amit']);
  });
});

describe('selection', () => {
  const contact = normalizeDeviceContact(
    raw({
      phoneNumbers: [
        { label: 'mobile', number: '9876543210' },
        { label: 'work', number: '9123456789' },
      ],
    }),
  );
  const [mobile, work] = contact.phones;

  it('keys a selection by number, so it is local and never a server id', () => {
    const selection = toDeviceSelection(contact, mobile);
    expect(selection).toEqual({
      id: 'device:+919876543210',
      name: 'Raj Mehta',
      initials: 'RM',
      phone: '+919876543210',
      thumbnailUri: null,
      linkedUserId: null,
    });
    expect(isDeviceSelection(selection)).toBe(true);
    expect(isDeviceSelection({ id: '8f1c-uuid' })).toBe(false);
  });

  it('refuses the same number twice, even from another device entry', () => {
    const duplicate = normalizeDeviceContact(
      raw({ recordID: 'r2', displayName: 'Raj (old)', phoneNumbers: [{ label: '', number: '+919876543210' }] }),
    );
    const first = toDeviceSelection(contact, mobile);
    expect(getContactAddRejection(toDeviceSelection(duplicate, duplicate.phones[0]), [first])).toBe(
      'Raj (old) is already in this split.',
    );
  });

  it('hides selected numbers, and the contact once all are selected', () => {
    const one = [toDeviceSelection(contact, mobile)];
    expect(excludeSelectedNumbers([contact], one)[0].phones).toEqual([work]);
    const both = [...one, toDeviceSelection(contact, work)];
    expect(excludeSelectedNumbers([contact], both)).toEqual([]);
  });

  it('swaps resolved contact ids into participants, keeping participantId', () => {
    const participants = [
      { participantId: 'self', participantUserId: 'me', participantContactId: null },
      { participantId: `contact:${getDeviceSelectionId('+919876543210')}`, participantContactId: 'device:+919876543210' },
    ];
    const resolved = withResolvedContactIds(participants, new Map([['device:+919876543210', 'uuid-raj']]));
    expect(resolved[0]).toBe(participants[0]);
    expect(resolved[1]).toEqual({
      participantId: 'contact:device:+919876543210',
      participantContactId: 'uuid-raj',
    });
  });
});
