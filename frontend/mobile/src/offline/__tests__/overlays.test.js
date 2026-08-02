/**
 * Overlay and estimate math —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.8.
 */
import { isOpActive, selectActiveOps } from '../overlays/activeOps';
import { overlayGroupBalances, overlayIndividualBalances } from '../overlays/balances';
import { overlayTransactions } from '../overlays/transactions';
import { overlayBudget } from '../overlays/budget';
import { estimateSplitBalanceEffects } from '../../utils/splitEstimates';
import { describeEstimate, labelEstimatedTrailing } from '../../utils/syncDisplay';

describe('the active-op rule', () => {
  const fetchedAt = '2026-11-11T10:00:00.000Z';

  it('unsent ops are always active; superseded never', () => {
    ['pending', 'inflight', 'failed', 'blocked'].forEach((status) =>
      expect(isOpActive({ status }, fetchedAt)).toBe(true),
    );
    expect(isOpActive({ status: 'superseded', ackedAt: '2026-11-11T11:00:00.000Z' }, fetchedAt)).toBe(
      false,
    );
  });

  it('an acked op stays active only until a snapshot read after it', () => {
    expect(isOpActive({ status: 'acked', ackedAt: '2026-11-11T10:05:00.000Z' }, fetchedAt)).toBe(true);
    expect(isOpActive({ status: 'acked', ackedAt: '2026-11-11T09:55:00.000Z' }, fetchedAt)).toBe(
      false,
    );
  });

  it('selects by affects', () => {
    const ops = [
      { status: 'pending', affects: ['groups'] },
      { status: 'pending', affects: ['transactions'] },
    ];
    expect(selectActiveOps(ops, 'groups', null)).toHaveLength(1);
  });
});

describe('group balance estimates', () => {
  const group = { id: 'g1', name: 'Trip', members: [], yourBalance: -100 };

  it('adds (paid − share) per queued split and labels the estimate', () => {
    const ops = [
      {
        type: 'split.create',
        status: 'pending',
        preview: { groupId: 'g1', balanceEffects: { groupDelta: 250 } },
      },
    ];
    const [row] = overlayGroupBalances([group], ops);
    expect(row.yourBalance).toBe(150);
    expect(row.isEstimate).toBe(true);
    expect(row.pendingOpCount).toBe(1);
  });

  it('a settlement moves the balance toward zero, never past it', () => {
    const ops = [
      {
        type: 'settlement.create',
        status: 'pending',
        preview: { target: 'group', groupId: 'g1', amount: 300 },
      },
    ];
    expect(overlayGroupBalances([group], ops)[0].yourBalance).toBe(0);
  });

  it('acked-but-unread ops still estimate, but do not count as waiting', () => {
    const ops = [
      {
        type: 'split.create',
        status: 'acked',
        preview: { groupId: 'g1', balanceEffects: { groupDelta: 0.1 } },
      },
      {
        type: 'split.create',
        status: 'pending',
        preview: { groupId: 'g1', balanceEffects: { groupDelta: 0.2 } },
      },
    ];
    const [row] = overlayGroupBalances([group], ops);
    expect(row.yourBalance).toBe(-99.7);
    expect(row.pendingOpCount).toBe(1);
  });
});

describe('individual balance estimates', () => {
  it('applies −netAmount to an existing pair and creates an estimated row for a new contact', () => {
    const balances = [
      { id: 'p1', counterpartContactId: 'c1', counterpartName: 'Amit', balance: 50 },
    ];
    const ops = [
      {
        type: 'split.create',
        status: 'pending',
        preview: {
          balanceEffects: {
            counterparts: [
              { contactId: 'c1', netAmount: -100, name: 'Amit' },
              { contactId: 'c2', netAmount: 40, name: 'Raj' },
            ],
          },
        },
      },
    ];
    const rows = overlayIndividualBalances(balances, ops);
    expect(rows[0].balance).toBe(150);
    expect(rows[1]).toMatchObject({
      id: 'pending-contact:c2',
      counterpartContactId: 'c2',
      balance: -40,
      isEstimate: true,
    });
  });

  it('settles a pending pair by contact', () => {
    const balances = [{ id: 'pending-contact:c2', counterpartContactId: 'c2', balance: -40 }];
    const ops = [
      {
        type: 'settlement.create',
        status: 'pending',
        preview: { target: 'individual', counterpartContactId: 'c2', amount: 15 },
      },
    ];
    expect(overlayIndividualBalances(balances, ops)[0].balance).toBe(-25);
  });
});

describe('estimateSplitBalanceEffects', () => {
  const participants = [
    { participantId: 'self', participantContactId: null, name: 'Me' },
    { participantId: 'contact:c1', participantContactId: 'c1', name: 'Amit' },
    { participantId: 'contact:c2', participantContactId: 'c2', name: 'Raj' },
  ];
  const equalShares = [
    { participantId: 'self', amount: 100 },
    { participantId: 'contact:c1', amount: 100 },
    { participantId: 'contact:c2', amount: 100 },
  ];

  it('caller paid all: each contact owes the caller their share', () => {
    const effects = estimateSplitBalanceEffects({
      amount: 300,
      splitMode: 'individual',
      splitConfig: { paidById: 'self', payers: null, participantAmounts: equalShares },
      participants,
    });
    expect(effects.callerPaid).toBe(300);
    expect(effects.callerShare).toBe(100);
    expect(effects.counterpartNetAmounts.map((entry) => entry.netAmount)).toEqual([-100, -100]);
  });

  it('a contact paid all: the caller owes that contact only', () => {
    const effects = estimateSplitBalanceEffects({
      amount: 300,
      splitMode: 'individual',
      splitConfig: { paidById: 'contact:c1', payers: null, participantAmounts: equalShares },
      participants,
    });
    expect(effects.counterpartNetAmounts.map((entry) => entry.netAmount)).toEqual([100, 0]);
  });

  it('group mode reports paid and share only', () => {
    const effects = estimateSplitBalanceEffects({
      amount: 300,
      splitMode: 'group',
      splitConfig: {
        paidById: null,
        payers: [
          { participantId: 'self', amount: 200 },
          { participantId: 'contact:c1', amount: 100 },
        ],
        participantAmounts: equalShares,
      },
      participants,
    });
    expect(effects).toEqual({ callerPaid: 200, callerShare: 100, counterpartNetAmounts: [] });
  });
});

describe('estimate labels', () => {
  it('prefixes ≈ and states the waiting count', () => {
    const trailing = { trailingText: '+₹150', trailingSubtext: 'you lent', trailingTone: 'positive' };
    expect(labelEstimatedTrailing(trailing, { isEstimate: true, pendingOpCount: 2 })).toEqual({
      trailingText: '≈ +₹150',
      trailingSubtext: 'Estimated · 2 changes waiting to sync',
      trailingTone: 'positive',
    });
    expect(describeEstimate(1)).toBe('Estimated · 1 change waiting to sync');
    expect(labelEstimatedTrailing(trailing, {})).toBe(trailing);
  });
});

describe('transactions overlay', () => {
  const rows = [
    { id: 't2', title: 'B', txnDate: '2026-11-10', txnTime: '09:00', amount: 20 },
    { id: 't1', title: 'A', txnDate: '2026-11-08', txnTime: '09:00', amount: 10 },
  ];

  it('inserts a queued create newest-first, patches edits, removes deletes', () => {
    const ops = [
      {
        type: 'transaction.create',
        status: 'pending',
        entityId: 't3',
        preview: { row: { id: 't3', title: 'C', txnDate: '2026-11-09', txnTime: '12:00', amount: 5 } },
      },
      { type: 'transaction.update', status: 'failed', entityId: 't2', preview: { patch: { amount: 25 } } },
      { type: 'transaction.delete', status: 'pending', entityId: 't1' },
    ];
    const result = overlayTransactions(rows, ops);
    expect(result.map((row) => row.id)).toEqual(['t2', 't3']);
    expect(result[0]).toMatchObject({ amount: 25, localSyncStatus: 'failed' });
    expect(result[1].localSyncStatus).toBe('pending');
  });

  it('skips a create the snapshot already holds (no double counting)', () => {
    const ops = [
      { type: 'transaction.create', status: 'acked', entityId: 't1', preview: { row: rows[1] } },
    ];
    expect(overlayTransactions(rows, ops)).toHaveLength(2);
  });
});

describe('budget overlay', () => {
  it('the last queued save wins', () => {
    const ops = [
      { type: 'budget.save', preview: { period: { id: 'b1', amount: '100' } } },
      { type: 'budget.save', preview: { period: { id: 'b1', amount: 200 } } },
    ];
    expect(overlayBudget(null, ops)).toEqual({ id: 'b1', amount: 200 });
  });
});
