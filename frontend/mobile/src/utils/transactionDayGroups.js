import { parseIsoDate, getTodayIsoDate } from './dateDisplay';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Groups dated items into one section per day for the date-wise lists
 * (Dashboard transactions, Split Detail's expense feed): a day header with
 * that day's income and expense totals, then the day's rows, newest day first.
 *
 * Order-preserving: within a day, items keep the order they arrived in (both
 * APIs already sort newest first). Items of the same date are merged even if
 * they are not adjacent.
 *
 * @param {object[]} items
 * @param {(item: object) => string} getDate 'YYYY-MM-DD' of an item.
 * @param {(item: object) => { kind: 'income' | 'expense' | null, amount: number }} classify
 *   Which day total an item adds to, if any (`kind: null` adds to neither).
 * @returns {Array<{ key: string, date: string, dayOfMonth: string,
 *   weekday: string, isWeekend: boolean, isToday: boolean, monthYear: string,
 *   incomeTotal: number, expenseTotal: number, data: object[] }>}
 */
function groupByDay(items, getDate, classify) {
  const sectionsByDate = new Map();
  const todayIso = getTodayIsoDate();

  items.forEach((item) => {
    const date = getDate(item);
    let section = sectionsByDate.get(date);
    if (!section) {
      const dayIndex = parseIsoDate(date).getDay();
      const [year, month, day] = date.split('-');
      section = {
        key: date,
        date,
        dayOfMonth: day,
        weekday: WEEKDAY_LABELS[dayIndex],
        isWeekend: dayIndex === 0 || dayIndex === 6,
        isToday: date === todayIso,
        monthYear: `${month}.${year}`,
        incomeTotal: 0,
        expenseTotal: 0,
        data: [],
      };
      sectionsByDate.set(date, section);
    }
    section.data.push(item);
    const { kind, amount } = classify(item);
    if (kind === 'income') {
      section.incomeTotal += amount;
    } else if (kind === 'expense') {
      section.expenseTotal += amount;
    }
  });

  return [...sectionsByDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Dashboard transactions by `txnDate`; income rows feed the day's income total.
 *
 * @param {object[]} transactions
 */
export function groupTransactionsByDay(transactions) {
  return groupByDay(
    transactions,
    (transaction) => transaction.txnDate,
    (transaction) => ({
      kind: transaction.type === 'income' ? 'income' : 'expense',
      amount: transaction.amount,
    }),
  );
}

/**
 * Split Detail's group/pair feed (ADR 0028 §7) by `occurredOn`, with the same
 * day headers as the Dashboard (Project Owner, 2026-11-12 — replaces the
 * ADR's month sections). The day total is the whole bills of that day's live
 * split expenses, the same figure the TOTAL SPENT card sums. Settlements move
 * money between people but are not spending, and deleted splits count nothing,
 * so neither adds to a total.
 *
 * @param {object[]} feedItems
 */
export function groupSplitFeedByDay(feedItems) {
  return groupByDay(
    feedItems,
    (item) => item.occurredOn,
    (item) =>
      item.itemType === 'split_expense' && item.splitExpense && !item.splitExpense.deletedAt
        ? { kind: 'expense', amount: item.splitExpense.amount }
        : { kind: null, amount: 0 },
  );
}
