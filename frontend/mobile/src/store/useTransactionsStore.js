import { create } from 'zustand';

/**
 * Zustand store holding the transaction list that feeds the Dashboard
 * screen's "Recent Transactions" section.
 *
 * Migrated from what was previously a plain exported array
 * (`recentTransactions` in src/mocks/dashboardMocks.js). A plain
 * module-level array can't trigger a re-render when new items are added —
 * saving an expense from the Add Expense modal needs to show up on the
 * Dashboard immediately, so this became a Zustand store instead, following
 * the same in-memory, no-persistence pattern already used by
 * useAuthStore/useThemeStore/useSettingsStore.
 *
 * Item shape — see docs/decisions/0003-payment-mode-and-date-tracking.md
 * Section 2 for the full data-model rationale (`date` format change,
 * `groupId`/`paymentMode` additions):
 * {
 *   id: string,
 *   title: string,
 *   category: string,
 *   date: string,                // ISO 8601 date-only string, 'YYYY-MM-DD'
 *                                 // (NOT a relative-day label anymore — see
 *                                 // src/utils/dateDisplay.js for how a
 *                                 // display label like 'Today'/'2 days ago'
 *                                 // is computed from this at render time).
 *   amount: number,
 *   type: 'expense' | 'income',
 *   iconName: string,           // approved Ionicons name for the category, per
 *                                // docs/ui/design-system.md Section 6. NOT yet
 *                                // rendered anywhere — see AddExpenseScreen's
 *                                // top-of-file note. Carried on the data now so
 *                                // no reshaping is needed once the icon-library
 *                                // swap (docs/decisions/0002-icon-library-selection.md)
 *                                // is actually wired into IconBadge.
 *   glyph: string,               // single-character glyph actually rendered by
 *                                // the current IconBadge component today.
 *   tone: 'neutral' | 'success' | 'warning' | 'negative' | 'positive',
 *   scope: 'personal' | 'group', // backs the Dashboard's Personal/Group filter
 *   groupId: string | null,      // references useGroupsStore's group `id`.
 *                                // Non-null iff scope === 'group'; always
 *                                // present (null, not omitted) otherwise.
 *                                // groupName is deliberately NOT stored here
 *                                // — it's derived via a useGroupsStore
 *                                // lookup at render time (ADR 0003 Section 2).
 *   paymentMode: 'cash' | 'online' | 'both', // present on every record for a
 *                                // uniform key set (including income rows,
 *                                // which never display it — ADR 0003
 *                                // "Out of scope / deferred").
 *   cashAmount: number | null,   // NEW — added in ADR 0003's 2026-08-10
 *                                // Amendment, Part A. Non-null iff
 *                                // paymentMode === 'both'; present-but-null
 *                                // (never omitted) otherwise, mirroring the
 *                                // groupId convention above. When set
 *                                // together with onlineAmount, the two must
 *                                // sum to `amount` (paise-granularity
 *                                // comparison, not raw decimal equality —
 *                                // enforced by AddExpenseScreen's Save
 *                                // validation, not by this store).
 *   onlineAmount: number | null, // NEW — same rules as cashAmount above.
 *   splitExpenseId: string | null, // NEW — docs/decisions/
 *                                // 0006-contact-group-search-and-split-tag.md
 *                                // §5. References a useSplitExpensesStore
 *                                // record's id. Non-null only for a
 *                                // transaction created via Split Add
 *                                // Expense's "Add this transaction to my
 *                                // expenses" checkbox; always present
 *                                // (null, not omitted) otherwise, mirroring
 *                                // the groupId/cashAmount/onlineAmount
 *                                // present-but-null convention above. Backs
 *                                // the transaction row's "SPLIT" badge
 *                                // (design-system.md §10.3) — a direct,
 *                                // O(1) two-way link back to
 *                                // useSplitExpensesStore, which already
 *                                // stores the inverse reference
 *                                // (personalTransactionId).
 *   time: string,                 // NEW — docs/decisions/
 *                                // 0003-payment-mode-and-date-tracking.md's
 *                                // 2026-08-13 amendment / ADR 0007 §1.
 *                                // 'HH:mm', 24-hour, zero-padded (e.g.
 *                                // '14:45'). Always present (never null) —
 *                                // unlike groupId/cashAmount/onlineAmount/
 *                                // splitExpenseId, every transaction happened
 *                                // at some specific time, exactly as every
 *                                // transaction happened on some specific
 *                                // date. Display label computed separately
 *                                // via dateDisplay.js's getTimeLabel — never
 *                                // stored pre-formatted.
 *   notes: string | null,         // NEW — ADR 0007 §5/§6. Free-text notes
 *                                // entered on Add/Edit Expense's optional
 *                                // NOTES field. Present-but-null (never
 *                                // omitted) when not provided, mirroring the
 *                                // groupId/cashAmount/onlineAmount/
 *                                // splitExpenseId convention above.
 *   receiptUri: string | null,    // NEW — ADR 0007 §2/§5/§6. Local file URI
 *                                // returned by react-native-image-picker's
 *                                // launchImageLibrary (assets[0].uri) when a
 *                                // receipt photo is attached. Present-but-
 *                                // null (never omitted) when no receipt is
 *                                // attached, same convention as above.
 * }
 */
const initialTransactions = [
  {
    id: 'txn-1',
    title: 'Artisan Coffee',
    category: 'Food',
    date: '2026-08-10',
    amount: 320,
    type: 'expense',
    iconName: 'cafe-outline',
    glyph: 'F',
    tone: 'neutral',
    scope: 'personal',
    groupId: null,
    paymentMode: 'cash',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '08:15',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-2',
    title: 'Uber Ride',
    category: 'Transport',
    date: '2026-08-10',
    amount: 180,
    type: 'expense',
    iconName: 'car-outline',
    glyph: 'T',
    tone: 'neutral',
    scope: 'personal',
    groupId: null,
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '09:05',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-3',
    title: 'Freelance Payment',
    category: 'Income',
    date: '2026-08-09',
    amount: 6000,
    type: 'income',
    iconName: 'cash-outline',
    glyph: 'I',
    tone: 'success',
    scope: 'personal',
    groupId: null,
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '17:40',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-4',
    title: 'Grocery Store',
    category: 'Groceries',
    date: '2026-08-09',
    amount: 1450,
    type: 'expense',
    iconName: 'cart-outline',
    glyph: 'G',
    tone: 'neutral',
    scope: 'group',
    groupId: 'group-1',
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '18:20',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-5',
    title: 'Netflix Subscription',
    category: 'Entertainment',
    date: '2026-08-08',
    amount: 499,
    type: 'expense',
    iconName: 'film-outline',
    glyph: 'E',
    tone: 'warning',
    scope: 'personal',
    groupId: null,
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '21:00',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-6',
    title: 'Dinner with Flatmates',
    category: 'Food',
    date: '2026-08-08',
    amount: 860,
    type: 'expense',
    iconName: 'cafe-outline',
    glyph: 'F',
    tone: 'neutral',
    scope: 'group',
    groupId: 'group-1',
    paymentMode: 'both',
    // Real split (ADR 0003's 2026-08-10 Amendment, Part A) — sums to
    // `amount` (400 + 460 = 860).
    cashAmount: 400,
    onlineAmount: 460,
    splitExpenseId: null,
    time: '20:15',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-7',
    title: 'Movie Night',
    category: 'Entertainment',
    date: '2026-08-07',
    amount: 620,
    type: 'expense',
    iconName: 'film-outline',
    glyph: 'E',
    tone: 'neutral',
    scope: 'group',
    groupId: 'group-3',
    paymentMode: 'cash',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '19:45',
    notes: null,
    receiptUri: null,
  },
  // txn-8 through txn-17 added to give the Dashboard's Personal/Group
  // filtered lists enough rows to actually scroll on a typical phone
  // screen (previously 4 personal / 3 group). Categories and iconName/glyph
  // pairs are reused verbatim from src/mocks/categoryMocks.js — no new
  // categories or icon names introduced.
  {
    id: 'txn-8',
    title: 'Gym Membership',
    category: 'Fitness / Leisure',
    date: '2026-08-07',
    amount: 1200,
    type: 'expense',
    iconName: 'barbell-outline',
    glyph: 'W',
    tone: 'neutral',
    scope: 'personal',
    groupId: null,
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '07:00',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-9',
    title: 'Electricity Bill',
    category: 'Home / Rent',
    date: '2026-08-06',
    amount: 2100,
    type: 'expense',
    iconName: 'home-outline',
    glyph: 'H',
    tone: 'warning',
    scope: 'personal',
    groupId: null,
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '11:30',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-10',
    title: 'Online Shopping',
    category: 'Shopping',
    date: '2026-08-06',
    amount: 1750,
    type: 'expense',
    iconName: 'bag-outline',
    glyph: 'S',
    tone: 'neutral',
    scope: 'personal',
    groupId: null,
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '15:10',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-11',
    title: 'Metro Card Recharge',
    category: 'Transport',
    date: '2026-08-05',
    amount: 500,
    type: 'expense',
    iconName: 'car-outline',
    glyph: 'T',
    tone: 'neutral',
    scope: 'personal',
    groupId: null,
    paymentMode: 'cash',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '08:50',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-12',
    title: 'Salary Credit',
    category: 'Income',
    date: '2026-08-04',
    amount: 45000,
    type: 'income',
    iconName: 'cash-outline',
    glyph: 'I',
    tone: 'success',
    scope: 'personal',
    groupId: null,
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '09:00',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-13',
    title: 'Weekend Trip Fuel',
    category: 'Transport',
    date: '2026-08-07',
    amount: 900,
    type: 'expense',
    iconName: 'car-outline',
    glyph: 'T',
    tone: 'neutral',
    scope: 'group',
    groupId: 'group-2',
    paymentMode: 'cash',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '10:20',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-14',
    title: 'Groceries Run',
    category: 'Groceries',
    date: '2026-08-06',
    amount: 1320,
    type: 'expense',
    iconName: 'cart-outline',
    glyph: 'G',
    tone: 'neutral',
    scope: 'group',
    groupId: 'group-1',
    paymentMode: 'both',
    // Real split (ADR 0003's 2026-08-10 Amendment, Part A) — sums to
    // `amount` (600 + 720 = 1320).
    cashAmount: 600,
    onlineAmount: 720,
    splitExpenseId: null,
    time: '17:05',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-15',
    title: 'Concert Tickets',
    category: 'Entertainment',
    date: '2026-08-05',
    amount: 1800,
    type: 'expense',
    iconName: 'film-outline',
    glyph: 'E',
    tone: 'warning',
    scope: 'group',
    groupId: 'group-3',
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '19:00',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-16',
    title: 'Shared Rent Split',
    category: 'Home / Rent',
    date: '2026-08-04',
    amount: 5000,
    type: 'expense',
    iconName: 'home-outline',
    glyph: 'H',
    tone: 'neutral',
    scope: 'group',
    groupId: 'group-1',
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '09:30',
    notes: null,
    receiptUri: null,
  },
  {
    id: 'txn-17',
    title: 'Split Refund',
    category: 'Income',
    // Previously '1 week ago' (7 days back) — under the new display rule
    // (design-system.md Section 7.5) a diff of 7 days no longer buckets into
    // an "N days ago" label at all; it now renders as an actual formatted
    // date ('3 Aug 2026'), which is the documented, expected behavior change.
    date: '2026-08-03',
    amount: 750,
    type: 'income',
    iconName: 'cash-outline',
    glyph: 'I',
    tone: 'success',
    scope: 'group',
    groupId: 'group-2',
    paymentMode: 'online',
    cashAmount: null,
    onlineAmount: null,
    splitExpenseId: null,
    time: '14:15',
    notes: null,
    receiptUri: null,
  },
];

export const useTransactionsStore = create((set) => ({
  transactions: initialTransactions,

  /**
   * Prepends a new transaction so it appears at the top of the Dashboard's
   * Recent Transactions list, matching how the newest item would naturally
   * sort first (mirrors the existing 'Today' items already being first).
   * @param {object} transaction
   */
  addTransaction: (transaction) =>
    set((state) => ({ transactions: [transaction, ...state.transactions] })),

  /**
   * Patches an existing transaction by id — ADR 0007 §6. MERGE semantics,
   * not a full replace: `updatedFields` only needs to carry the fields
   * AddExpenseScreen's edit-mode form actually touches, and every other
   * field (notably `splitExpenseId`, which the edit form never sets) simply
   * keeps its prior value by construction. This is a deliberate correctness
   * choice — a full-replace design would require the caller to remember to
   * re-include every untouched field, risking an edit silently resetting a
   * split-originated transaction's link back to null.
   * @param {string} id
   * @param {object} updatedFields - partial transaction fields to merge in
   */
  updateTransaction: (id, updatedFields) =>
    set((state) => ({
      transactions: state.transactions.map((transaction) =>
        transaction.id === id ? { ...transaction, ...updatedFields } : transaction,
      ),
    })),

  /**
   * Removes a transaction by id — ADR 0007 §6/§7 (Transaction Detail's
   * Delete action, confirmed via the shared ConfirmationDialog before this
   * is called — docs/decisions/0013-confirmation-dialog-and-free-tier-polish.md
   * §2 replaced the original Alert.alert confirmation with this themed
   * dialog; the store call itself is unchanged). Does
   * NOT cascade into useSplitExpensesStore's participant amounts or
   * yourBalance on useIndividualSplitsStore/useGroupsStore — explicitly out
   * of scope per ADR 0007, mirroring ADR 0005's own "editing/deleting a
   * split expense is out of scope" boundary.
   * @param {string} id
   */
  deleteTransaction: (id) =>
    set((state) => ({
      transactions: state.transactions.filter((transaction) => transaction.id !== id),
    })),
}));
