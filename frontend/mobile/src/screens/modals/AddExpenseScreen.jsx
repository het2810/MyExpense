import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { launchImageLibrary } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useGroups } from '../../hooks/useGroups';
import { useActivityLogStore } from '../../store/useActivityLogStore';
import { useCategoryQuickPicks } from '../../hooks/useCategoryQuickPicks';
import { useCategories } from '../../hooks/useCategories';
import { useTransactions } from '../../hooks/useTransactions';
import { toPaise } from '../../utils/currency';
import { formatCategoryPath } from '../../utils/categories';
import { buildTransactionEditActivities } from '../../utils/activityLogEntries';
import {
  getDateDisplayLabel,
  getCurrentTimeString,
  parseIsoDate,
  toIsoDateString,
  getTodayIsoDate,
} from '../../utils/dateDisplay';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import FormMessage from '../../components/FormMessage';
import TextButton from '../../components/TextButton';
import SegmentedControl from '../../components/SegmentedControl';
import IconBadge from '../../components/IconBadge';
import ListItem from '../../components/ListItem';
import ScreenHeader from '../../components/ScreenHeader';

const TYPE_OPTIONS = [
  { label: 'Personal', value: 'personal' },
  { label: 'Group', value: 'group' },
];

// docs/ui/design-system.md Section 7.8 / ADR 0003's 2026-08-10 "Debit/Credit
// Entry Type" Amendment, Part A — "Debit"/"Credit" are UI-only option
// labels; the underlying values are the transaction's existing
// `type: 'expense' | 'income'` field. This is NOT a new `entryType` field.
const ENTRY_TYPE_OPTIONS = [
  { label: 'Debit', value: 'expense' },
  { label: 'Credit', value: 'income' },
];

// docs/ui/design-system.md Section 7.2 — values match the derivation in
// docs/decisions/0003-payment-mode-and-date-tracking.md exactly.
const PAYMENT_MODE_OPTIONS = [
  { label: 'Cash', value: 'cash' },
  { label: 'Online', value: 'online' },
  { label: 'Both', value: 'both' },
];

// `const INCOME_CATEGORY_ID = 'cat-income'` and its
// `categories.find(...)` lookup lived here. **Deleted, not re-pointed**
// (docs/decisions/0018-income-is-not-a-category.md §7): income is not a
// category, so there is nothing to look up — `type` is the discriminator.
//
// The client-side mirror of the income snapshot that replaced it
// (src/utils/incomeCategorySnapshot.js) is **no longer read here either**, as
// of Domain 4's wiring step: `POST /transactions` with `type: 'income'` has
// the server fill `categoryName`/`categoryIconName`/`categoryGlyph`/
// `categoryTone` from its own constants, and those five snapshot fields are
// not request fields at all (api-overview.md §4.2's resolution rule 3). A
// client-side copy of a server constant is exactly the second representation
// that rule exists to prevent, so this form now sends no category for a Credit
// entry and renders whatever comes back. That file is left in place but is now
// unused — flagged in this round's report rather than deleted as a drive-by
// (constitution §20).

// toPaise() (cash/online split comparison, ADR 0003's 2026-08-10 Amendment,
// Part A) was previously a private helper defined in this file. Promoted to
// src/utils/currency.js per docs/decisions/0005-split-add-expense-flow.md
// §5.3, since AdjustSplitScreen.jsx now needs the identical primitive —
// constitution §25: one implementation, not two copies that could drift.

/**
 * Add Expense — root-level modal
 * (docs/architecture/frontend-navigation.md Section 2.4).
 *
 * **Server-backed as of Domain 4's wiring step.** Save is a real
 * `POST /api/v1/transactions` in create mode and a real
 * `PATCH /api/v1/transactions/{id}` in edit mode (docs/api/api-overview.md
 * §4.2/§4.4), through `useTransactions()`; the modal dismisses only once the
 * server has confirmed the write, and a failure keeps the form open with the
 * reason above the Save button and every field intact.
 *
 * Four properties of that wiring are load-bearing and easy to undo by
 * accident:
 *
 * 1. **The edit request is a DIFF, not a serialized form.** §4.4 distinguishes
 *    an absent field ("leave it alone") from an explicit `null` ("clear it"),
 *    so a body naming every field would wipe a note the user never opened.
 *    `utils/transactionRequests.js` builds it; this screen hands over its
 *    intended values and nothing else.
 * 2. **`version` travels with every edit** and a `409 VERSION_CONFLICT` is a
 *    real outcome, not a formality: the store re-reads the row, and the
 *    message tells the user to check their changes and save again.
 * 3. **The five category snapshot fields are the server's.** This form sends
 *    `categoryId` (the leaf) and nothing else about the category; a Credit
 *    entry sends no category at all, because a non-null `categoryId` with
 *    `type: 'income'` is a `400` rather than an ignored field
 *    (docs/decisions/0018-income-is-not-a-category.md §3).
 * 4. **A receipt photo still cannot be uploaded.** The picker and its preview
 *    are unchanged, but there is no signing endpoint, so a newly picked photo
 *    is local-only and the form says so rather than implying it was saved. An
 *    existing receipt can be removed — see the RECEIPT ATTACHMENT note below.
 *
 * CATEGORY field (docs/ui/design-system.md Section 7.6 / ADR 0003's
 * 2026-08-10 Amendment Part C): tapping the trigger toggles open an inline
 * list of up to 4 quick-pick categories — the most-recently-used expense
 * categories first (derived dynamically from real usage, resolved against the
 * live category tree), then the account's own top-level categories in
 * alphabetical order — plus a "Search more" row. **The fill behind the recents was added
 * 2026-10-29** for the Project Owner's "the dropdown directly shows Search
 * more, it doesn't display the existing categories": recents are empty until
 * the first expense exists, and an account always has categories even when it
 * has no history. **Every row is top-level, and the cap came down from 8 to 4
 * on 2026-11-01**, so a parent and its own subcategory can no longer both be
 * listed. The composition is `useCategoryQuickPicks`' (see its note);
 * nothing about the recents themselves changed. Tapping a quick-pick sets
 * it directly with no navigation — with one 2026-10-24 exception: a quick-pick
 * category that still needs a subcategory chosen under it continues straight
 * into CategoryPicker, expanded on that category (see the mandatory-subcategory
 * note below). "Search more" navigates there unconditionally, as it always
 * has. Both paths go through `openCategoryPicker`, which is also where the
 * picker's two new params are supplied; CategoryPicker returns here via
 * navigation.popTo('AddExpense', { selectedCategory }, { merge: true }) — see
 * the route.params effect below for why `popTo` (not `navigate`) is required to
 * avoid the state-loss bug documented in ADR 0003's 2026-08-10 Amendment, Part
 * D, and CategoryPickerScreen's own note for why the merge flag is not
 * optional.
 *
 * DATE, GROUP, and PAYMENT MODE fields were added per
 * docs/decisions/0003-payment-mode-and-date-tracking.md /
 * docs/ui/design-system.md Section 7:
 * - DATE replaces the old Today/Yesterday/2-Days-Ago SegmentedControl with
 *   a real native date picker (@react-native-community/datetimepicker),
 *   storing an ISO `YYYY-MM-DD` string.
 * - GROUP (visible only when TYPE is Group) opens an in-place list of
 *   `useGroups().groups` directly within this modal — deliberately NOT a
 *   new pushed navigation route (ADR 0003 Section 7.3), unlike CATEGORY's
 *   "Search more" path.
 * - PAYMENT MODE (visible only when useSettingsStore().paymentModeEnabled)
 *   is the last field before Save. When set to 'both', CASH AMOUNT/ONLINE
 *   AMOUNT fields appear directly below it (ADR 0003's 2026-08-10 Amendment,
 *   Part A) with a hard, blocking validation rule — see handleSave.
 *
 * Cancel (design-system.md Section 7.7): lives in this screen's own
 * ScreenHeader (`onClose`), not a bottom text link — RootNavigator.jsx gives
 * this route `headerShown: false` so this is the only header rendered.
 *
 * ENTRY TYPE (docs/ui/design-system.md Section 7.8 / ADR 0003's 2026-08-10
 * "Debit/Credit Entry Type" Amendment): a Debit/Credit SegmentedControl,
 * first field in the form, bound to the transaction's existing
 * `type: 'expense' | 'income'` field — NOT a new `entryType` field. Debit
 * keeps CATEGORY required and visible exactly as before; Credit removes
 * CATEGORY from the layout entirely (not disabled), and the saved record's
 * category/iconName/glyph/tone/parentCategoryName come from the single
 * documented mirror of the server's income snapshot constants
 * (src/utils/incomeCategorySnapshot.js) rather than from any category at all —
 * income is not a category (docs/decisions/0018-income-is-not-a-category.md).
 * See handleSave.
 *
 * A selected category renders as its full path — `Food > Lunch`, through
 * `formatCategoryPath` — in the trigger and in the recent list, and the
 * transaction snapshots `parentCategoryName` alongside the leaf's own name
 * (docs/decisions/0019-subcategories-one-optional-level.md §5/§10.3). **Path
 * rendering never consults the subcategories preference** (§6.2): a transaction
 * tagged to a subcategory shows `Food > Lunch` with the toggle off too.
 *
 * ---
 * **A SUBCATEGORY IS MANDATORY WHILE THE PREFERENCE IS ON** (Project Owner
 * addendum, 2026-10-24). Picking a main category that *has* subcategories is an
 * unfinished choice: this form cannot be saved on it, and says so.
 *
 * The rule itself is one call — `useCategories().needsSubcategorySelection` —
 * and lives there, not here (constitution §8). It is **client-side, and that is
 * the decision rather than a shortcut**: ADR 0019 §6.1 made
 * `subcategoriesEnabled` a UI affordance that gates no endpoint, and the server
 * does not know a given user's toggle state, so there is nothing to enforce
 * server-side without contradicting that ADR. Flagged in the handoff.
 *
 * Three things make it a rule rather than a wall, all required by the addendum:
 *
 * 1. **A main category with no subcategories is selectable on its own**, in one
 *    tap, exactly as before — so turning the preference on cannot block anyone.
 * 2. **The user is taken straight to the subcategories** instead of being left
 *    to find them: tapping a recent category that has children opens
 *    CategoryPicker already expanded on it (`currentSelection`), and the picker
 *    does not offer such a parent as a selection at all
 *    (`requireSubcategory`). The save-time message is therefore a backstop,
 *    which is where a blocking validation belongs — reachable (back out of the
 *    picker and the chosen parent is still in the field, where the message
 *    explains what is missing) but rarely reached.
 * 3. **An existing transaction's saved category is grandfathered until the user
 *    actually changes it** — see `isCategoryTouched` below. This is what keeps
 *    records written before subcategories existed editable, and it is ADR 0019
 *    §6.2's standing instruction: *"The client must not null the category, must
 *    not fail validation, and must not silently re-tag anything on open."*
 *
 * **This is the one place the round diverges from ADR 0019 §10.2** ("a parent
 * is always a legal selection, even when it has children"), which the addendum
 * overrides for this flow. §10.2's other, architectural constraint — selecting
 * a top-level category must not cost more taps for a parent with no children —
 * is preserved exactly. **`SplitAddExpenseScreen` now shares the picker's
 * presentation but not this rule** (2026-10-29): it passes
 * `requireSubcategory: false` through its own `SPLIT_REQUIRES_SUBCATEGORY`
 * constant, so a subcategory is offered there rather than demanded and §10.2
 * still holds for that flow. Turning it on there is that one constant.
 *
 * NOTES, RECEIPT ATTACHMENT, and edit mode (docs/decisions/
 * 0007-transaction-detail-screen.md Section 6 / design-system.md Section
 * 11.6): an optional `route.params.editingTransactionId` param — same
 * lightweight, backward-compatible pattern already used for NewGroup's
 * returnTo/suggestedName and CategoryPicker's returnTo — switches this
 * screen into edit mode: every field pre-fills from the matching
 * `TransactionResponse` held in useTransactionsStore (lazy useState
 * initializers, computed once at mount), the header/Save button copy changes,
 * and handleSave PATCHes instead of POSTing. This is also the fix for the
 * bug that motivated this whole feature: PAYMENT MODE was previously never
 * editable on a split-originated transaction (SplitAddExpenseScreen always
 * wrote 'cash' as an [ASSUMPTION] fallback) — no field is disabled or
 * specially restricted here based on `splitExpenseId`, so editing now
 * corrects it like any other field. NOTES/RECEIPT ATTACHMENT are both
 * optional, never block Save.
 *
 * **RECEIPT ATTACHMENT, precisely, because the halves differ** (ADR 0007 §2,
 * docs/decisions/0020-receipt-upload-cloudinary-signed-direct.md):
 * - *Picking* still uses react-native-image-picker's `launchImageLibrary`
 *   (gallery-only) and still previews the chosen photo — but the picked `uri`
 *   is a **local device path, which is not a `receiptPublicId` and must never
 *   be sent** (§4.1). With no signing endpoint there is nothing to upload it
 *   with, so the form shows a plain note that the photo will not be saved. An
 *   invisible no-op would be worse than an honest one.
 * - *Removing* an existing receipt is a real, supported edit: it sends
 *   `receiptPublicId: null`, the one explicit `null` §4.4 defines for this
 *   field. There is no thumbnail for it here, because a `public_id` cannot be
 *   rendered — reading a receipt needs the signed URL that only
 *   `GET /transactions/{id}` mints, which is Transaction Detail's job.
 *
 * TIME is no longer a field on this form at all (ADR 0007's 2026-08-13
 * "second same-day follow-up" amendment, Part A). There is no user-facing
 * time picker anywhere in this app: `txnTime` is auto-captured from the device
 * clock via `getCurrentTimeString()`, called inline in handleSave's
 * create-mode values only — not via mount-time state — so a user who
 * lingers on this form still gets an accurate "when did I actually log
 * this" timestamp. **It is client-supplied on create by contract** (§4.2 —
 * the true creation moment can occur offline, long before the write arrives)
 * and **frozen afterwards**: `PATCH` does not accept it, the request builder
 * has no branch that can add it, and the server ignores the key.
 *
 * Activity log (docs/decisions/0008-activity-log-system.md §2.1): the
 * edit-mode handleSave branch diffs the transaction's prior state against
 * the about-to-be-saved payload via buildTransactionEditActivities and logs
 * one useActivityLogStore entry per meaningfully changed field, after
 * `updateTransaction` has succeeded. Create-mode saves are NOT logged — out
 * of scope per the ADR.
 *
 * **This is now the ONLY place in the app that writes a local activity
 * entry**, and the entries never reach §11.1's feed. Domain 7's wiring step
 * moved split saves and settlements to the server's own fan-out and deleted
 * their client-side builders, but `transaction_edited` has no writer anywhere
 * in the backend (`backend/README.md` §17.8 flag 8, §17.10), so this one
 * stays until that writer exists — at which point this block, the store and
 * the builder all go. See `useActivityLogStore`'s own note.
 */
function AddExpenseScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { transactions, createTransaction, updateTransaction, isSaving } = useTransactions();
  const paymentModeEnabled = useSettingsStore((state) => state.paymentModeEnabled);
  // Server-backed as of Domain 6's wiring step (`GET /api/v1/groups`,
  // api-overview.md §7.1). The hook is the load trigger, so the GROUP field
  // lists real groups; it is cache-first and shared with the Split tab, so
  // opening this modal costs no extra request once that tab has been visited.
  const { groups } = useGroups();
  const addActivities = useActivityLogStore((state) => state.addActivities);
  // **Still nothing is rendered from the category tree** — a transaction
  // renders from its own snapshot and this screen never resolves a category to
  // display one (ADR 0018 §7), which is why `selectedCategory` carries
  // everything the trigger draws. The tree is read for exactly one question,
  // added 2026-10-24: can the chosen category still be narrowed? That cannot be
  // answered from a snapshot, because whether `Food` has children is a fact
  // about the account's categories now, not about the transaction. The answer
  // comes back as a boolean from the hook that owns the rule; no category data
  // crosses into the form's state or its markup.
  const { subcategoriesEnabled, needsSubcategorySelection } = useCategories();
  // Up to 4 top-level rows: recents first, then the account's categories
  // alphabetically — the dropdown is never empty for a signed-in user, and
  // never lists a parent beside its own subcategory (useCategoryQuickPicks).
  const quickPickCategories = useCategoryQuickPicks();
  const styles = createStyles(theme, insets);

  // Edit mode (ADR 0007 §6) — an optional, backward-compatible route param.
  // `editingTransactionId` is stable for this screen's lifetime (it's set
  // once by the caller and never changes while this screen is mounted), so
  // every state field below is safely pre-filled via a lazy useState
  // initializer (invoked once, at mount) rather than a separate effect. If
  // the id doesn't resolve to a real record, `editingTransaction` is null
  // and every field falls back to its normal create-mode default.
  const editingTransactionId = route.params?.editingTransactionId ?? null;
  const editingTransaction = editingTransactionId
    ? (transactions.find((transaction) => transaction.id === editingTransactionId) ?? null)
    : null;

  const [type, setType] = useState(() => editingTransaction?.type ?? 'expense');
  const [amount, setAmount] = useState(() =>
    editingTransaction ? String(editingTransaction.amount) : '',
  );
  const [title, setTitle] = useState(() => editingTransaction?.title ?? '');
  // Pre-filled from the transaction's own frozen snapshot, including its
  // parent's name — so opening Edit on a transaction tagged to a subcategory
  // shows `Food > Lunch` and keeps that assignment if the user never touches
  // the CATEGORY field, **regardless of the subcategories toggle**
  // (docs/decisions/0019-subcategories-one-optional-level.md §6.2). Nothing is
  // nulled and nothing is silently re-tagged; only opening the picker and
  // choosing something else can move it.
  //
  // This is also the shape the mandatory-subcategory rule has to tolerate: no
  // `subcategories` array, and an `id` that is the record's own `categoryId`
  // rather than a live tree row's. `parentCategoryName` is `null` on a
  // top-level tagging, which is exactly why the rule resolves a selection
  // against the live tree by name pair rather than trusting the snapshot
  // (utils/categories.requiresSubcategorySelection).
  //
  // **`id` is carried deliberately: it is the only thing `PATCH` can send
  // about a category** (§4.4 takes `categoryId`, never a name), and a
  // reference whose id is the *snapshot's* source row is what makes
  // "the user edited the amount and never opened the picker" produce no
  // `categoryId` key at all. `categoryId` is `null` for income, which is
  // consistent with this branch not running for one.
  const [selectedCategory, setSelectedCategory] = useState(() =>
    editingTransaction && editingTransaction.type === 'expense'
      ? {
          id: editingTransaction.categoryId,
          name: editingTransaction.categoryName,
          iconName: editingTransaction.categoryIconName,
          glyph: editingTransaction.categoryGlyph,
          parentCategoryName: editingTransaction.parentCategoryName ?? null,
        }
      : null,
  );
  const [isCategoryListOpen, setIsCategoryListOpen] = useState(false);
  // Whether the user has changed the CATEGORY field during THIS visit, as
  // opposed to merely having it pre-filled from the record being edited. It is
  // the only thing that distinguishes "this transaction has always been tagged
  // to Food" from "the user just chose Food", and the mandatory-subcategory
  // rule has to treat those differently or every record saved before
  // subcategories existed becomes unsavable the moment its category gains a
  // child (ADR 0019 §6.2 — "must not fail validation"). Create mode never
  // grandfathers anything, because there is no prior assignment to preserve.
  const [isCategoryTouched, setIsCategoryTouched] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    () => editingTransaction?.txnDate ?? getTodayIsoDate(),
  );
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [scope, setScope] = useState(() => editingTransaction?.scope ?? 'personal');
  const [selectedGroup, setSelectedGroup] = useState(() =>
    editingTransaction && editingTransaction.scope === 'group'
      ? (groups.find((group) => group.id === editingTransaction.groupId) ?? null)
      : null,
  );
  const [isGroupListOpen, setIsGroupListOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState(() => editingTransaction?.paymentMode ?? 'cash');
  const [cashAmount, setCashAmount] = useState(() =>
    editingTransaction?.cashAmount != null ? String(editingTransaction.cashAmount) : '',
  );
  const [onlineAmount, setOnlineAmount] = useState(() =>
    editingTransaction?.onlineAmount != null ? String(editingTransaction.onlineAmount) : '',
  );
  const [notes, setNotes] = useState(() => editingTransaction?.notes ?? '');
  // RECEIPT — three pieces of state rather than one, because a stored
  // reference and a freshly picked photo are genuinely different things (see
  // the RECEIPT ATTACHMENT note at the top of this file).
  //
  // `existingReceiptPublicId` is what the server holds; `isReceiptCleared`
  // records that the user removed it (the one receipt edit that is actually
  // supported); `localReceiptUri` is a device path that previews and is never
  // sent anywhere.
  const existingReceiptPublicId = editingTransaction?.receiptPublicId ?? null;
  const [isReceiptCleared, setIsReceiptCleared] = useState(false);
  const [localReceiptUri, setLocalReceiptUri] = useState(null);
  const [errors, setErrors] = useState({});
  // Form-level failure copy for a failed save — the slot ADR 0016 §9.1
  // established on the auth screens, for an error that belongs to no single
  // field (a conflict, a 403, an offline write).
  const [formError, setFormError] = useState(null);

  // Consumes the value returned from CategoryPicker via the "Search more"
  // path (navigation.popTo('AddExpense', { selectedCategory }), see this
  // screen's top-of-file note), then clears it from route.params so
  // re-selecting the same category on a later visit still triggers this
  // effect (the transition goes object -> undefined -> object again rather
  // than staying on the same reference).
  useEffect(() => {
    if (route.params?.selectedCategory) {
      setSelectedCategory(route.params.selectedCategory);
      setIsCategoryTouched(true);
      navigation.setParams({ selectedCategory: undefined });
      setErrors((prev) => (prev.category ? { ...prev, category: undefined } : prev));
    }
  }, [route.params?.selectedCategory, navigation]);

  function handleCancel() {
    navigation.goBack();
  }

  function handleDateChange(event, date) {
    setIsDatePickerVisible(false);
    if (event.type === 'set' && date) {
      setSelectedDate(toIsoDateString(date));
    }
  }

  // Gallery-only picking (ADR 0007 §2 — camera capture explicitly excluded
  // this round). Stores the picked asset's local `uri` only — not
  // includeBase64 — mirroring the ADR's exact API/usage shape.
  //
  // **The picked uri is preview-only and is never sent.** TODO (blocked on
  // `POST /receipts/upload-signature`, ADR 0020): upload the picked asset
  // directly to Cloudinary with the server's signed params and send the
  // returned `public_id` as `receiptPublicId`.
  function handlePickReceipt() {
    launchImageLibrary({ mediaType: 'photo', selectionLimit: 1 }, (response) => {
      if (response.didCancel || response.errorCode) {
        return;
      }
      const pickedUri = response.assets?.[0]?.uri;
      if (pickedUri) {
        setLocalReceiptUri(pickedUri);
      }
    });
  }

  /**
   * Removes whichever receipt the field is showing.
   *
   * A locally picked photo is simply dropped — nothing was ever attached. An
   * existing, stored receipt is marked cleared, which becomes the one explicit
   * `receiptPublicId: null` §4.4 defines, applied when Save runs rather than
   * immediately: Cancel must leave the record untouched.
   */
  function handleRemoveReceipt() {
    if (localReceiptUri) {
      setLocalReceiptUri(null);
      return;
    }
    setIsReceiptCleared(true);
  }

  /**
   * Opens the shared Category Picker, telling it what this form needs and what
   * it already holds (see CategoryPickerScreen's two route-param notes).
   *
   * `requireSubcategory` is passed as the preference's own value rather than a
   * bare `true` so the intent is readable at the call site; the picker ANDs it
   * with the preference again on its side, which is harmless — both read the
   * same store.
   *
   * @param {object | null} selection What the CATEGORY field currently holds.
   */
  function openCategoryPicker(selection) {
    setIsCategoryListOpen(false);
    navigation.navigate('CategoryPicker', {
      // The picker's own default, passed explicitly now that this call site
      // sends siblings — relying on the default next to them would read like
      // an omission.
      returnTo: 'AddExpense',
      requireSubcategory: subcategoriesEnabled,
      // A name pair, not the object: the picker resolves it against the live
      // tree, and an edit-mode prefill has no id to send.
      currentSelection: selection
        ? { name: selection.name, parentCategoryName: selection.parentCategoryName ?? null }
        : null,
    });
  }

  function handleSelectQuickPickCategory(category) {
    setSelectedCategory(category);
    setIsCategoryTouched(true);
    setIsCategoryListOpen(false);
    if (errors.category) {
      setErrors((prev) => ({ ...prev, category: undefined }));
    }

    // "The user selects a main category, the app then immediately shows that
    // category's subcategories to choose from" — the addendum's wording,
    // applied to the one surface that can still hand over an unfinished
    // choice. The quick-pick list offers top-level categories (recently used or
    // not), so it can hand over a category that has subcategories.
    //
    // The parent is set first and deliberately kept: backing out of the picker
    // leaves it in the field, where the save-time message can name it, rather
    // than silently discarding what the user tapped.
    if (needsSubcategorySelection(category)) {
      openCategoryPicker(category);
    }
  }

  function handleOpenCategoryPicker() {
    openCategoryPicker(selectedCategory);
  }

  function handleSelectGroup(group) {
    setSelectedGroup(group);
    setIsGroupListOpen(false);
    if (errors.group) {
      setErrors((prev) => ({ ...prev, group: undefined }));
    }
  }

  /**
   * Drops a field's validation message the moment the user acts on that field,
   * which CATEGORY and GROUP above already did and the typed fields did not.
   *
   * Without this a corrected field keeps its red message until the next Save
   * press, so the form reads as still invalid after the user has fixed it —
   * the "I can't save this" half that no amount of re-pressing explains
   * (constitution §22: a message must describe the state the user is actually
   * in). Nothing about validation itself changes: `handleSave` recomputes every
   * rule from scratch on each press and is the only thing that can block a
   * save.
   *
   * @param {'title'} field
   */
  function clearFieldError(field) {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  /**
   * AMOUNT, CASH AMOUNT and ONLINE AMOUNT clear as a group, because they are
   * validated as one rule: the "Cash + Online must equal the total amount."
   * message is raised against ONLINE AMOUNT but is a statement about all three,
   * so editing any one of them is what makes it stale.
   */
  function clearMoneyErrors() {
    setErrors((prev) =>
      prev.amount || prev.cashAmount || prev.onlineAmount
        ? { ...prev, amount: undefined, cashAmount: undefined, onlineAmount: undefined }
        : prev,
    );
  }

  /**
   * Whether the CATEGORY field is still too broad to save — the mandatory rule,
   * with its one exemption applied.
   *
   * The rule lives in `useCategories()`; all this adds is the grandfathering
   * clause. A record being edited keeps the category it already had until the
   * user changes it, which covers both halves of the addendum's legacy case:
   * a transaction saved before subcategories existed opens, displays its path
   * and saves unchanged, and so does one whose category has since gained
   * children. The instant the user picks something new (`isCategoryTouched`),
   * the full rule applies to that new choice.
   *
   * Derived on every render rather than computed inside handleSave, so the
   * dependency on the live tree is visible in one place.
   */
  const isGrandfatheredCategory = Boolean(editingTransaction) && !isCategoryTouched;
  const mustChooseSubcategory =
    !isGrandfatheredCategory && needsSubcategorySelection(selectedCategory);

  /**
   * Whether the RECEIPT ATTACHMENT field should show "a receipt is attached":
   * the record has one and the user has not removed it during this visit.
   * A freshly picked local photo takes precedence in the markup, since that is
   * what the user is looking at.
   */
  const hasStoredReceipt = Boolean(existingReceiptPublicId) && !isReceiptCleared;

  async function handleSave() {
    const parsedAmount = parseFloat(amount);
    const isAmountValid = amount !== '' && !Number.isNaN(parsedAmount) && parsedAmount > 0;
    const nextErrors = {};

    if (!isAmountValid) {
      nextErrors.amount = 'Enter an amount greater than 0.';
    }
    if (!title.trim()) {
      nextErrors.title = 'Enter a name for this expense.';
    }
    // Category is only required for Debit (type === 'expense') entries —
    // Credit (type === 'income') entries have no CATEGORY field at all, per
    // ADR 0003's 2026-08-10 "Debit/Credit Entry Type" Amendment, Part B.
    if (type === 'expense' && !selectedCategory) {
      nextErrors.category = 'Select a category.';
    } else if (type === 'expense' && mustChooseSubcategory) {
      // Names the category so the message is actionable rather than a rule
      // recital, and the CATEGORY field directly above it is the way to fix it
      // (constitution §22). Only reachable when the preference is on, the
      // chosen category has subcategories, and the user chose it during this
      // visit — see `mustChooseSubcategory` above.
      nextErrors.category = `Choose a subcategory of ${selectedCategory.name}.`;
    }
    if (scope === 'group' && !selectedGroup) {
      nextErrors.group = 'Select a group.';
    }

    // Cash/Online split validation — docs/decisions/0003-payment-mode-and-date-tracking.md's
    // 2026-08-10 Amendment, Part A / design-system.md Section 7.2. This
    // block only runs once AMOUNT itself is valid — if AMOUNT is invalid,
    // only AMOUNT's own error above shows; there's no valid total yet to
    // validate the split against.
    const isBothPaymentMode = paymentModeEnabled && paymentMode === 'both';
    let parsedCashAmount = null;
    let parsedOnlineAmount = null;

    if (isBothPaymentMode && isAmountValid) {
      parsedCashAmount = parseFloat(cashAmount);
      parsedOnlineAmount = parseFloat(onlineAmount);
      const isCashValid =
        cashAmount !== '' && !Number.isNaN(parsedCashAmount) && parsedCashAmount >= 0;
      const isOnlineValid =
        onlineAmount !== '' && !Number.isNaN(parsedOnlineAmount) && parsedOnlineAmount >= 0;

      if (!isCashValid) {
        nextErrors.cashAmount = 'Enter a cash amount.';
      }
      if (!isOnlineValid) {
        nextErrors.onlineAmount = 'Enter an online amount.';
      }

      // Paise-granularity comparison — never raw decimal `===`/`!==` (ADR
      // 0003's explicit floating-point correctness note).
      if (
        isCashValid &&
        isOnlineValid &&
        toPaise(parsedCashAmount) + toPaise(parsedOnlineAmount) !== toPaise(parsedAmount)
      ) {
        nextErrors.onlineAmount = 'Cash + Online must equal the total amount.';
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      // **Says that the press was refused, at the button that was pressed**
      // (constitution §22 — a failure must be meaningful and must offer a way
      // out). Every field error above is rendered against its own field, and on
      // this form that can be far off the top of the screen: AMOUNT, EXPENSE
      // NAME and CATEGORY all sit above DATE, TYPE, PAYMENT MODE and the
      // CASH/ONLINE pair, so a user filling in a cash+online split sees Save do
      // nothing at all and has no reason to scroll back. The per-field copy
      // stays the actionable part; this only points at it.
      setFormError('Some details still need fixing — check the highlighted fields above.');
      return;
    }

    setErrors({});
    setFormError(null);

    const isCredit = type === 'income';

    /**
     * The form's intended values, in **the API's own field names** (§4.1), so
     * the request builder and the Activity Log diff both read one object with
     * no translation in the middle.
     *
     * Two of these keys are display-only and are never part of a request
     * body: `categoryName` and `parentCategoryName`. They exist here for the
     * Activity Log, which has to name the category the way the user saw it.
     * **All five category snapshot fields are server-authoritative** (§4.2's
     * resolution rule 3): the request carries `categoryId` and nothing else
     * about the category, and the server derives the rest — including
     * `categoryTone`, which follows `type` and never the category, which is
     * why no tone is computed anywhere on this screen any more.
     *
     * For a Credit entry `categoryId` is `null`: income references no
     * category, the field is not even rendered, and a non-null value sent
     * with `type: 'income'` is a `400` rather than an ignored field
     * (docs/decisions/0018-income-is-not-a-category.md §3).
     */
    const intendedValues = {
      title: title.trim(),
      txnDate: selectedDate,
      amount: parsedAmount,
      type,
      categoryId: isCredit ? null : (selectedCategory.id ?? null),
      categoryName: isCredit ? null : selectedCategory.name,
      parentCategoryName: isCredit ? null : (selectedCategory.parentCategoryName ?? null),
      // Display-only, like the two above: the offline overlay renders a queued
      // row from them before the server has frozen its own snapshot
      // (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.8).
      // Never part of a request body.
      categoryIconName: isCredit ? null : (selectedCategory.iconName ?? null),
      categoryGlyph: isCredit ? null : (selectedCategory.glyph ?? null),
      scope,
      groupId: scope === 'group' ? selectedGroup.id : null,
      // When the Payment Mode setting is off, the field isn't shown at all
      // (design-system.md Section 7.2) and the ADR doesn't specify a value
      // for that case — 'cash' is used as a sensible default, matching the
      // field's own pre-selected default when it IS shown. [ASSUMPTION],
      // flagged in this round's report. The server requires a value either
      // way: `paymentMode` is not optional on §4.2.
      paymentMode: paymentModeEnabled ? paymentMode : 'cash',
      // Non-null iff `paymentMode` is 'both', which is exactly the contract's
      // own rule (§4.2, re-validated server-side at paise granularity). The
      // request builder is what decides whether they travel.
      cashAmount: isBothPaymentMode ? parsedCashAmount : null,
      onlineAmount: isBothPaymentMode ? parsedOnlineAmount : null,
      notes: notes.trim() ? notes.trim() : null,
      // Only ever the stored reference or `null` — never the locally picked
      // uri, which is not a `receiptPublicId` and cannot be uploaded yet.
      receiptPublicId: isReceiptCleared ? null : existingReceiptPublicId,
    };

    if (editingTransactionId) {
      // Activity log (ADR 0008 §2.1) — diffed against the pre-edit record
      // BEFORE the write, so `oldTransaction` is still the old state, but
      // **recorded only once the server has confirmed the update**. Logging
      // first would leave an activity trail describing an edit that never
      // happened — a failed PATCH changes nothing server-side. Logs zero
      // entries (no-op) if the user opened Edit and hit Save without changing
      // anything, which is also the case the store answers without a request.
      const activities = buildTransactionEditActivities({
        transactionId: editingTransactionId,
        oldTransaction: editingTransaction,
        newFields: intendedValues,
        groups,
      });

      const result = await updateTransaction(editingTransactionId, intendedValues);
      if (!result.success) {
        // `error` is null only when the session itself ended, in which case
        // this screen is being torn down and a message would flash for
        // nothing (errorMessages.js's isSessionTerminalError note). A
        // `409 VERSION_CONFLICT` has already re-read the row, so its copy's
        // "check your changes and save again" is advice the user can follow.
        setFormError(result.error);
        return;
      }
      if (activities.length > 0) {
        addActivities(activities);
      }
    } else {
      const result = await createTransaction({
        ...intendedValues,
        // Auto-captured at the moment of save (ADR 0007's 2026-08-13
        // amendment, Part A) — not from mount-time state, and create-only:
        // `txnTime` is frozen afterwards (§4.4).
        txnTime: getCurrentTimeString(),
      });
      if (!result.success) {
        setFormError(result.error);
        return;
      }
    }

    // Dismisses this modal only once the write is confirmed, returning to
    // whichever screen (Dashboard, or Transaction Detail via Edit) was
    // underneath — the standard modal-dismiss pattern, symmetric with Cancel
    // in the header. Dismissing before the server answered would show the
    // user a saved expense that is not saved.
    navigation.goBack();
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title={editingTransactionId ? 'Edit Expense' : 'Add Expense'}
        onClose={handleCancel}
      />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={styles.card}>
          <Text style={styles.label}>ENTRY TYPE</Text>
          <SegmentedControl
            options={ENTRY_TYPE_OPTIONS}
            value={type}
            onChange={setType}
            style={styles.entryTypeControl}
          />

          <TextInput
            label="AMOUNT"
            value={amount}
            onChangeText={(value) => {
              setAmount(value);
              clearMoneyErrors();
            }}
            placeholder="0.00"
            keyboardType="decimal-pad"
            error={errors.amount}
          />

          <TextInput
            label="EXPENSE NAME"
            value={title}
            onChangeText={(value) => {
              setTitle(value);
              clearFieldError('title');
            }}
            placeholder="e.g. Artisan Coffee"
            error={errors.title}
          />

          {type === 'expense' ? (
            <View style={styles.categoryContainer}>
              <Text style={styles.label}>CATEGORY</Text>
              <Pressable
                style={styles.categoryField}
                onPress={() => setIsCategoryListOpen((prev) => !prev)}
                accessibilityRole="button"
              >
                {selectedCategory ? (
                  <>
                    <IconBadge
                      glyph={selectedCategory.glyph}
                      tone="accent"
                      size="small"
                      style={styles.categoryIcon}
                    />
                    <Text style={styles.categoryText}>
                      {formatCategoryPath(
                        selectedCategory.parentCategoryName,
                        selectedCategory.name,
                      )}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.categoryPlaceholder}>Select a category</Text>
                )}
              </Pressable>
              {errors.category ? <Text style={styles.errorText}>{errors.category}</Text> : null}

              {isCategoryListOpen ? (
                <View style={styles.categoryList}>
                  {quickPickCategories.map((category) => (
                    <ListItem
                      key={category.id}
                      leading={<IconBadge glyph={category.glyph} tone="accent" size="small" />}
                      // Through the shared path helper like the trigger above,
                      // so one function decides how a category reads anywhere
                      // (ADR 0019 §3/§10.3). Quick-pick rows are all top-level
                      // as of 2026-11-01, so this renders a bare name here —
                      // the helper's documented null-parent case.
                      title={formatCategoryPath(category.parentCategoryName, category.name)}
                      onPress={() => handleSelectQuickPickCategory(category)}
                    />
                  ))}
                  <ListItem
                    title="Search more"
                    onPress={handleOpenCategoryPicker}
                    style={styles.searchMoreItem}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.dateContainer}>
            <Text style={styles.label}>DATE</Text>
            <Pressable
              style={styles.categoryField}
              onPress={() => setIsDatePickerVisible(true)}
              accessibilityRole="button"
            >
              {/* Real icon library (react-native-vector-icons/Ionicons,
                  docs/decisions/0002-icon-library-selection.md) is still not
                  installed/linked in this codebase — this Text glyph is a
                  placeholder standing in for `calendar-outline`
                  (design-system.md Section 6), matching the same
                  glyph-fallback convention already used by ScreenHeader
                  (←/✕) and MainTabs (₹/⇄/P). Swap for a real <Icon> once
                  the library is actually wired in. */}
              <Text style={styles.dateIcon}>▦</Text>
              <Text style={styles.categoryText}>{getDateDisplayLabel(selectedDate)}</Text>
            </Pressable>
          </View>

          {isDatePickerVisible ? (
            <DateTimePicker
              value={parseIsoDate(selectedDate)}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              maximumDate={new Date()}
              onChange={handleDateChange}
            />
          ) : null}

          <Text style={[styles.label, styles.sectionSpacing]}>TYPE</Text>
          <SegmentedControl options={TYPE_OPTIONS} value={scope} onChange={setScope} />

          {scope === 'group' ? (
            <View style={styles.groupContainer}>
              <Text style={styles.label}>GROUP</Text>
              <Pressable
                style={styles.categoryField}
                onPress={() => {
                  if (groups.length > 0) {
                    setIsGroupListOpen((prev) => !prev);
                  }
                }}
                accessibilityRole="button"
              >
                {selectedGroup ? (
                  <Text style={styles.categoryText}>{selectedGroup.name}</Text>
                ) : (
                  <Text style={styles.categoryPlaceholder}>
                    {groups.length === 0 ? 'No groups yet' : 'Select a group'}
                  </Text>
                )}
              </Pressable>
              {errors.group ? <Text style={styles.errorText}>{errors.group}</Text> : null}

              {isGroupListOpen && groups.length > 0 ? (
                <View style={styles.groupList}>
                  {groups.map((group) => (
                    <ListItem
                      key={group.id}
                      title={group.name}
                      onPress={() => handleSelectGroup(group)}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {paymentModeEnabled ? (
            <>
              <Text style={[styles.label, styles.sectionSpacing]}>PAYMENT MODE</Text>
              <SegmentedControl
                options={PAYMENT_MODE_OPTIONS}
                value={paymentMode}
                onChange={setPaymentMode}
              />

              {paymentMode === 'both' ? (
                <>
                  <TextInput
                    label="CASH AMOUNT"
                    value={cashAmount}
                    onChangeText={(value) => {
                      setCashAmount(value);
                      clearMoneyErrors();
                    }}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    error={errors.cashAmount}
                    style={styles.splitAmountField}
                  />
                  <TextInput
                    label="ONLINE AMOUNT"
                    value={onlineAmount}
                    onChangeText={(value) => {
                      setOnlineAmount(value);
                      clearMoneyErrors();
                    }}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    error={errors.onlineAmount}
                  />
                </>
              ) : null}
            </>
          ) : null}

          <TextInput
            label="NOTES"
            value={notes}
            onChangeText={setNotes}
            placeholder="Add any additional details..."
            multiline
            style={styles.notesField}
          />

          <View style={styles.receiptContainer}>
            <Text style={styles.label}>RECEIPT ATTACHMENT</Text>
            {localReceiptUri ? (
              <>
                <View style={styles.receiptSelectedRow}>
                  <Image source={{ uri: localReceiptUri }} style={styles.receiptThumbnail} />
                  <TextButton label="Remove" tone="negative" onPress={handleRemoveReceipt} inline />
                </View>
                {/* Honest rather than silent (constitution §22, ADR 0020 §5's
                    "the client tells the user the photo was not attached"):
                    there is no upload endpoint yet, so this photo previews and
                    nothing more. Letting Save appear to store it would be the
                    worse failure — the user would delete the original. */}
                <Text style={styles.receiptNote}>
                  Receipt photos can&apos;t be uploaded yet, so this one won&apos;t be saved with
                  the expense.
                </Text>
              </>
            ) : hasStoredReceipt ? (
              // An existing, stored receipt. No thumbnail: `receiptPublicId` is
              // a Cloudinary reference, not a URL, and the signed URL that can
              // render it is minted only by `GET /transactions/{id}` — so the
              // image lives on Transaction Detail and this field offers the one
              // edit that is actually supported.
              <View style={styles.receiptSelectedRow}>
                <Text style={styles.categoryText}>Receipt attached</Text>
                <TextButton label="Remove" tone="negative" onPress={handleRemoveReceipt} inline />
              </View>
            ) : (
              <Pressable
                style={styles.categoryField}
                onPress={handlePickReceipt}
                accessibilityRole="button"
              >
                {/* Placeholder Text glyph standing in for `camera-outline`
                    (design-system.md Section 6/11) — same glyph-fallback
                    convention as the other trigger-field icons above. */}
                <Text style={styles.dateIcon}>▤</Text>
                <Text style={styles.categoryPlaceholder}>Add a photo of your receipt</Text>
              </Pressable>
            )}
            {isReceiptCleared && !localReceiptUri && existingReceiptPublicId ? (
              <Text style={styles.receiptNote}>
                The attached receipt will be removed when you save.
              </Text>
            ) : null}
          </View>
        </Card>

        {/* Form-level failure: a conflict, a rejected group write, an offline
            save. Belongs to no single field, so it gets the slot directly
            above the primary action (ADR 0016 §9.1). */}
        <FormMessage message={formError} />

        <PrimaryButton
          label={editingTransactionId ? 'Save Changes' : 'Save Expense'}
          onPress={handleSave}
          // The existing `loading`/`disabled` props, exactly as the auth
          // screens use them — one confirmed write per press, and no second
          // POST from an impatient double tap (ADR 0016 §9.1; no component
          // change is needed for this).
          loading={isSaving}
          disabled={isSaving}
          style={styles.saveButton}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(theme, insets) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.xxl,
      // No tab bar over this modal, so nothing from theme/layout.js applies
      // here — but the Save button at the end of this form is still the
      // last thing above the bottom system bar, so the designed 24px of
      // trailing space is measured from the top of that bar rather than
      // from the physical screen edge. `insets.bottom` is 0 where there is
      // no bar, leaving the original spacing exactly as designed.
      paddingBottom: theme.space.xxl + insets.bottom,
    },
    card: {
      marginBottom: theme.space.xl,
    },
    label: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      lineHeight: theme.type.label.lineHeight,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    sectionSpacing: {
      marginTop: theme.space.md,
    },
    // Gap below the ENTRY TYPE SegmentedControl before AMOUNT, matching the
    // standalone 16px (space.lg) inter-field gap already used elsewhere on
    // this screen (e.g. AMOUNT -> EXPENSE NAME, produced by TextInput's own
    // container marginBottom).
    entryTypeControl: {
      marginBottom: theme.space.lg,
    },
    categoryContainer: {
      marginBottom: theme.space.lg,
    },
    categoryField: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      paddingBottom: theme.space.sm,
      minHeight: 40,
    },
    categoryIcon: {
      marginRight: theme.space.sm,
    },
    categoryText: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    categoryPlaceholder: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.bodyLg.fontSize,
    },
    categoryList: {
      marginTop: theme.space.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
      paddingBottom: theme.space.sm,
    },
    searchMoreItem: {
      borderTopWidth: 1,
      borderTopColor: theme.color.border.subtle,
      marginTop: theme.space.xs,
      paddingTop: theme.space.sm,
    },
    errorText: {
      color: theme.color.status.negative,
      fontSize: theme.type.caption.fontSize,
      marginTop: theme.space.xs,
    },
    dateContainer: {
      marginTop: theme.space.md,
      marginBottom: theme.space.lg,
    },
    dateIcon: {
      color: theme.color.text.tertiary,
      fontSize: 16,
      marginRight: theme.space.sm,
    },
    groupContainer: {
      marginTop: theme.space.md,
      marginBottom: theme.space.lg,
    },
    groupList: {
      marginTop: theme.space.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
      paddingBottom: theme.space.sm,
    },
    splitAmountField: {
      marginTop: theme.space.md,
    },
    notesField: {
      marginTop: theme.space.md,
    },
    receiptContainer: {
      marginTop: theme.space.md,
      marginBottom: theme.space.lg,
    },
    receiptSelectedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
    },
    receiptThumbnail: {
      width: 64,
      height: 64,
      borderRadius: theme.radius.md,
    },
    // A plain informational line under the receipt field — `text.tertiary` at
    // caption size, the same treatment the other non-error hints on this form
    // use. Deliberately not `status.negative`: nothing has gone wrong, and a
    // red line next to a photo the user just picked would read as a rejection.
    receiptNote: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.caption.lineHeight,
      marginTop: theme.space.sm,
    },
    saveButton: {
      marginTop: theme.space.md,
      marginBottom: theme.space.lg,
    },
  });
}

export default AddExpenseScreen;
