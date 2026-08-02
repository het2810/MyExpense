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
import { useTheme } from '../../theme/useTheme';
import { useTransactionsStore } from '../../store/useTransactionsStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useGroupsStore } from '../../store/useGroupsStore';
import { useActivityLogStore } from '../../store/useActivityLogStore';
import { useCategoriesStore } from '../../store/useCategoriesStore';
import { useRecentCategories } from '../../hooks/useRecentCategories';
import { toPaise } from '../../utils/currency';
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

// Fixed category/icon values for credit (type: 'income') saves — resolved
// from useCategoriesStore's existing cat-income entry (looked up inside the
// component, since the category list now lives in a Zustand store rather
// than a static module-level array) rather than re-typed as literals here,
// per ADR 0003's 2026-08-10 "Debit/Credit Entry Type" Amendment, Part B.
const INCOME_CATEGORY_ID = 'cat-income';

// toPaise() (cash/online split comparison, ADR 0003's 2026-08-10 Amendment,
// Part A) was previously a private helper defined in this file. Promoted to
// src/utils/currency.js per docs/decisions/0005-split-add-expense-flow.md
// §5.3, since AdjustSplitScreen.jsx now needs the identical primitive —
// constitution §25: one implementation, not two copies that could drift.

/**
 * Add Expense — root-level modal
 * (docs/architecture/frontend-navigation.md Section 2.4). Mock data only:
 * saves into useTransactionsStore, which feeds DashboardScreen's Recent
 * Transactions list reactively. There is no expense API yet — nothing here
 * makes a network call.
 *
 * CATEGORY field (docs/ui/design-system.md Section 7.6 / ADR 0003's
 * 2026-08-10 Amendment Part C): tapping the trigger toggles open an inline
 * list of the 3 most-recently-used expense categories (derived dynamically
 * via useRecentCategories — NOT categoryMocks.js's static recentCategoryIds,
 * which is a different list left alone for CategoryPickerScreen's own use)
 * plus a "Search more" row. Tapping a recent category sets it directly with
 * no navigation. Only "Search more" still navigates to CategoryPicker
 * (navigation.navigate('CategoryPicker')); CategoryPicker returns here via
 * navigation.popTo('AddExpense', { selectedCategory }) — see the route.params
 * effect below for why `popTo` (not `navigate`) is required to avoid the
 * state-loss bug documented in ADR 0003's 2026-08-10 Amendment, Part D.
 *
 * DATE, GROUP, and PAYMENT MODE fields were added per
 * docs/decisions/0003-payment-mode-and-date-tracking.md /
 * docs/ui/design-system.md Section 7:
 * - DATE replaces the old Today/Yesterday/2-Days-Ago SegmentedControl with
 *   a real native date picker (@react-native-community/datetimepicker),
 *   storing an ISO `YYYY-MM-DD` string.
 * - GROUP (visible only when TYPE is Group) opens an in-place list of
 *   useGroupsStore().groups directly within this modal — deliberately NOT a
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
 * CATEGORY from the layout entirely (not disabled) and the saved record's
 * category/iconName/glyph/tone resolve to fixed cat-income-derived values
 * instead of a user selection — see handleSave.
 *
 * NOTES, RECEIPT ATTACHMENT, and edit mode (docs/decisions/
 * 0007-transaction-detail-screen.md Section 6 / design-system.md Section
 * 11.6): an optional `route.params.editingTransactionId` param — same
 * lightweight, backward-compatible pattern already used for NewGroup's
 * returnTo/suggestedName and CategoryPicker's returnTo — switches this
 * screen into edit mode: every field pre-fills from the matching
 * useTransactionsStore record (lazy useState initializers, computed once at
 * mount), the header/Save button copy changes, and handleSave calls
 * updateTransaction instead of addTransaction. This is also the fix for the
 * bug that motivated this whole feature: PAYMENT MODE was previously never
 * editable on a split-originated transaction (SplitAddExpenseScreen always
 * wrote 'cash' as an [ASSUMPTION] fallback) — no field is disabled or
 * specially restricted here based on `splitExpenseId`, so editing now
 * corrects it like any other field. NOTES/RECEIPT ATTACHMENT are both
 * optional, never block Save. Receipt picking uses
 * react-native-image-picker's launchImageLibrary (gallery-only — ADR 0007
 * §2), storing the picked asset's local `uri` as `receiptUri`.
 *
 * TIME is no longer a field on this form at all (ADR 0007's 2026-08-13
 * "second same-day follow-up" amendment, Part A). There is no user-facing
 * time picker anywhere in this app: `time` is auto-captured from the device
 * clock via `getCurrentTimeString()`, called inline in handleSave's
 * create-mode payload only — not via mount-time state — so a user who
 * lingers on this form still gets an accurate "when did I actually log
 * this" timestamp. On edit, `time` is left untouched: the edit-mode payload
 * simply never includes a `time` key, and updateTransaction's existing
 * merge semantics preserve the prior stored value automatically — no
 * special-case code is needed.
 *
 * Activity log (docs/decisions/0008-activity-log-system.md §2.1): the
 * edit-mode handleSave branch diffs the transaction's prior state against
 * the about-to-be-saved payload via buildTransactionEditActivities and logs
 * one useActivityLogStore entry per meaningfully changed field, before
 * calling updateTransaction. Create-mode saves are NOT logged — out of
 * scope per the ADR (only transaction edits, split saves, and group
 * creation are logged this round).
 */
function AddExpenseScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const addTransaction = useTransactionsStore((state) => state.addTransaction);
  const updateTransaction = useTransactionsStore((state) => state.updateTransaction);
  const transactions = useTransactionsStore((state) => state.transactions);
  const paymentModeEnabled = useSettingsStore((state) => state.paymentModeEnabled);
  const groups = useGroupsStore((state) => state.groups);
  const addActivities = useActivityLogStore((state) => state.addActivities);
  const categories = useCategoriesStore((state) => state.categories);
  const incomeCategory = categories.find((category) => category.id === INCOME_CATEGORY_ID);
  const recentCategories = useRecentCategories();
  const styles = createStyles(theme);

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
  const [selectedCategory, setSelectedCategory] = useState(() =>
    editingTransaction && editingTransaction.type === 'expense'
      ? {
          name: editingTransaction.category,
          iconName: editingTransaction.iconName,
          glyph: editingTransaction.glyph,
        }
      : null,
  );
  const [isCategoryListOpen, setIsCategoryListOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    () => editingTransaction?.date ?? getTodayIsoDate(),
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
  const [receiptUri, setReceiptUri] = useState(() => editingTransaction?.receiptUri ?? null);
  const [errors, setErrors] = useState({});

  // Consumes the value returned from CategoryPicker via the "Search more"
  // path (navigation.popTo('AddExpense', { selectedCategory }), see this
  // screen's top-of-file note), then clears it from route.params so
  // re-selecting the same category on a later visit still triggers this
  // effect (the transition goes object -> undefined -> object again rather
  // than staying on the same reference).
  useEffect(() => {
    if (route.params?.selectedCategory) {
      setSelectedCategory(route.params.selectedCategory);
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
  function handlePickReceipt() {
    launchImageLibrary({ mediaType: 'photo', selectionLimit: 1 }, (response) => {
      if (response.didCancel || response.errorCode) {
        return;
      }
      const pickedUri = response.assets?.[0]?.uri;
      if (pickedUri) {
        setReceiptUri(pickedUri);
      }
    });
  }

  function handleRemoveReceipt() {
    setReceiptUri(null);
  }

  function handleSelectRecentCategory(category) {
    setSelectedCategory(category);
    setIsCategoryListOpen(false);
    if (errors.category) {
      setErrors((prev) => ({ ...prev, category: undefined }));
    }
  }

  function handleOpenCategoryPicker() {
    setIsCategoryListOpen(false);
    navigation.navigate('CategoryPicker');
  }

  function handleSelectGroup(group) {
    setSelectedGroup(group);
    setIsGroupListOpen(false);
    if (errors.group) {
      setErrors((prev) => ({ ...prev, group: undefined }));
    }
  }

  function handleSave() {
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
      return;
    }

    setErrors({});

    // Category-related fields — resolved from the selected category for
    // Debit entries, or fixed to categoryMocks.js's cat-income entry for
    // Credit entries (never read from selectedCategory, which has no
    // bearing on a Credit save since the field isn't shown at all). tone
    // also follows type, matching the existing income seed-record
    // precedent (ADR 0003's 2026-08-10 "Debit/Credit Entry Type" Amendment,
    // Part B).
    const isCredit = type === 'income';
    const categoryFields = isCredit
      ? {
          category: incomeCategory.name,
          iconName: incomeCategory.iconName,
          glyph: incomeCategory.glyph,
          tone: 'success',
        }
      : {
          category: selectedCategory.name,
          iconName: selectedCategory.iconName,
          glyph: selectedCategory.glyph,
          tone: 'neutral',
        };

    // No `time` key here — TIME is no longer a field on this form (ADR
    // 0007's 2026-08-13 amendment, Part A). Create-mode adds it inline
    // below, read fresh at the moment of save; edit-mode omits it entirely
    // so updateTransaction's merge semantics leave the prior value
    // untouched.
    const payload = {
      title: title.trim(),
      date: selectedDate,
      amount: parsedAmount,
      type,
      ...categoryFields,
      scope,
      groupId: scope === 'group' ? selectedGroup.id : null,
      // When the Payment Mode setting is off, the field isn't shown at all
      // (design-system.md Section 7.2) and the ADR doesn't specify a value
      // for that case — 'cash' is used as a sensible default, matching the
      // field's own pre-selected default when it IS shown. [ASSUMPTION],
      // flagged in this round's report.
      paymentMode: paymentModeEnabled ? paymentMode : 'cash',
      // Present-but-null (never omitted) when paymentMode isn't 'both' —
      // mirrors the existing groupId convention (ADR 0003's 2026-08-10
      // Amendment, Part A).
      cashAmount: isBothPaymentMode ? parsedCashAmount : null,
      onlineAmount: isBothPaymentMode ? parsedOnlineAmount : null,
      notes: notes.trim() ? notes.trim() : null,
      receiptUri,
    };

    if (editingTransactionId) {
      // Activity log (ADR 0008 §2.1) — diff the transaction's prior state
      // against this exact about-to-be-saved payload BEFORE calling
      // updateTransaction, so oldTransaction still reflects the pre-edit
      // record. Logs zero entries (no-op) if the user opened Edit and hit
      // Save without changing anything.
      const activities = buildTransactionEditActivities({
        transactionId: editingTransactionId,
        oldTransaction: editingTransaction,
        newFields: payload,
        groups,
      });
      if (activities.length > 0) {
        addActivities(activities);
      }

      // Merge semantics (useTransactionsStore.updateTransaction) — fields
      // this form doesn't touch (notably splitExpenseId, and now `time`)
      // simply keep their prior value, so editing a split-originated
      // transaction's PAYMENT MODE here can never accidentally clear its
      // split link (ADR 0007 §6), and editing any field never resets
      // `time` (ADR 0007's 2026-08-13 amendment, Part A).
      updateTransaction(editingTransactionId, payload);
    } else {
      addTransaction({
        id: `txn-${Date.now()}`,
        splitExpenseId: null,
        // Auto-captured at the moment of save (ADR 0007's 2026-08-13
        // amendment, Part A) — not from mount-time state.
        time: getCurrentTimeString(),
        ...payload,
      });
    }

    // Dismisses this modal, returning to whichever screen (Dashboard, or
    // Transaction Detail via Edit) was underneath — the standard
    // modal-dismiss pattern, symmetric with Cancel in the header.
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
            onChangeText={setAmount}
            placeholder="0.00"
            keyboardType="decimal-pad"
            error={errors.amount}
          />

          <TextInput
            label="EXPENSE NAME"
            value={title}
            onChangeText={setTitle}
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
                    <Text style={styles.categoryText}>{selectedCategory.name}</Text>
                  </>
                ) : (
                  <Text style={styles.categoryPlaceholder}>Select a category</Text>
                )}
              </Pressable>
              {errors.category ? <Text style={styles.errorText}>{errors.category}</Text> : null}

              {isCategoryListOpen ? (
                <View style={styles.categoryList}>
                  {recentCategories.map((category) => (
                    <ListItem
                      key={category.id}
                      leading={<IconBadge glyph={category.glyph} tone="accent" size="small" />}
                      title={category.name}
                      onPress={() => handleSelectRecentCategory(category)}
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
                    onChangeText={setCashAmount}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    error={errors.cashAmount}
                    style={styles.splitAmountField}
                  />
                  <TextInput
                    label="ONLINE AMOUNT"
                    value={onlineAmount}
                    onChangeText={setOnlineAmount}
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
            {receiptUri ? (
              <View style={styles.receiptSelectedRow}>
                <Image source={{ uri: receiptUri }} style={styles.receiptThumbnail} />
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
          </View>
        </Card>

        <PrimaryButton
          label={editingTransactionId ? 'Save Changes' : 'Save Expense'}
          onPress={handleSave}
          style={styles.saveButton}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.xxl,
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
    saveButton: {
      marginTop: theme.space.md,
      marginBottom: theme.space.lg,
    },
  });
}

export default AddExpenseScreen;
