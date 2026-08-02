/**
 * End-to-end check of the offline create path with writes ENABLED: the Add
 * Expense save resolves successfully without any network, the op is durably
 * queued, and the overlaid list shows the new row at once.
 */
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  OFFLINE_WRITES_ENABLED: true,
}));
jest.mock('../syncEngine', () => ({
  ...jest.requireActual('../syncEngine'),
  requestFlush: jest.fn(),
}));
jest.mock('../../api/transactionsApi', () => ({
  createTransaction: jest.fn(() => {
    throw new Error('network must not be called on an offline create');
  }),
}));

const { loadOutbox, getOps } = require('../outbox');
const { selectActiveOps } = require('../overlays/activeOps');
const { overlayTransactions } = require('../overlays/transactions');
const { useTransactionsStore } = require('../../store/useTransactionsStore');

test('offline Add Expense queues the write and shows the row immediately', async () => {
  await loadOutbox('user-1');

  const result = await useTransactionsStore.getState().createTransaction({
    title: 'Chai',
    txnDate: '2026-11-11',
    txnTime: '10:15',
    amount: 30,
    type: 'expense',
    categoryId: 'cat-food',
    categoryName: 'Food',
    parentCategoryName: null,
    scope: 'personal',
    groupId: null,
    paymentMode: 'cash',
    cashAmount: null,
    onlineAmount: null,
    notes: null,
    receiptPublicId: null,
  });

  expect(result.success).toBe(true);
  expect(result.pending).toBe(true);
  expect(getOps()).toHaveLength(1);

  const { transactions, fetchStartedAt } = useTransactionsStore.getState();
  const rows = overlayTransactions(
    transactions,
    selectActiveOps(getOps(), 'transactions', fetchStartedAt),
  );
  expect(rows.map((row) => row.title)).toContain('Chai');
  expect(rows.find((row) => row.title === 'Chai').id).toBe(result.id);
});
