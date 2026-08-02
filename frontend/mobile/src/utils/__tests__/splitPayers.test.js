/**
 * Multiple payers per split expense —
 * docs/decisions/0025-multiple-payers-per-split-expense.md §6.1, §8.1-§8.7.
 * Pure-function coverage for the label joiner, the saved-split payer readers,
 * "Who paid?" validation and the §9.1 request builder's payer forms.
 */
import {
  joinPayerLabels,
  describePayer,
  findCallerPaid,
  resolveSplitExpensePayers,
  labelDraftPayers,
} from '../splitParticipants';
import { validatePayerAmounts, toPayerSelection } from '../splitCalculations';
import { buildSplitExpenseCreateRequest } from '../splitRequests';

const ME = 'user-me';
const RAJ = 'user-raj';
const AMIT_CONTACT = 'contact-amit';

const roster = [
  { participantId: 'self', participantUserId: ME, participantContactId: null, name: 'Het Shah', initials: 'HS' },
  { participantId: `user:${RAJ}`, participantUserId: RAJ, participantContactId: null, name: 'Raj', initials: 'R' },
  {
    participantId: `contact:${AMIT_CONTACT}`,
    participantUserId: null,
    participantContactId: AMIT_CONTACT,
    name: 'Amit',
    initials: 'A',
  },
];

describe('joinPayerLabels (ADR 0025 §6.1)', () => {
  it('handles empty and single lists', () => {
    expect(joinPayerLabels([])).toBe('');
    expect(joinPayerLabels(undefined)).toBe('');
    expect(joinPayerLabels(['You'])).toBe('You');
  });

  it('joins two and three labels', () => {
    expect(joinPayerLabels(['You', 'Raj'])).toBe('You and Raj');
    expect(joinPayerLabels(['Het', 'Raj', 'Amit'])).toBe('Het, Raj and Amit');
  });

  it('collapses four or more into "N others"', () => {
    expect(joinPayerLabels(['Het', 'Raj', 'Amit', 'Priya'])).toBe('Het, Raj and 2 others');
    expect(joinPayerLabels(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 others');
  });
});

describe('saved split payer readers (ADR 0025 §8.7)', () => {
  const legacySplit = {
    amount: 1000,
    paidByUserId: RAJ,
    paidByContactId: null,
    paidByName: 'Raj',
    participants: [],
  };

  const multiSplit = {
    amount: 1000,
    paidByUserId: RAJ,
    paidByContactId: null,
    paidByName: 'Raj',
    payers: [
      { payerUserId: RAJ, payerContactId: null, name: 'Raj', amount: 700 },
      { payerUserId: ME, payerContactId: null, name: 'Het Shah', amount: 300 },
    ],
    participants: [],
  };

  it('synthesises one payer from paidBy* when payers[] is absent or empty', () => {
    expect(resolveSplitExpensePayers(legacySplit)).toEqual([
      { payerUserId: RAJ, payerContactId: null, name: 'Raj', amount: 1000 },
    ]);
    expect(resolveSplitExpensePayers({ ...legacySplit, payers: [] })).toHaveLength(1);
    expect(resolveSplitExpensePayers({ amount: 5, participants: [] })).toEqual([]);
  });

  it('describePayer keeps single-payer output unchanged', () => {
    expect(describePayer(legacySplit, ME)).toBe('Raj');
    expect(describePayer(legacySplit, RAJ)).toBe('You');
    expect(describePayer({}, ME)).toBe('Someone');
  });

  it('describePayer puts the caller first as "You", then response order', () => {
    expect(describePayer(multiSplit, ME)).toBe('You and Raj');
    expect(describePayer(multiSplit, 'someone-else')).toBe('Raj and Het Shah');
  });

  it('describePayer collapses four payers', () => {
    const fourPayers = {
      amount: 400,
      payers: [
        { payerUserId: RAJ, name: 'Raj', amount: 100 },
        { payerUserId: 'u2', name: 'Amit', amount: 100 },
        { payerUserId: ME, name: 'Het', amount: 100 },
        { payerUserId: 'u3', name: 'Priya', amount: 100 },
      ],
    };
    expect(describePayer(fourPayers, ME)).toBe('You, Raj and 2 others');
  });

  it('findCallerPaid reads only the caller’s own payer entry', () => {
    expect(findCallerPaid(multiSplit, ME)).toBe(300);
    expect(findCallerPaid(multiSplit, RAJ)).toBe(700);
    expect(findCallerPaid(multiSplit, 'someone-else')).toBe(0);
    expect(findCallerPaid(legacySplit, RAJ)).toBe(1000);
    expect(findCallerPaid(legacySplit, ME)).toBe(0);
    expect(findCallerPaid(multiSplit, null)).toBe(0);
  });
});

describe('labelDraftPayers (ADR 0025 §8.6)', () => {
  it('labels in roster order with "You" for self', () => {
    const payers = [
      { participantId: `contact:${AMIT_CONTACT}`, amount: 200 },
      { participantId: 'self', amount: 800 },
    ];
    expect(labelDraftPayers(payers, roster)).toEqual([
      { participantId: 'self', label: 'You', amount: 800 },
      { participantId: `contact:${AMIT_CONTACT}`, label: 'Amit', amount: 200 },
    ]);
  });

  it('returns [] for a single-payer config', () => {
    expect(labelDraftPayers(null, roster)).toEqual([]);
  });
});

describe('validatePayerAmounts (ADR 0025 §8.4)', () => {
  it('is under while amounts fall short of the total', () => {
    const result = validatePayerAmounts(roster, 1000, { self: '600' });
    expect(result).toMatchObject({
      isValid: false,
      status: 'under',
      assignedAmount: 600,
      remainingAmount: 400,
    });
  });

  it('is valid only when the sum is paise-exact, dropping blank/zero entries', () => {
    const result = validatePayerAmounts(roster, 100, {
      self: '33.33',
      [`user:${RAJ}`]: '66.67',
      [`contact:${AMIT_CONTACT}`]: '0',
    });
    expect(result.isValid).toBe(true);
    expect(result.status).toBe('exact');
    expect(result.payers).toEqual([
      { participantId: 'self', amount: 33.33 },
      { participantId: `user:${RAJ}`, amount: 66.67 },
    ]);
  });

  it('is over when amounts exceed the total', () => {
    const result = validatePayerAmounts(roster, 1000, { self: '700', [`user:${RAJ}`]: '400.5' });
    expect(result).toMatchObject({ isValid: false, status: 'over', remainingAmount: -100.5 });
  });

  it('rejects malformed input instead of reading a prefix', () => {
    expect(validatePayerAmounts(roster, 100, { self: '100.001' }).hasInvalidEntry).toBe(true);
    expect(validatePayerAmounts(roster, 100, { self: '100abc' }).isValid).toBe(false);
    expect(validatePayerAmounts(roster, 100, { self: '-5', [`user:${RAJ}`]: '105' }).isValid).toBe(
      false,
    );
  });

  it('accepts trailing-dot and leading-dot amounts', () => {
    expect(validatePayerAmounts(roster, 100.5, { self: '100.', [`user:${RAJ}`]: '.5' }).isValid).toBe(
      true,
    );
  });

  it('needs at least one entry above zero', () => {
    expect(validatePayerAmounts(roster, 0, {}).isValid).toBe(false);
  });
});

describe('toPayerSelection (ADR 0025 §8.4 Confirm)', () => {
  it('collapses exactly one payer to single mode', () => {
    expect(toPayerSelection([{ participantId: `user:${RAJ}`, amount: 1000 }])).toEqual({
      paidById: `user:${RAJ}`,
      payers: null,
    });
  });

  it('keeps two or more payers in multi mode', () => {
    const payers = [
      { participantId: 'self', amount: 600 },
      { participantId: `user:${RAJ}`, amount: 400 },
    ];
    expect(toPayerSelection(payers)).toEqual({ paidById: null, payers });
  });
});

describe('buildSplitExpenseCreateRequest payer forms (ADR 0025 §8.2)', () => {
  const baseValues = {
    title: 'Dinner',
    categoryId: null,
    splitDate: '2026-11-06',
    amount: 900,
    splitMode: 'group',
    groupId: 'group-1',
    individualCounterpartContactId: null,
    participants: roster,
  };
  const participantAmounts = [
    { participantId: 'self', name: 'Het Shah', amount: 300 },
    { participantId: `user:${RAJ}`, name: 'Raj', amount: 300 },
    { participantId: `contact:${AMIT_CONTACT}`, name: 'Amit', amount: 300 },
  ];
  const expectedParticipants = [
    { participantUserId: ME, participantContactId: null, amount: 300 },
    { participantUserId: RAJ, participantContactId: null, amount: 300 },
    { participantUserId: null, participantContactId: AMIT_CONTACT, amount: 300 },
  ];

  it('sends a single-payer body byte-identical to the pre-ADR-0025 shape', () => {
    const body = buildSplitExpenseCreateRequest({
      ...baseValues,
      splitConfig: { method: 'equally', paidById: 'self', payers: null, participantAmounts },
    });
    // Same keys, same order, no `payers` key.
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({
        title: 'Dinner',
        categoryId: null,
        splitDate: '2026-11-06',
        amount: 900,
        splitMode: 'group',
        groupId: 'group-1',
        individualCounterpartContactId: null,
        splitMethod: 'equally',
        paidByUserId: ME,
        paidByContactId: null,
        participants: expectedParticipants,
        addToPersonalExpenses: false,
      }),
    );
  });

  it('treats a config with no payers key as single-payer', () => {
    const body = buildSplitExpenseCreateRequest({
      ...baseValues,
      splitConfig: { method: 'equally', paidById: `contact:${AMIT_CONTACT}`, participantAmounts },
    });
    expect(body.paidByUserId).toBeNull();
    expect(body.paidByContactId).toBe(AMIT_CONTACT);
    expect('payers' in body).toBe(false);
  });

  it('sends payers[] and omits paidBy* for 2+ payers', () => {
    const body = buildSplitExpenseCreateRequest({
      ...baseValues,
      splitConfig: {
        method: 'equally',
        paidById: null,
        payers: [
          { participantId: 'self', amount: 600 },
          { participantId: `contact:${AMIT_CONTACT}`, amount: 300 },
        ],
        participantAmounts,
      },
    });
    expect(body.payers).toEqual([
      { payerUserId: ME, payerContactId: null, amount: 600 },
      { payerUserId: null, payerContactId: AMIT_CONTACT, amount: 300 },
    ]);
    expect('paidByUserId' in body).toBe(false);
    expect('paidByContactId' in body).toBe(false);
    expect(body.participants).toEqual(expectedParticipants);
    expect(body.addToPersonalExpenses).toBe(false);
  });

  it('sends a stray one-element payers list as the legacy pair', () => {
    const body = buildSplitExpenseCreateRequest({
      ...baseValues,
      splitConfig: {
        method: 'equally',
        paidById: null,
        payers: [{ participantId: `user:${RAJ}`, amount: 900 }],
        participantAmounts,
      },
    });
    expect(body.paidByUserId).toBe(RAJ);
    expect(body.paidByContactId).toBeNull();
    expect('payers' in body).toBe(false);
  });

  it('throws for a payer the roster does not know', () => {
    expect(() =>
      buildSplitExpenseCreateRequest({
        ...baseValues,
        splitConfig: {
          method: 'equally',
          paidById: null,
          payers: [
            { participantId: 'self', amount: 450 },
            { participantId: 'user:ghost', amount: 450 },
          ],
          participantAmounts,
        },
      }),
    ).toThrow();
  });
});
