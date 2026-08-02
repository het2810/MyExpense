/**
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md
 * §7.8 (viewer status) and §9.1 (copy builders).
 */
import {
  debtSentence,
  feedStatusText,
  feedStatusTone,
  groupSummarySentence,
  legacySettlementTitle,
  memberNetSentence,
  pairBalanceSentence,
  participantLine,
  payersLine,
  remainingAfterSettlementSentence,
  routingNote,
  settlementTitle,
  tombstoneLine,
} from '../balanceCopy';
import {
  appendFeedPage,
  describeFeedItemForViewer,
  isFeedItemTappable,
  toFeedTargetKey,
} from '../splitFeed';

const HET = 'het-id';
const RAJ = 'raj-id';
const AMIT = 'amit-id';

const het = { userId: HET, name: 'Het Shah' };
const raj = { userId: RAJ, name: 'Raj Mehta' };
const amit = { userId: AMIT, name: 'Amit Kumar' };

function groupDinner(overrides = {}) {
  return {
    id: 's1',
    splitMode: 'group',
    groupId: 'g1',
    title: 'Dinner',
    amount: 900,
    createdByUserId: HET,
    createdByName: 'Het Shah',
    deletedAt: null,
    payers: [{ payerUserId: HET, payerContactId: null, name: 'Het Shah', amount: 900 }],
    participants: [
      { participantUserId: HET, participantContactId: null, name: 'Het Shah', amount: 300 },
      { participantUserId: RAJ, participantContactId: null, name: 'Raj Mehta', amount: 300 },
      { participantUserId: AMIT, participantContactId: null, name: 'Amit Kumar', amount: 300 },
    ],
    counterparts: [],
    ...overrides,
  };
}

/** ADR 0028 §4.3's individual example: Raj paid all, Raj and Amit counterparts. */
function individualDinner() {
  return {
    id: 's2',
    splitMode: 'individual',
    title: 'Dinner',
    amount: 900,
    createdByUserId: HET,
    createdByName: 'Het Shah',
    deletedAt: null,
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

const splitItem = (splitExpense) => ({ itemType: 'split_expense', id: splitExpense.id, splitExpense, settlement: null });

describe('describeFeedItemForViewer', () => {
  it('group split: lent, borrowed, not involved', () => {
    const item = splitItem(groupDinner());
    expect(describeFeedItemForViewer(item, { groupId: 'g1' }, HET)).toEqual({ status: 'lent', amount: 600 });
    expect(describeFeedItemForViewer(item, { groupId: 'g1' }, RAJ)).toEqual({ status: 'borrowed', amount: 300 });
    expect(describeFeedItemForViewer(item, { groupId: 'g1' }, 'outsider')).toEqual({ status: 'not_involved', amount: null });
  });

  it('group split: involved with zero net is no balance', () => {
    const item = splitItem(
      groupDinner({
        payers: [{ payerUserId: RAJ, amount: 300 }, { payerUserId: HET, amount: 600 }],
        participants: [
          { participantUserId: RAJ, amount: 300 },
          { participantUserId: HET, amount: 600 },
        ],
      }),
    );
    expect(describeFeedItemForViewer(item, { groupId: 'g1' }, RAJ).status).toBe('no_balance');
  });

  it('pair split says owed/owe, never lent (§7.8)', () => {
    const item = splitItem(individualDinner());
    expect(describeFeedItemForViewer(item, { individualBalanceId: 'p-amit' }, HET)).toEqual({ status: 'owed', amount: 300 });
    expect(describeFeedItemForViewer(item, { individualBalanceId: 'p-raj' }, HET)).toEqual({ status: 'owe', amount: 600 });
    expect(describeFeedItemForViewer(item, { individualBalanceId: 'p-raj' }, RAJ)).toEqual({ status: 'owed', amount: 600 });
  });

  it('deleted split is a tombstone and not tappable', () => {
    const item = splitItem(groupDinner({ deletedAt: '2026-11-12T10:00:00Z', deletedByUserId: RAJ, deletedByName: 'Raj Mehta' }));
    expect(describeFeedItemForViewer(item, { groupId: 'g1' }, HET).status).toBe('deleted');
    expect(isFeedItemTappable(item)).toBe(false);
    expect(isFeedItemTappable(splitItem(groupDinner()))).toBe(true);
    expect(tombstoneLine(item.splitExpense, HET)).toBe('Deleted by Raj M.');
    expect(tombstoneLine({ ...item.splitExpense, deletedByUserId: HET }, HET)).toBe('Deleted by you');
  });

  it('settlements: paid, received, not involved, legacy', () => {
    const settlement = (payer, payee) => ({
      itemType: 'settlement',
      id: 'x1',
      splitExpense: null,
      settlement: { amount: 120, payer, payee, initiatedByUserId: HET },
    });
    expect(describeFeedItemForViewer(settlement(het, raj), { groupId: 'g1' }, HET)).toEqual({ status: 'paid', amount: 120 });
    expect(describeFeedItemForViewer(settlement(het, raj), { groupId: 'g1' }, RAJ)).toEqual({ status: 'received', amount: 120 });
    expect(describeFeedItemForViewer(settlement(het, raj), { groupId: 'g1' }, AMIT).status).toBe('not_involved');
    expect(describeFeedItemForViewer(settlement(null, null), { groupId: 'g1' }, AMIT)).toEqual({ status: 'recorded', amount: 120 });
    expect(isFeedItemTappable(settlement(het, raj))).toBe(false);
  });
});

describe('feed paging helpers', () => {
  it('de-duplicates by itemType + id', () => {
    const a = { itemType: 'split_expense', id: '1' };
    const b = { itemType: 'settlement', id: '1' };
    expect(appendFeedPage([a], [a, b])).toEqual([a, b]);
  });

  it('keys targets', () => {
    expect(toFeedTargetKey({ groupId: 'g' })).toBe('group:g');
    expect(toFeedTargetKey({ individualBalanceId: 'p' })).toBe('pair:p');
    expect(toFeedTargetKey({})).toBeNull();
  });
});

describe('balanceCopy', () => {
  it('debtSentence', () => {
    expect(debtSentence(het, amit, 120, HET)).toBe('You owe Amit K. ₹120');
    expect(debtSentence(raj, het, 250, HET)).toBe('Raj M. owes you ₹250');
    expect(debtSentence(raj, amit, 80, HET)).toBe('Raj M. owes Amit K. ₹80');
    expect(debtSentence({ key: `u:${HET}`, name: 'Het Shah' }, raj, 5, HET)).toBe('You owe Raj M. ₹5');
  });

  it('memberNetSentence', () => {
    expect(memberNetSentence({ ...het, balance: 250 }, HET)).toBe('You get back ₹250');
    expect(memberNetSentence({ ...raj, balance: -80.5 }, HET)).toBe('Raj M. owes ₹80.5');
    expect(memberNetSentence({ ...raj, balance: 0 }, HET)).toBe('Raj M. is settled up');
    expect(memberNetSentence({ ...het, balance: 0 }, HET)).toBe("You're settled up");
  });

  it('pair and group sentences', () => {
    expect(pairBalanceSentence('Raj', 250)).toBe('Raj owes you ₹250');
    expect(pairBalanceSentence('Amit Kumar', -120)).toBe('You owe Amit K. ₹120');
    expect(pairBalanceSentence('Raj', 0)).toBe('You and Raj are settled up');
    expect(groupSummarySentence(1443.4)).toBe('You are owed ₹1,443.4 overall');
    expect(groupSummarySentence(-10)).toBe('You owe ₹10 overall');
    expect(groupSummarySentence(0)).toBe("You're all settled up in this group");
  });

  it('feed status text and tone', () => {
    expect(feedStatusText('lent', 600)).toBe('you lent ₹600');
    expect(feedStatusText('borrowed', 300)).toBe('you borrowed ₹300');
    expect(feedStatusText('owed', 300)).toBe("you're owed ₹300");
    expect(feedStatusText('owe', 300)).toBe('you owe ₹300');
    expect(feedStatusText('paid', 1)).toBe('you paid ₹1');
    expect(feedStatusText('received', 1)).toBe('you received ₹1');
    expect(feedStatusText('no_balance', null)).toBe('no balance');
    expect(feedStatusText('not_involved', null)).toBe('not involved');
    expect(feedStatusText('deleted', null)).toBe('deleted');
    expect(feedStatusText('recorded', 9)).toBe('recorded ₹9');
    expect(feedStatusTone('lent')).toBe('positive');
    expect(feedStatusTone('owe')).toBe('negative');
    expect(feedStatusTone('paid')).toBe('neutral');
    expect(feedStatusTone('deleted')).toBe('muted');
  });

  it('settlement titles', () => {
    const ritu = { userId: 'r', name: 'Ritu Gupta' };
    const dhruv = { userId: 'd', name: 'Dhruv Chawla' };
    expect(settlementTitle(ritu, dhruv, 1443.4, HET)).toBe('Ritu G. paid Dhruv C. ₹1,443.4');
    expect(settlementTitle(het, dhruv, 10, HET)).toBe('You paid Dhruv C. ₹10');
    expect(settlementTitle(ritu, het, 10, HET)).toBe('Ritu G. paid you ₹10');
    expect(legacySettlementTitle(het, 10, HET)).toBe('You recorded a ₹10 payment');
    expect(legacySettlementTitle(raj, 10, HET)).toBe('Raj M. recorded a ₹10 payment');
  });

  it('payersLine puts the viewer first', () => {
    expect(payersLine(groupDinner(), HET)).toBe('You paid ₹900');
    expect(payersLine(groupDinner(), RAJ)).toBe('Het S. paid ₹900');
    const both = groupDinner({
      payers: [
        { payerUserId: RAJ, name: 'Raj Mehta', amount: 300 },
        { payerUserId: HET, name: 'Het Shah', amount: 600 },
      ],
    });
    expect(payersLine(both, HET)).toBe('You and Raj M. paid ₹900');
  });

  it('participantLine', () => {
    expect(participantLine(het, 900, 300, HET)).toBe('You paid ₹900 and owe ₹300');
    expect(participantLine(raj, 0, 300, HET)).toBe('Raj M. owes ₹300');
    expect(participantLine(raj, 900, 0, HET)).toBe('Raj M. paid ₹900');
  });

  it('routingNote for the creator and for a counterpart', () => {
    const split = individualDinner();
    expect(routingNote(split, { individualBalanceId: 'p-raj' }, HET)).toBe(
      'Balances for this expense are kept between you and each person.',
    );
    expect(routingNote(split, { individualBalanceId: 'p-raj' }, RAJ)).toBe(
      'This expense is settled through Het S. For it, Het S. owes you ₹600.',
    );
    expect(routingNote(groupDinner(), null, HET)).toBeNull();
  });

  it('remaining after settlement', () => {
    expect(remainingAfterSettlementSentence('Raj', 50)).toBe('Raj still owes you ₹50');
    expect(remainingAfterSettlementSentence('Raj', -50)).toBe('You still owe Raj ₹50');
    expect(remainingAfterSettlementSentence('Raj', 0)).toBe('You and Raj are settled up');
  });
});
