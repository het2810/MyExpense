/**
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §7.7:
 * split.update / split.delete overlays, and settlements waiting for them.
 */
import { overlaySplitFeed } from '../overlays/splitFeed';
import { overlayGroupBalances, overlayIndividualBalances } from '../overlays/balances';
import { overlayTransactions } from '../overlays/transactions';
import { computeDependsOn } from '../dependencies';
import { describeGroupDebts } from '../../utils/simplifyDebts';

const HET = 'het-id';
const RAJ = 'raj-id';

const split = {
  id: 's1',
  splitMode: 'group',
  groupId: 'g1',
  title: 'Dinner',
  amount: 600,
  splitDate: '2026-11-04',
  createdByUserId: HET,
  personalTransactionId: 't1',
  deletedAt: null,
  payers: [{ payerUserId: HET, amount: 600 }],
  participants: [
    { participantUserId: HET, amount: 300 },
    { participantUserId: RAJ, amount: 300 },
  ],
};
const feedItem = { itemType: 'split_expense', id: 's1', occurredOn: '2026-11-04', splitExpense: split, settlement: null };

describe('overlaySplitFeed', () => {
  it('replaces the split on split.update', () => {
    const after = { ...split, title: 'Supper' };
    const [item] = overlaySplitFeed(
      [feedItem],
      [{ type: 'split.update', entityId: 's1', status: 'pending', preview: { after } }],
      { groupId: 'g1' },
    );
    expect(item.splitExpense.title).toBe('Supper');
    expect(item.localSyncStatus).toBe('pending');
  });

  it('marks a tombstone on split.delete', () => {
    const [item] = overlaySplitFeed(
      [feedItem],
      [{ type: 'split.delete', entityId: 's1', status: 'pending', clientUpdatedAt: '2026-11-12T00:00:00Z', preview: { deletedByUserId: HET } }],
      { groupId: 'g1' },
      { currentUserId: HET, currentUserName: 'Het Shah' },
    );
    expect(item.splitExpense.deletedAt).toBe('2026-11-12T00:00:00Z');
    expect(item.splitExpense.deletedByUserId).toBe(HET);
  });

  it('inserts a queued settlement with payer and payee from the direction', () => {
    const items = overlaySplitFeed(
      [feedItem],
      [
        {
          type: 'settlement.create',
          entityId: 'x1',
          status: 'pending',
          createdAt: '2026-11-12T10:00:00Z',
          body: { expectedDirection: 'caller_pays', amount: 50 },
          preview: { target: 'group', groupId: 'g1', amount: 50, counterpart: { userId: RAJ, contactId: null, name: 'Raj Mehta' } },
        },
      ],
      { groupId: 'g1' },
      { currentUserId: HET, currentUserName: 'Het Shah' },
    );
    expect(items[0].settlement.payer.userId).toBe(HET);
    expect(items[0].settlement.payee.userId).toBe(RAJ);
  });
});

describe('balance overlays', () => {
  const group = {
    id: 'g1',
    yourBalance: 300,
    members: [
      { userId: HET, invitedContactId: null, name: 'Het', balance: 300 },
      { userId: RAJ, invitedContactId: null, name: 'Raj', balance: -300 },
    ],
  };

  it('a group delete moves yourBalance and member nets, staying zero-sum', () => {
    const op = {
      type: 'split.delete',
      status: 'pending',
      preview: {
        groupId: 'g1',
        balanceEffects: { groupDelta: -300, memberDeltas: { [`u:${HET}`]: -300, [`u:${RAJ}`]: 300 }, pairDeltas: [] },
      },
    };
    const [row] = overlayGroupBalances([group], [op], HET);
    expect(row.yourBalance).toBe(0);
    expect(row.members.map((member) => member.balance)).toEqual([0, 0]);
    expect(row.isEstimate).toBe(true);
  });

  it('a group settlement moves the viewer and the counterpart', () => {
    const op = {
      type: 'settlement.create',
      status: 'pending',
      body: { expectedDirection: 'caller_receives' },
      preview: { target: 'group', groupId: 'g1', amount: 100, counterpart: { userId: RAJ } },
    };
    const [row] = overlayGroupBalances([group], [op], HET);
    expect(row.members.map((member) => member.balance)).toEqual([200, -200]);
    expect(describeGroupDebts(row, HET).viewerDebts.map((debt) => debt.amount)).toEqual([200]);
  });

  it('a pair update adds its pair delta', () => {
    const [row] = overlayIndividualBalances(
      [{ id: 'p1', balance: -600, counterpartContactId: null }],
      [{ type: 'split.update', status: 'pending', preview: { balanceEffects: { pairDeltas: [{ individualBalanceId: 'p1', delta: 900 }] } } }],
    );
    expect(row.balance).toBe(300);
  });
});

describe('transactions overlay', () => {
  const transaction = { id: 't1', title: 'Dinner', txnDate: '2026-11-04', amount: 300, categoryId: null, paymentMode: null };

  it('follows a split.update and hides on split.delete', () => {
    const after = { ...split, title: 'Supper' };
    const updated = overlayTransactions(
      [transaction],
      [{ type: 'split.update', status: 'pending', preview: { personalTransactionId: 't1', before: split, after } }],
    );
    expect(updated[0].title).toBe('Supper');
    expect(
      overlayTransactions([transaction], [{ type: 'split.delete', status: 'pending', preview: { personalTransactionId: 't1' } }]),
    ).toEqual([]);
  });
});

describe('settlement ordering (§7.7)', () => {
  it('a settlement waits for an earlier edit or delete on the same target', () => {
    const edit = { opId: 'o1', type: 'split.update', entityId: 's1', status: 'pending', ledgerTargets: ['pair:p1'], referencedIds: [] };
    const del = { opId: 'o2', type: 'split.delete', entityId: 's2', status: 'pending', ledgerTargets: ['group:g9'], referencedIds: [] };
    const settle = { opId: 'o3', type: 'settlement.create', entityId: 'x', status: 'pending', ledgerTargets: ['pair:p1'], referencedIds: [] };
    expect(computeDependsOn(settle, [edit, del])).toEqual(['o1']);
  });

  it('an edit and a delete of one split follow its create (same entity)', () => {
    const create = { opId: 'o1', type: 'split.create', entityId: 's1', status: 'pending', ledgerTargets: [], referencedIds: [] };
    const del = { opId: 'o2', type: 'split.delete', entityId: 's1', status: 'pending', ledgerTargets: [], referencedIds: [] };
    expect(computeDependsOn(del, [create])).toEqual(['o1']);
  });
});
