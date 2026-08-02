/**
 * MOCK DATA — locally defined placeholder data, not sourced from any API.
 * There is no backend expense/budget endpoint yet; this feeds the Dashboard
 * screen only so it renders realistic-looking content in this phase.
 * Replace with React Query-backed data once the Backend Engineer publishes
 * the relevant endpoints.
 */

export const dashboardSummary = {
  monthlyBudget: 4500,
  spent: 3500,
  remaining: 170,
  dailyAverage: 921.67,
  savings: 820,
  currencySymbol: '₹',
};

// `scope` ('personal' | 'group') backs the Dashboard's Personal/Group
// SegmentedControl filter — 'personal' transactions are the user's own
// spending, 'group' transactions are shared expenses tied to an active
// Split group (see src/mocks/splitMocks.js's `activeGroups`), included here
// so both filtered views render a believable, non-empty list.
export const recentTransactions = [
  {
    id: 'txn-1',
    title: 'Artisan Coffee',
    category: 'Food',
    date: 'Today',
    amount: 320,
    type: 'expense',
    glyph: 'F',
    tone: 'neutral',
    scope: 'personal',
  },
  {
    id: 'txn-2',
    title: 'Uber Ride',
    category: 'Transport',
    date: 'Today',
    amount: 180,
    type: 'expense',
    glyph: 'T',
    tone: 'neutral',
    scope: 'personal',
  },
  {
    id: 'txn-3',
    title: 'Freelance Payment',
    category: 'Income',
    date: 'Yesterday',
    amount: 6000,
    type: 'income',
    glyph: 'I',
    tone: 'success',
    scope: 'personal',
  },
  {
    id: 'txn-4',
    title: 'Grocery Store',
    category: 'Groceries',
    date: 'Yesterday',
    amount: 1450,
    type: 'expense',
    glyph: 'G',
    tone: 'neutral',
    scope: 'group',
  },
  {
    id: 'txn-5',
    title: 'Netflix Subscription',
    category: 'Entertainment',
    date: '2 days ago',
    amount: 499,
    type: 'expense',
    glyph: 'E',
    tone: 'warning',
    scope: 'personal',
  },
  {
    id: 'txn-6',
    title: 'Dinner with Flatmates',
    category: 'Food',
    date: '2 days ago',
    amount: 860,
    type: 'expense',
    glyph: 'F',
    tone: 'neutral',
    scope: 'group',
  },
  {
    id: 'txn-7',
    title: 'Movie Night',
    category: 'Entertainment',
    date: '3 days ago',
    amount: 620,
    type: 'expense',
    glyph: 'E',
    tone: 'neutral',
    scope: 'group',
  },
];