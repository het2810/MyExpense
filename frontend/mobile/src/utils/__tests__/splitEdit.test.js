/**
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md
 * §4.2/§4.3 (deltas, using the ADR's worked examples), §5.2 (personal
 * transaction follow), §6.2 (update body), §11.4/§11.5 (permission, prefill).
 */
import {
  applySplitEditToPersonalTransaction,
  buildEditRoster,
  buildSplitConfigFromSplitExpense,
  buildSplitExpenseUpdateRequest,
  canEditSplitExpense,
  computeSplitBalanceDeltas,
  projectSplitExpenseEdit,
} from '../splitEdit';

const HET = 'het-id';
const RAJ = 'raj-id';
const AMIT = 'amit-id';
const identity = { userId: HET, fullName: 'Het Shah', initials: 'HS' };

const group = {
  id: 'g1',
  name: 'Trip',
  members: [
    { userId: HET, invitedContactId: null, name: 'Het Shah' },
    { userId: RAJ, invitedContactId: null, name: 'Raj Mehta' },
    { userId: AMIT, invitedContactId: null, name: 'Amit Kumar' },
  ],
};

function groupDinner() {
  return {
    id: 's1',
    splitMode: 'group',
    groupId: 'g1',
    title: 'Dinner',
    amount: 900,
    splitDate: '2026-11-04',
    splitMethod: 'equally',
    categoryId: 'cat-food',
    categoryName: 'Food',
    categoryGlyph: 'F',
    createdByUserId: HET,
    payers: [{ payerUserId: HET, payerContactId: null, name: 'Het Shah', amount: 900 }],
    participants: [
      { participantUserId: HET, participantContactId: null, amount: 300 },
      { participantUserId: RAJ, participantContactId: null, amount: 300 },
      { participantUserId: AMIT, participantContactId: null, amount: 300 },
    ],
    counterparts: [],
  };
}

function individualDinner() {
  return {
    id: 's2',
    splitMode: 'individual',
    title: 'Dinner',
    amount: 900,
    splitDate: '2026-11-04',
    splitMethod: 'percentage',
    categoryId: 'cat-food',
    createdByUserId: HET,
    payers: [{ payerUserId: RAJ, payerContactId: null, name: 'Raj Mehta', amount: 900 }],
    participants: [
      { participantUserId: HET, participantContactId: null, amount: 300 },
      { participantUserId: RAJ, participantContactId: null, amount: 300 },
      { participantUserId: null, participantContactId: 'c-amit', amount: 300 },
    ],
    counterparts: [
      { individualBalanceId: 'p-raj', counterpartUserId: RAJ, counterpartContactId: null, name: 'Raj Mehta', netAmount: 600 },
      { individualBalanceId: 'p-amit', counterpartUserId: null, counterpartContactId: 'c-amit', name: 'Amit Kumar', netAmount: -300 },
    ],
  };
}

describe('canEditSplitExpense (§11.4)', () => {
  it('group: any member; individual: creator only; tombstone: nobody', () => {
    expect(canEditSplitExpense(groupDinner(), RAJ)).toBe(true);
    expect(canEditSplitExpense(individualDinner(), HET)).toBe(true);
    expect(canEditSplitExpense(individualDinner(), RAJ)).toBe(false);
    expect(canEditSplitExpense({ ...groupDinner(), deletedAt: 'x' }, HET)).toBe(false);
  });
});

describe('prefill (§11.5)', () => {
  it('group: roster from the group, equally reopens on Equally', () => {
    const roster = buildEditRoster({ splitExpense: groupDinner(), group, identity });
    const config = buildSplitConfigFromSplitExpense(groupDinner(), HET, roster);
    expect(config.method).toBe('equally');
    expect(config.paidById).toBe('self');
    expect(config.payers).toBeNull();
    expect(config.participantAmounts.map((entry) => [entry.participantId, entry.amount])).toEqual([
      ['self', 300],
      [`user:${RAJ}`, 300],
      [`user:${AMIT}`, 300],
    ]);
  });

  it('individual: roster from counterparts, percentage reopens on Unequally', () => {
    const roster = buildEditRoster({ splitExpense: individualDinner(), identity });
    expect(roster.map((entry) => entry.participantId)).toEqual(['self', `user:${RAJ}`, 'contact:c-amit']);
    const config = buildSplitConfigFromSplitExpense(individualDinner(), HET, roster);
    expect(config.method).toBe('unequally');
    expect(config.paidById).toBe(`user:${RAJ}`);
  });

  it('multi-payer reopens with the payer list', () => {
    const split = {
      ...groupDinner(),
      payers: [
        { payerUserId: HET, amount: 600 },
        { payerUserId: RAJ, amount: 300 },
      ],
    };
    const roster = buildEditRoster({ splitExpense: split, group, identity });
    const config = buildSplitConfigFromSplitExpense(split, HET, roster);
    expect(config.paidById).toBeNull();
    expect(config.payers).toEqual([
      { participantId: 'self', amount: 600 },
      { participantId: `user:${RAJ}`, amount: 300 },
    ]);
  });
});

describe('buildSplitExpenseUpdateRequest (§6.2)', () => {
  it('sends only editable fields and omits an unchanged category', () => {
    const split = individualDinner();
    const roster = buildEditRoster({ splitExpense: split, identity });
    const splitConfig = buildSplitConfigFromSplitExpense(split, HET, roster);
    const body = buildSplitExpenseUpdateRequest(
      { title: 'Dinner 2', categoryId: 'cat-food', splitDate: '2026-11-05', amount: 900, splitConfig, participants: roster },
      split,
    );
    expect(Object.keys(body).sort()).toEqual(
      ['amount', 'paidByContactId', 'paidByUserId', 'participants', 'splitDate', 'splitMethod', 'title'].sort(),
    );
    expect(body.paidByUserId).toBe(RAJ);
    expect(body.participants).toEqual([
      { participantUserId: HET, participantContactId: null, amount: 300 },
      { participantUserId: RAJ, participantContactId: null, amount: 300 },
      { participantUserId: null, participantContactId: 'c-amit', amount: 300 },
    ]);
  });

  it('keeps a changed category', () => {
    const split = groupDinner();
    const roster = buildEditRoster({ splitExpense: split, group, identity });
    const splitConfig = buildSplitConfigFromSplitExpense(split, HET, roster);
    const body = buildSplitExpenseUpdateRequest(
      { title: 'Dinner', categoryId: 'cat-new', splitDate: '2026-11-04', amount: 900, splitConfig, participants: roster },
      split,
    );
    expect(body.categoryId).toBe('cat-new');
    expect(body).not.toHaveProperty('groupId');
    expect(body).not.toHaveProperty('splitMode');
    expect(body).not.toHaveProperty('addToPersonalExpenses');
  });
});

describe('computeSplitBalanceDeltas (ADR 0028 §4.2/§4.3 worked examples)', () => {
  it('group edit: Het -100, Raj +200, Amit -100', () => {
    const before = groupDinner();
    const after = {
      ...before,
      amount: 1200,
      payers: [
        { payerUserId: HET, amount: 900 },
        { payerUserId: RAJ, amount: 300 },
      ],
      participants: [
        { participantUserId: HET, amount: 400 },
        { participantUserId: RAJ, amount: 400 },
        { participantUserId: AMIT, amount: 400 },
      ],
    };
    const deltas = computeSplitBalanceDeltas(before, after, HET);
    expect(deltas.memberDeltas).toEqual({ [`u:${HET}`]: -100, [`u:${RAJ}`]: 200, [`u:${AMIT}`]: -100 });
    expect(deltas.groupDelta).toBe(-100);
  });

  it('group delete: Het -600, Raj +300, Amit +300', () => {
    const deltas = computeSplitBalanceDeltas(groupDinner(), null, HET);
    expect(deltas.memberDeltas).toEqual({ [`u:${HET}`]: -600, [`u:${RAJ}`]: 300, [`u:${AMIT}`]: 300 });
  });

  it('individual edit to "Het paid all": Het<->Raj moves by +900 for Het, Het<->Amit by 0', () => {
    const before = individualDinner();
    const roster = buildEditRoster({ splitExpense: before, identity });
    const after = projectSplitExpenseEdit(
      before,
      {
        title: 'Dinner',
        splitDate: '2026-11-04',
        amount: 900,
        splitMethod: 'equally',
        paidByUserId: HET,
        paidByContactId: null,
        participants: before.participants,
      },
      roster,
    );
    expect(after.counterparts.map((entry) => entry.netAmount)).toEqual([-300, -300]);
    // Before: Het owes Raj 600 (-600 for Het). After: Raj owes Het 300 (+300).
    expect(computeSplitBalanceDeltas(before, after, HET).pairDeltas).toEqual([
      { individualBalanceId: 'p-raj', delta: 900 },
    ]);
  });

  it('individual delete returns both pairs to their pre-split values', () => {
    expect(computeSplitBalanceDeltas(individualDinner(), null, HET).pairDeltas).toEqual([
      { individualBalanceId: 'p-raj', delta: 600 },
      { individualBalanceId: 'p-amit', delta: -300 },
    ]);
  });
});

describe('applySplitEditToPersonalTransaction (§5.2/§5.3)', () => {
  const transaction = {
    id: 't1',
    title: 'Dinner',
    txnDate: '2026-11-04',
    categoryId: 'cat-food',
    amount: 300,
    paymentMode: null,
  };

  it('follows every field that still equals the old split', () => {
    const after = { ...groupDinner(), title: 'Supper', splitDate: '2026-11-05', participants: [{ participantUserId: HET, amount: 400 }] };
    const { transaction: next, isRemoved } = applySplitEditToPersonalTransaction(transaction, groupDinner(), after);
    expect(isRemoved).toBe(false);
    expect(next).toMatchObject({ title: 'Supper', txnDate: '2026-11-05', amount: 400 });
  });

  it('leaves diverged fields and a "both" amount alone', () => {
    const edited = { ...transaction, title: 'My dinner', paymentMode: 'both' };
    const after = { ...groupDinner(), title: 'Supper', participants: [{ participantUserId: HET, amount: 400 }] };
    const { transaction: next } = applySplitEditToPersonalTransaction(edited, groupDinner(), after);
    expect(next.title).toBe('My dinner');
    expect(next.amount).toBe(300);
  });

  it('a share that drops to zero removes the row; a delete always does', () => {
    const after = { ...groupDinner(), participants: [{ participantUserId: RAJ, amount: 900 }] };
    expect(applySplitEditToPersonalTransaction(transaction, groupDinner(), after).isRemoved).toBe(true);
    expect(applySplitEditToPersonalTransaction(transaction, groupDinner(), null).isRemoved).toBe(true);
  });
});
