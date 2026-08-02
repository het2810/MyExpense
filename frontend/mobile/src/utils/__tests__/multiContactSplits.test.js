/**
 * Multi-contact Individual splits —
 * docs/decisions/0026-multi-contact-individual-splits.md §5, §8.
 * Pure-function coverage for the roster builder, the §9.1 request builder's
 * counterpart forms, the per-pair effect on Split Detail, the CONTACT field's
 * selection rules, and the "Paid by multiple people" config merge.
 */
import {
  buildIndividualParticipants,
  resolveSplitExpenseCounterparts,
  splitExpenseMovesPair,
  findPairEffect,
  describeOtherCounterparts,
} from '../splitParticipants';
import { buildSplitExpenseCreateRequest } from '../splitRequests';
import { applyPayerSelection } from '../splitCalculations';
import {
  MAX_SPLIT_COUNTERPARTS,
  getContactAddRejection,
  getContactSelectionKey,
} from '../contactSelection';
import { getErrorMessage } from '../../api/errorMessages';
import { ApiError } from '../../api/apiError';

const ME = 'user-het';
const RAJ_USER = 'user-raj';

const raj = { id: 'contact-raj', name: 'Raj', initials: 'R', linkedUserId: RAJ_USER };
const amit = { id: 'contact-amit', name: 'Amit', initials: 'A', linkedUserId: null };
const neha = { id: 'contact-neha', name: 'Neha', initials: 'N', linkedUserId: null };

const identityArgs = { currentUserId: ME, fullName: 'Het Shah', initials: 'HS' };

describe('buildIndividualParticipants (ADR 0026 §8.2)', () => {
  it('returns null when no contact is selected', () => {
    expect(buildIndividualParticipants({ ...identityArgs, contacts: [] })).toBeNull();
    expect(buildIndividualParticipants({ ...identityArgs, contacts: undefined })).toBeNull();
  });

  it('builds the same two-participant roster as before for one contact', () => {
    expect(buildIndividualParticipants({ ...identityArgs, contacts: [raj] })).toEqual([
      {
        participantId: 'self',
        participantUserId: ME,
        participantContactId: null,
        name: 'Het Shah',
        initials: 'HS',
      },
      {
        participantId: 'contact:contact-raj',
        participantUserId: null,
        participantContactId: 'contact-raj',
        name: 'Raj',
        initials: 'R',
      },
    ]);
  });

  it('puts self first, then every contact in selection order, named by contact id', () => {
    const roster = buildIndividualParticipants({ ...identityArgs, contacts: [amit, raj, neha] });
    expect(roster.map((participant) => participant.participantId)).toEqual([
      'self',
      'contact:contact-amit',
      'contact:contact-raj',
      'contact:contact-neha',
    ]);
    // A linked contact is still named by its contact id — normalisation is
    // the server's job (ADR 0023 §1.3).
    expect(roster[2].participantUserId).toBeNull();
    expect(roster[2].participantContactId).toBe('contact-raj');
  });
});

describe('buildSplitExpenseCreateRequest counterpart forms (ADR 0026 §8.4)', () => {
  const splitConfig = (contactIds) => ({
    method: 'equally',
    paidById: 'self',
    payers: null,
    participantAmounts: [
      { participantId: 'self', amount: 300 },
      ...contactIds.map((id) => ({ participantId: `contact:${id}`, amount: 300 })),
    ],
  });
  const valuesFor = (contacts) => ({
    title: 'Dinner',
    categoryId: null,
    splitDate: '2026-11-11',
    amount: 300 * (contacts.length + 1),
    splitMode: 'individual',
    groupId: null,
    splitConfig: splitConfig(contacts.map((contact) => contact.id)),
    participants: buildIndividualParticipants({ ...identityArgs, contacts }),
  });

  it('sends one contact in the legacy field, byte-identical to the pre-ADR-0026 body', () => {
    const body = buildSplitExpenseCreateRequest({
      ...valuesFor([raj]),
      individualCounterpartContactIds: [raj.id],
    });
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({
        title: 'Dinner',
        categoryId: null,
        splitDate: '2026-11-11',
        amount: 600,
        splitMode: 'individual',
        groupId: null,
        individualCounterpartContactId: 'contact-raj',
        splitMethod: 'equally',
        paidByUserId: ME,
        paidByContactId: null,
        participants: [
          { participantUserId: ME, participantContactId: null, amount: 300 },
          { participantUserId: null, participantContactId: 'contact-raj', amount: 300 },
        ],
        addToPersonalExpenses: false,
      }),
    );
  });

  it('gives the same body for a one-element array and the legacy single field', () => {
    const fromArray = buildSplitExpenseCreateRequest({
      ...valuesFor([raj]),
      individualCounterpartContactIds: [raj.id],
    });
    const fromLegacy = buildSplitExpenseCreateRequest({
      ...valuesFor([raj]),
      individualCounterpartContactId: raj.id,
    });
    expect(JSON.stringify(fromArray)).toBe(JSON.stringify(fromLegacy));
  });

  it('sends 2+ contacts as individualCounterpartContactIds in selection order, omitting the legacy field', () => {
    const body = buildSplitExpenseCreateRequest({
      ...valuesFor([amit, raj]),
      individualCounterpartContactIds: [amit.id, raj.id],
    });
    expect(body.individualCounterpartContactIds).toEqual(['contact-amit', 'contact-raj']);
    expect('individualCounterpartContactId' in body).toBe(false);
    // Same position the legacy field held: right after groupId.
    const keys = Object.keys(body);
    expect(keys[keys.indexOf('groupId') + 1]).toBe('individualCounterpartContactIds');
    expect(body.participants).toHaveLength(3);
  });

  it('sends the legacy field as null and no array in group mode', () => {
    const body = buildSplitExpenseCreateRequest({
      ...valuesFor([raj]),
      splitMode: 'group',
      groupId: 'group-1',
      individualCounterpartContactIds: [raj.id, amit.id],
    });
    expect(body.groupId).toBe('group-1');
    expect(body.individualCounterpartContactId).toBeNull();
    expect('individualCounterpartContactIds' in body).toBe(false);
  });
});

describe('saved split counterparts (ADR 0026 §5.2, §8.5)', () => {
  // ADR 0026 §4.4 example 2: Het creates "Dinner", ₹900 with Raj (linked) and
  // Amit (unregistered), equally; Raj paid all ₹900.
  const rajPaidAll = {
    splitMode: 'individual',
    amount: 900,
    individualBalanceId: 'bal-het-raj',
    counterparts: [
      {
        individualBalanceId: 'bal-het-raj',
        counterpartUserId: RAJ_USER,
        counterpartContactId: null,
        name: 'Raj',
        netAmount: 600,
      },
      {
        individualBalanceId: 'bal-het-amit',
        counterpartUserId: null,
        counterpartContactId: 'contact-amit',
        name: 'Amit',
        netAmount: -300,
      },
    ],
    payers: [{ payerUserId: RAJ_USER, payerContactId: null, name: 'Raj', amount: 900 }],
    participants: [
      { participantUserId: ME, participantContactId: null, name: 'Het Shah', amount: 300 },
      { participantUserId: RAJ_USER, participantContactId: null, name: 'Raj', amount: 300 },
      { participantUserId: null, participantContactId: 'contact-amit', name: 'Amit', amount: 300 },
    ],
  };

  it('reads the effect on each pair as −netAmount when the viewer is the creator', () => {
    // Het owes Raj ₹600; Amit owes Het ₹300.
    expect(findPairEffect(rajPaidAll, 'bal-het-raj', ME)).toBe(-600);
    expect(findPairEffect(rajPaidAll, 'bal-het-amit', ME)).toBe(300);
  });

  it('reads the effect on a pair as +netAmount when the viewer is that counterpart', () => {
    expect(findPairEffect(rajPaidAll, 'bal-het-raj', RAJ_USER)).toBe(600);
  });

  it('is not the total net of the creator, which would be −300 under both pairs', () => {
    const totalNet = 0 - 300; // paid − share for Het
    expect(findPairEffect(rajPaidAll, 'bal-het-raj', ME)).not.toBe(totalNet);
  });

  it('never returns -0 for a zero net', () => {
    const zero = {
      ...rajPaidAll,
      counterparts: [{ ...rajPaidAll.counterparts[0], netAmount: 0 }],
    };
    expect(Object.is(findPairEffect(zero, 'bal-het-raj', ME), 0)).toBe(true);
  });

  it('equals the pre-ADR paid − share for a one-contact split', () => {
    const oneContact = {
      splitMode: 'individual',
      amount: 600,
      individualBalanceId: 'bal-het-amit',
      counterparts: [
        {
          individualBalanceId: 'bal-het-amit',
          counterpartUserId: null,
          counterpartContactId: 'contact-amit',
          name: 'Amit',
          netAmount: -300,
        },
      ],
      payers: [{ payerUserId: ME, payerContactId: null, name: 'Het Shah', amount: 600 }],
      participants: [
        { participantUserId: ME, participantContactId: null, name: 'Het Shah', amount: 300 },
        { participantUserId: null, participantContactId: 'contact-amit', name: 'Amit', amount: 300 },
      ],
    };
    expect(findPairEffect(oneContact, 'bal-het-amit', ME)).toBe(600 - 300);
  });

  it('falls back to paid − share when the server predates counterparts[]', () => {
    const legacy = { ...rajPaidAll, counterparts: undefined };
    // Synthesised entry carries netAmount null, so the old formula applies.
    expect(resolveSplitExpenseCounterparts(legacy)).toEqual([
      {
        individualBalanceId: 'bal-het-raj',
        counterpartUserId: null,
        counterpartContactId: null,
        name: '',
        netAmount: null,
      },
    ]);
    expect(findPairEffect(legacy, 'bal-het-raj', ME)).toBe(0 - 300);
  });

  it('has no counterparts for a group split', () => {
    expect(
      resolveSplitExpenseCounterparts({ splitMode: 'group', groupId: 'g', counterparts: [] }),
    ).toEqual([]);
  });

  it('matches every pair the split moved, not only the primary', () => {
    expect(splitExpenseMovesPair(rajPaidAll, 'bal-het-raj')).toBe(true);
    expect(splitExpenseMovesPair(rajPaidAll, 'bal-het-amit')).toBe(true);
    expect(splitExpenseMovesPair(rajPaidAll, 'bal-other')).toBe(false);
    expect(splitExpenseMovesPair(rajPaidAll, null)).toBe(false);
  });

  it('names the other counterparts, excluding the pair counterpart and the viewer', () => {
    expect(describeOtherCounterparts(rajPaidAll, 'bal-het-raj', ME)).toBe('Also with Amit');
    expect(describeOtherCounterparts(rajPaidAll, 'bal-het-amit', ME)).toBe('Also with Raj');
    expect(describeOtherCounterparts(rajPaidAll, 'bal-het-raj', RAJ_USER)).toBe('Also with Amit');
  });

  it('shows no "Also with" line for a one-contact split', () => {
    const one = { ...rajPaidAll, counterparts: [rajPaidAll.counterparts[0]] };
    expect(describeOtherCounterparts(one, 'bal-het-raj', ME)).toBeNull();
  });
});

describe('CONTACT field selection rules (ADR 0026 §8.1)', () => {
  it('refuses a contact already selected', () => {
    expect(getContactAddRejection(raj, [raj])).toBe('Raj is already in this split.');
  });

  it('refuses a second contact linked to the same account', () => {
    const rajWork = { id: 'contact-raj-work', name: 'Raj (work)', linkedUserId: RAJ_USER };
    expect(getContactAddRejection(rajWork, [raj])).toBe('That person is already in this split.');
  });

  it('does not treat two unlinked contacts as the same person', () => {
    expect(getContactAddRejection(neha, [amit])).toBeNull();
  });

  it('caps the selection at 49 contacts', () => {
    const full = Array.from({ length: MAX_SPLIT_COUNTERPARTS }, (_, index) => ({
      id: `contact-${index}`,
      name: `Person ${index}`,
      linkedUserId: null,
    }));
    expect(MAX_SPLIT_COUNTERPARTS).toBe(49);
    expect(getContactAddRejection(neha, full)).toMatch(/up to 49/);
    expect(getContactAddRejection(neha, full.slice(1))).toBeNull();
  });

  it('keys the selection by joined ids in selection order', () => {
    expect(getContactSelectionKey([amit, raj])).toBe('contact-amit,contact-raj');
    expect(getContactSelectionKey([raj, amit])).not.toBe(getContactSelectionKey([amit, raj]));
    expect(getContactSelectionKey([])).toBe('');
  });
});

describe('applyPayerSelection ("Paid by multiple people")', () => {
  const config = {
    method: 'unequally',
    paidById: 'self',
    payers: null,
    participantAmounts: [
      { participantId: 'self', name: 'Het Shah', amount: 100 },
      { participantId: 'contact:contact-raj', name: 'Raj', amount: 500 },
    ],
  };

  it('replaces only the payer half, keeping method and shares', () => {
    const payers = [
      { participantId: 'self', amount: 200 },
      { participantId: 'contact:contact-raj', amount: 400 },
    ];
    expect(applyPayerSelection(config, { paidById: null, payers })).toEqual({
      ...config,
      paidById: null,
      payers,
    });
  });

  it('collapses to a single payer when the selection has one', () => {
    const result = applyPayerSelection(config, { paidById: 'contact:contact-raj', payers: null });
    expect(result.paidById).toBe('contact:contact-raj');
    expect(result.payers).toBeNull();
    expect(result.participantAmounts).toBe(config.participantAmounts);
  });
});

describe('counterpart error copy (ADR 0026 §5.1 C1/C4/C6)', () => {
  const validationError = (message) =>
    new ApiError({ status: 400, code: 'VALIDATION_ERROR', message });

  it('maps C6 to copy about a duplicate person', () => {
    expect(
      getErrorMessage(
        validationError('The same person is listed more than once in individualCounterpartContactIds.'),
      ),
    ).toMatch(/same person is in this split twice/);
  });

  it('keeps the generic validation copy for any other message', () => {
    expect(getErrorMessage(validationError('constructor'))).toBe(
      'Please check the highlighted fields.',
    );
  });
});
