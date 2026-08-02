import { groupTransactionsByDay } from '../transactionDayGroups';
import { computeSpentForPeriod, computeSpentByPaymentModeForPeriod } from '../budgetPeriod';

const rows = [
  { id: 'a', txnDate: '2026-11-10', type: 'expense', amount: 100, paymentMode: 'cash' },
  { id: 'b', txnDate: '2026-11-10', type: 'income', amount: 1200, paymentMode: 'cash' },
  { id: 'c', txnDate: '2026-11-08', type: 'expense', amount: 50, paymentMode: 'online' },
  { id: 'd', txnDate: '2026-11-09', type: 'expense', amount: 250, paymentMode: 'cash', splitExpenseId: 's1' },
];

test('groups by day, newest first, with per-day totals', () => {
  const sections = groupTransactionsByDay(rows);
  expect(sections.map((s) => s.date)).toEqual(['2026-11-10', '2026-11-09', '2026-11-08']);
  expect(sections[0]).toMatchObject({ dayOfMonth: '10', weekday: 'Tue', monthYear: '11.2026', incomeTotal: 1200, expenseTotal: 100 });
  expect(sections[2]).toMatchObject({ weekday: 'Sun', isWeekend: true });
  expect(sections[0].data.map((r) => r.id)).toEqual(['a', 'b']);
});

test('split-linked rows count as Split, and modes sum to spent', () => {
  const period = { startDate: '2026-11-01', endDate: '2026-11-30' };
  const byMode = computeSpentByPaymentModeForPeriod(rows, period);
  expect(byMode).toEqual({ cash: 100, online: 50, split: 250 });
  expect(byMode.cash + byMode.online + byMode.split).toBe(computeSpentForPeriod(rows, period));
});

test('split feed groups by day; day total counts live split expenses only', () => {
  const { groupSplitFeedByDay } = require('../transactionDayGroups');
  const sections = groupSplitFeedByDay([
    { itemType: 'split_expense', id: 'e1', occurredOn: '2026-11-04', splitExpense: { amount: 900 } },
    { itemType: 'settlement', id: 's1', occurredOn: '2026-11-04', settlement: { amount: 400 } },
    { itemType: 'split_expense', id: 'e2', occurredOn: '2026-11-04', splitExpense: { amount: 50, deletedAt: 'x' } },
    { itemType: 'split_expense', id: 'e3', occurredOn: '2026-10-31', splitExpense: { amount: 120 } },
  ]);
  expect(sections.map((s) => [s.date, s.expenseTotal, s.incomeTotal, s.data.length])).toEqual([
    ['2026-11-04', 900, 0, 3],
    ['2026-10-31', 120, 0, 1],
  ]);
});
