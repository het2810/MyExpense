import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { useCategories } from '../../hooks/useCategories';
import { useCategoryQuickPicks } from '../../hooks/useCategoryQuickPicks';
import { useSplitContactSelection } from '../../hooks/useSplitContactSelection';
import { useDeviceContactResolver } from '../../hooks/useDeviceContactResolver';
import { useGroups } from '../../hooks/useGroups';
import { useSplitExpenseSave } from '../../hooks/useSplitExpenseSave';
import { useSplitExpenseEditing, toCategorySnapshot } from '../../hooks/useSplitExpenseEditing';
import { useUserIdentity } from '../../hooks/useUserIdentity';
import {
  getDateDisplayLabel,
  parseIsoDate,
  toIsoDateString,
  getTodayIsoDate,
} from '../../utils/dateDisplay';
import { toPaise, allocateByWeights } from '../../utils/currency';
import { applyPayerSelection } from '../../utils/splitCalculations';
import { formatCategoryPath } from '../../utils/categories';
import { buildGroupParticipants, buildIndividualParticipants } from '../../utils/splitParticipants';
import { getSplitSummaryText } from '../../utils/splitSummary';
import { withResolvedContactIds } from '../../utils/deviceContacts';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import SegmentedControl from '../../components/SegmentedControl';
import IconBadge from '../../components/IconBadge';
import ListItem from '../../components/ListItem';
import ScreenHeader from '../../components/ScreenHeader';
import HeaderCheckmark from '../../components/HeaderCheckmark';
import Checkbox from '../../components/Checkbox';
import FormMessage from '../../components/FormMessage';
import SplitContactField from '../../components/SplitContactField';
import SplitGroupField from '../../components/SplitGroupField';
import SplitEditLockedTarget from '../../components/SplitEditLockedTarget';

// New local const, independent of Add Expense's TYPE_OPTIONS and the Split
// tab's own SPLIT_TABS — docs/decisions/0005-split-add-expense-flow.md
// §3.2's explicit label-collision analysis: this toggle answers "who am I
// splitting with," a different question from either of those, and never
// appears on-screen at the same time as the Split tab's own switcher.
const SPLIT_MODE_OPTIONS = [
  { label: 'Individual', value: 'individual' },
  { label: 'Group', value: 'group' },
];

/**
 * Whether this flow **demands** a subcategory the way Add Transaction does
 * (the Project Owner's 2026-10-24 addendum, applied there via
 * `requireSubcategory`).
 *
 * `false`, deliberately: the Project Owner has not said whether the rule should
 * extend to a split, and a split's category is optional to begin with (ADR 0023
 * §3 — the server snapshots the caller's protected `Misc` row when no
 * `categoryId` is sent), so demanding a *leaf* here would be stricter than the
 * field itself. A subcategory is therefore **offered** in this flow, not
 * required: the picker reveals a chosen parent's children and the full
 * `Food > Lunch` path renders everywhere, but a parent remains a legal final
 * answer and no save-time message can fire.
 *
 * **Flipping this one constant to `true` turns the Add Transaction rule on
 * here**, with no other change: it is ANDed with the user's
 * `subcategoriesEnabled` preference at the single call site below, exactly as
 * Add Expense does it, and the shared picker already owns every consequence
 * (a parent with children stops being selectable, search drops it, and the
 * explanatory note renders). A matching save-time backstop would then be worth
 * adding next to the existing CATEGORY validation, for the same reason Add
 * Expense has one.
 */
const SPLIT_REQUIRES_SUBCATEGORY = false;

/**
 * Split Add Expense — root-level modal (docs/decisions/
 * 0005-split-add-expense-flow.md §3, docs/ui/design-system.md §9.2).
 * Reached from the Split screen's FAB.
 *
 * **The split itself is a real write as of Domain 6's wiring step**:
 * `POST /api/v1/split-expenses` (api-overview.md §9.1, as corrected by
 * docs/decisions/0023-shared-ledger-contract-corrections.md §3), and the
 * contacts and groups this screen picks from are `GET /contacts` (§6.1) and
 * `GET /groups` (§7.1). The whole save sequence — the optional personal
 * transaction, the split, and the balance re-read that must follow — lives in
 * `hooks/useSplitExpenseSave.js`, because the **order of those steps is the
 * feature** (constitution §8). Read that hook before changing `handleSave`.
 *
 * Three rules from that contract are visible in this screen's own behaviour:
 *
 * - **A category is optional for the split** (ADR 0023 §3: the server snapshots
 *   the caller's protected `Misc` row when `categoryId` is omitted), so CATEGORY
 *   is only required when "add this to my expenses" is ticked — `POST
 *   /transactions` does require one for an expense (§4.2).
 * - **A group split with that box ticked is refused**, with
 *   `403 NOT_GROUP_MEMBER`, for every input — `POST /transactions` has not yet
 *   been taught a real membership check (`backend/README.md` §15.8). The
 *   mapped copy names unticking it as the way through, and the refusal lands
 *   before any shared state moves.
 * - **A balance is never adjusted locally.** A split moves every participant's
 *   balance server-side; the save hook re-reads instead (ADR 0023 §1).
 *
 * ADR 0005 §6 still decides the amount of the personal transaction: the user's
 * own consumption share, never the total.
 *
 * AMOUNT/EXPENSE NAME/CATEGORY/DATE are reused verbatim from
 * AddExpenseScreen.jsx (identical components, validation, hooks/utils) —
 * this screen has no ENTRY TYPE toggle (a split is always an expense) and
 * no PAYMENT MODE fields (out of scope per the ADR).
 *
 * **CATEGORY now behaves the same way it does on Add Expense (fix,
 * 2026-10-29)**, which it did not before: the inline dropdown lists the same
 * quick picks (up to 4 top-level rows, recents first, then the account's
 * remaining top-level categories alphabetically — `useCategoryQuickPicks`,
 * whose 2026-11-01 cap, alphabetical fill and top-level-only rule both
 * surfaces inherit without editing either),
 * picking one that has subcategories
 * continues into the picker expanded on it, and the picker is opened with the
 * same `currentSelection`/`requireSubcategory` params so the current choice is
 * badged and a parent's children are revealed rather than hidden behind a
 * chevron. The one difference is on purpose and is one constant wide —
 * `SPLIT_REQUIRES_SUBCATEGORY` above. The trigger already rendered the full
 * `Food > Lunch` path and still does.
 *
 * Split summary chip (§3.4): shows the current split configuration's
 * plain-English summary and opens "How Was This Expense Split?" on tap.
 * Its underlying `splitConfig` recomputes live as an equal split across the
 * current participants UNTIL the user has actually customized it via that
 * screen or Adjust Split — at which point any further change to AMOUNT,
 * the Individual/Group toggle, or the selected contact/group resets it back
 * to the live default rather than silently carrying forward a now-stale
 * custom split (the "reset-on-change" rule, §3.4).
 *
 * Activity log: **this screen no longer writes one.** It used to mint a local
 * `split_saved` entry per save (ADR 0008 §2.2) because §11 was unwired. The
 * server now writes that row itself — the fan-out runs **in the same
 * transaction** as `POST /split-expenses` and writes one privately-owned row
 * per affected member, each with its own viewer-relative sentence
 * (api-overview.md §9.1/§11.1, `backend/README.md` §17.1). So keeping the
 * client-side write would double-count every split in the feed, and would do
 * it invisibly: the two entries render identically.
 *
 * It also produced something this client structurally cannot: the
 * *counterpart's* copy of the sentence. That is now correct for free.
 *
 * CONTACT/GROUP search — docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §3/§4, docs/ui/design-system.md
 * §10.1/§10.2. Both fields' in-place lists have a SearchBar. GROUP keeps its
 * "Create New Group" row, which navigates to NewGroupScreen with
 * `returnTo`/`suggestedName` params and consumes the returned `selectedGroup`
 * param via a dedicated effect below.
 *
 * **CONTACT picks from the device address book** (Project Owner, 2026-11-12):
 * manual "Create Contact" is gone. A picked number is a local selection
 * (`device:+91…`) and persists nothing until Save, where
 * `useDeviceContactResolver` reuses or creates the backend contact and the
 * participants' `participantContactId`s are swapped for the real ids.
 *
 * **CONTACT is multi-select** (docs/decisions/
 * 0026-multi-contact-individual-splits.md §8): an Individual split may name
 * several contacts, each a removable chip. The field — chips, dropdown,
 * search — lives in
 * `components/SplitContactField.jsx`; the selection lives in
 * `hooks/useSplitContactSelection.js`. 2+ contacts give 3+ participants, so
 * How Was This Split? shows its 3+-participant preset.
 */
function SplitAddExpenseScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  // The whole save sequence: the optional `POST /transactions`, then
  // `POST /split-expenses`, then the balance re-read. It is also the
  // transactions load trigger this screen's `useCategoryQuickPicks` needs for
  // the recent half of its list.
  const { saveSplitExpense, updateSplitExpense, isSaving } = useSplitExpenseSave();
  // Edit mode (ADR 0028 §11.5): the split, its fixed roster and the prefill.
  // `initial` is read only by the initial state below.
  const editing = useSplitExpenseEditing(route.params?.editingSplitExpenseId);
  const initial = editing.initialForm ?? {};
  // The Individual split's counterparts, in selection order (ADR 0026 §8.1).
  // The CONTACT field itself — chips, device-contacts dropdown, search — is
  // `components/SplitContactField.jsx`.
  const { selectedContacts, selectionKey, addContact, removeContact } =
    useSplitContactSelection();
  // Device selections become backend contact ids at Save, never before.
  const { resolveContactIds } = useDeviceContactResolver();
  const [isResolvingContacts, setIsResolvingContacts] = useState(false);
  const { groups, loadError: groupsError, reload: reloadGroups } = useGroups();
  // Read for exactly two questions, neither of which renders category data:
  // the user's `subcategoriesEnabled` preference (to AND with this flow's own
  // constant) and "can the chosen category still be narrowed?" — the rule that
  // decides whether picking a parent should go on to show its children. Same
  // single-boolean arrangement as Add Expense's (constitution §8).
  const { subcategoriesEnabled, needsSubcategorySelection } = useCategories();
  const quickPickCategories = useCategoryQuickPicks();
  // The synthesized "you" participant's display name and initials — and the
  // signed-in user's own id, which is NOT display: a split expense identifies
  // the caller's participant entry and the payer by `participantUserId`
  // (§9.1), so the save cannot build a valid request without it.
  const identity = useUserIdentity();
  const styles = createStyles(theme, insets);

  const [amount, setAmount] = useState(initial.amount ?? '');
  const [title, setTitle] = useState(initial.title ?? '');
  const [selectedCategory, setSelectedCategory] = useState(initial.selectedCategory ?? null);
  const [isCategoryListOpen, setIsCategoryListOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(initial.selectedDate ?? getTodayIsoDate());
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [splitMode, setSplitMode] = useState(
    initial.splitMode ?? route.params?.initialSplitMode ?? 'individual',
  );
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [customSplitConfig, setCustomSplitConfig] = useState(initial.splitConfig ?? null);
  const [chipMessage, setChipMessage] = useState(null);
  const [addToExpenses, setAddToExpenses] = useState(false);
  const [errors, setErrors] = useState({});
  // Form-level copy for a failed `POST /transactions` — the one write on this
  // screen that leaves the device (ADR 0016 §9.1's slot, applied here because
  // the failure belongs to no single field).
  const [formError, setFormError] = useState(null);

  const isFirstRender = useRef(true);

  // Synthesized (not stored) participant roster, always "you" first — ADR
  // 0005 §3.3. Each entry now carries BOTH the local `participantId` every
  // split-method screen keys by and the API's two-column identity
  // (`participantUserId`/`participantContactId`), which is what let
  // HowWasThisSplit and AdjustSplit stay untouched — see
  // `utils/splitParticipants.js`.
  //
  // **Group members come from `GroupResponse.members[]`, not from the contact
  // list.** A group split's participants must be named the way `group_members`
  // stores them or the server answers `400`, and a member may be a registered
  // account *or* an unregistered placeholder — which the contact list cannot
  // tell us (`backend/README.md` §16.6 assumptions 6 and 7).
  const participants = useMemo(() => {
    if (editing.isEditing) {
      return editing.roster ?? null;
    }
    if (splitMode === 'individual') {
      return buildIndividualParticipants({
        currentUserId: identity.userId,
        fullName: identity.fullName,
        initials: identity.initials,
        contacts: selectedContacts,
      });
    }
    return buildGroupParticipants({
      currentUserId: identity.userId,
      fullName: identity.fullName,
      initials: identity.initials,
      group: selectedGroup,
    });
  }, [editing.isEditing, editing.roster, splitMode, selectedContacts, selectedGroup, identity]);

  // Default splitConfig: equal split across the current participants, you
  // as payer — recomputed live from AMOUNT/participants (§3.4/§5.3).
  const defaultSplitConfig = useMemo(() => {
    if (!participants || participants.length < 2) {
      return null;
    }
    const parsedAmount = parseFloat(amount) || 0;
    const amounts = allocateByWeights(
      parsedAmount,
      participants.map(() => 1),
    );
    return {
      method: 'equally',
      paidById: 'self',
      // Single payer, so no multi-payer list (ADR 0025 §8.1: exactly one of
      // paidById/payers is set). A custom multi-payer config lives in
      // customSplitConfig and is cleared by the reset-on-change effect below.
      payers: null,
      participantAmounts: participants.map((participant, index) => ({
        participantId: participant.participantId,
        name: participant.name,
        amount: amounts[index],
      })),
    };
  }, [participants, amount]);

  const splitConfig = customSplitConfig ?? defaultSplitConfig;

  // Reset-on-change rule (§3.4, correctness-critical): any change to
  // AMOUNT, the Individual/Group toggle, or the selected contact/group,
  // AFTER a custom splitConfig has been set, resets it back to the live
  // default rather than reconciling stale absolute amounts/percentages
  // against a new total or changed participant roster. This also covers a
  // multi-payer config (ADR 0025 §8.1): its per-person paid amounts sum to the
  // old total for the old roster, so they reset with everything else.
  //
  // Contacts are keyed by `selectionKey` (the joined ids), not the array: any
  // add or remove resets, and nothing else does (ADR 0026 §8.3).
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setCustomSplitConfig(null);
  }, [amount, splitMode, selectionKey, selectedGroup]);

  // Consumes the value returned from CategoryPicker via the "Search more"
  // path (navigation.popTo('SplitAddExpense', { selectedCategory })) — same
  // pattern/reasoning as AddExpenseScreen.jsx's own effect.
  useEffect(() => {
    if (route.params?.selectedCategory) {
      setSelectedCategory(route.params.selectedCategory);
      navigation.setParams({ selectedCategory: undefined });
      setErrors((prev) => (prev.category ? { ...prev, category: undefined } : prev));
    }
  }, [route.params?.selectedCategory, navigation]);

  // Consumes the splitConfig returned from either "How Was This Expense
  // Split?" (a preset row) or "Adjust Split" (its checkmark confirm) — both
  // return via navigation.popTo('SplitAddExpense', { splitConfig }), the
  // same shape, so this one effect handles both return paths (ADR 0005
  // §5.9).
  useEffect(() => {
    if (route.params?.splitConfig) {
      setCustomSplitConfig(route.params.splitConfig);
      navigation.setParams({ splitConfig: undefined });
    }
  }, [route.params?.splitConfig, navigation]);

  // Consumes a "Who paid?" result returned directly here — How Was This
  // Split?'s "Paid by multiple people" row opens Who Paid? with
  // `returnTo: 'SplitAddExpense'`, which pops back with `{ payersSelection }`.
  // Only the payer half changes: the method and every participant's share in
  // effect when Who Paid? opened are kept (`applyPayerSelection`). Re-applying
  // it is idempotent, so a render before the param clears changes nothing.
  const returnedPayersSelection = route.params?.payersSelection;
  useEffect(() => {
    if (!returnedPayersSelection) {
      return;
    }
    navigation.setParams({ payersSelection: undefined });
    if (splitConfig) {
      setCustomSplitConfig(applyPayerSelection(splitConfig, returnedPayersSelection));
    }
  }, [returnedPayersSelection, splitConfig, navigation]);

  // Consumes the group returned from NewGroupScreen's "Create New Group"
  // round trip (navigation.popTo('SplitAddExpense', { selectedGroup })) —
  // structurally identical to the two effects above (ADR 0006 §4).
  useEffect(() => {
    if (route.params?.selectedGroup) {
      setSelectedGroup(route.params.selectedGroup);
      navigation.setParams({ selectedGroup: undefined });
      setChipMessage(null);
      setErrors((prev) => (prev.group ? { ...prev, group: undefined } : prev));
    }
  }, [route.params?.selectedGroup, navigation]);

  // Disables (and force-unchecks) the "Add this transaction to my
  // expenses" checkbox whenever the user's own consumption share drops to
  // ₹0 — ADR 0005 §3.5/§6.2 (corrected 2026-08-11).
  const yourConsumptionShare =
    splitConfig?.participantAmounts.find((entry) => entry.participantId === 'self')?.amount ?? 0;
  const isCheckboxDisabled = yourConsumptionShare <= 0;

  useEffect(() => {
    if (isCheckboxDisabled && addToExpenses) {
      setAddToExpenses(false);
    }
  }, [isCheckboxDisabled, addToExpenses]);

  // CONTACT and GROUP search/creation live in `components/SplitContactField.jsx`
  // (ADR 0026 §8.1) and `components/SplitGroupField.jsx`, with ADR 0006's rules.

  function handleCancel() {
    navigation.goBack();
  }

  function handleDateChange(event, date) {
    setIsDatePickerVisible(false);
    if (event.type === 'set' && date) {
      setSelectedDate(toIsoDateString(date));
    }
  }

  /**
   * Opens the shared Category Picker, telling it what this flow needs and what
   * the form already holds — the same three params Add Expense passes, so the
   * two flows present subcategories identically (see
   * CategoryPickerScreen.jsx's route-param notes).
   *
   * @param {object | null} selection What the CATEGORY field currently holds.
   */
  function openCategoryPicker(selection) {
    setIsCategoryListOpen(false);
    navigation.navigate('CategoryPicker', {
      // returnTo tells the shared CategoryPicker screen to popTo this screen
      // (not AddExpense, its other caller) once a category is selected — see
      // CategoryPickerScreen.jsx's top-of-file note.
      returnTo: 'SplitAddExpense',
      // ANDed with the user's preference here rather than inside the picker, so
      // the call site reads as this flow's own decision. `false` while
      // SPLIT_REQUIRES_SUBCATEGORY is false: a parent stays selectable.
      requireSubcategory: SPLIT_REQUIRES_SUBCATEGORY && subcategoriesEnabled,
      // A name pair, not the object: the picker resolves it against the live
      // tree. It badges the matching row and opens the owning parent — which is
      // what reveals a chosen parent's subcategories instead of leaving them
      // behind the row's chevron.
      currentSelection: selection
        ? { name: selection.name, parentCategoryName: selection.parentCategoryName ?? null }
        : null,
    });
  }

  function handleSelectQuickPickCategory(category) {
    setSelectedCategory(category);
    setIsCategoryListOpen(false);
    if (errors.category) {
      setErrors((prev) => ({ ...prev, category: undefined }));
    }

    // Same continuation Add Expense makes: picking a main category that has
    // subcategories goes straight on to show them, rather than leaving the user
    // to find them. **It is an offer here, not a requirement** — the category is
    // already set and kept, so backing out of the picker leaves the parent in
    // the field and the form saves on it.
    if (needsSubcategorySelection(category)) {
      openCategoryPicker(category);
    }
  }

  function handleOpenCategoryPicker() {
    openCategoryPicker(selectedCategory);
  }

  /**
   * Adds a counterpart chip (ADR 0026 §8.1). The split config resets via the
   * reset effect above, because the selection key changed.
   *
   * @returns {{ added: boolean, error: string | null }} for the field to show.
   */
  function handleAddContact(contact) {
    const result = addContact(contact);
    if (result.added) {
      setChipMessage(null);
      if (errors.contact) {
        setErrors((prev) => ({ ...prev, contact: undefined }));
      }
    }
    return result;
  }

  /** Removes one chip; the split config resets via the reset effect. */
  function handleRemoveContact(contactId) {
    removeContact(contactId);
    setChipMessage(null);
  }

  function handleSelectGroup(group) {
    setSelectedGroup(group);
    setChipMessage(null);
    if (errors.group) {
      setErrors((prev) => ({ ...prev, group: undefined }));
    }
  }

  /** Clears the GROUP field; the split config resets via the reset effect. */
  function handleClearGroup() {
    setSelectedGroup(null);
    setChipMessage(null);
  }

  function handleOpenCreateGroup(suggestedName) {
    navigation.navigate('NewGroup', { returnTo: 'SplitAddExpense', suggestedName });
  }

  function handleOpenSplitConfig() {
    if (!participants) {
      setChipMessage('Select a person or group first.');
      return;
    }
    setChipMessage(null);
    const parsedAmount = parseFloat(amount) || 0;
    navigation.navigate('HowWasThisSplit', {
      totalAmount: parsedAmount,
      participants,
      currentSplitConfig: splitConfig,
    });
  }

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
    // **A category is optional for the split itself** (ADR 0023 §3: the server
    // snapshots the caller's protected `Misc` row when `categoryId` is
    // omitted), so this is required only when the user also wants the expense
    // on their own Dashboard — `POST /transactions` does require one for an
    // expense (§4.2), and letting that round trip fail instead would be a
    // worse way to discover the same rule.
    if (!selectedCategory && addToExpenses && !isCheckboxDisabled) {
      nextErrors.category = 'Pick a category to add this to your own expenses.';
    }
    // In edit mode the audience is fixed (ADR 0028 §2.2), so neither applies.
    if (!editing.isEditing && splitMode === 'individual' && selectedContacts.length === 0) {
      nextErrors.contact = 'Select a person to split with.';
    }
    if (!editing.isEditing && splitMode === 'group' && !selectedGroup) {
      nextErrors.group = 'Select a group.';
    }
    // A target with nobody else in it. **Newly reachable now that membership is
    // the server's**: §7.2 de-duplicates, so two contacts that are both linked
    // to the caller's own account collapse into a group whose only member is
    // the caller (`backend/README.md` §15.3(d)). There is then no second side
    // for a split to have, `splitConfig` is null, and the sum check below would
    // throw rather than explain. The group itself is perfectly valid — it just
    // cannot be split with yet.
    if (!nextErrors.contact && !nextErrors.group && (!splitConfig || participants.length < 2)) {
      nextErrors[splitMode === 'group' ? 'group' : 'contact'] =
        'A split needs someone else in it — this one has only you.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    // Defensive re-validation (ADR 0005 §6.3) — should always hold by
    // construction (every Adjust Split tab blocks confirm otherwise, and
    // the reset-on-change rule prevents a stale mismatch), kept as a
    // fail-gracefully guard rather than trusting that invariant blindly.
    const sumParticipantAmounts = splitConfig.participantAmounts.reduce(
      (sum, entry) => sum + entry.amount,
      0,
    );
    if (toPaise(sumParticipantAmounts) !== toPaise(parsedAmount)) {
      setErrors({
        amount: "Something went wrong computing the split. Please review the split and try again.",
      });
      return;
    }

    setErrors({});
    setFormError(null);

    if (editing.isEditing) {
      // ADR 0028 §11.5: the edit branch lives in useSplitExpenseSave/splitEdit.
      const edited = await updateSplitExpense({
        splitExpense: editing.splitExpense,
        title: title.trim(),
        categoryId: selectedCategory?.id ?? null,
        categorySnapshot: toCategorySnapshot(selectedCategory),
        splitDate: selectedDate,
        amount: parsedAmount,
        splitConfig,
        participants,
      });
      if (edited.success) {
        navigation.goBack();
      } else {
        setFormError(edited.error);
      }
      return;
    }

    const finalYourShare =
      splitConfig.participantAmounts.find((entry) => entry.participantId === 'self')?.amount ?? 0;

    /**
     * **THE WRITE SEQUENCE LIVES IN `hooks/useSplitExpenseSave.js`**, which is
     * also where the reasoning for its order is recorded. In short: the
     * optional `POST /transactions` goes first so that a group split with the
     * box ticked — which is still refused with `403 NOT_GROUP_MEMBER` for every
     * input, a known backend follow-up — fails *before* any shared state
     * moves; then `POST /split-expenses`; then the balance re-read, because a
     * split moves every participant's balance server-side and nothing on this
     * device can compute the result.
     *
     * Two things that are deliberately NOT done here any more:
     *
     * - **No local balance delta.** The old `netPositionDelta` arithmetic
     *   (`paid − consumed`, applied to an aggregate entry) is gone: a pairwise
     *   or group balance is a shared row that the other party can also move, so
     *   a locally applied delta would drift invisibly (ADR 0023 §1, its
     *   Frontend follow-up).
     * - **No locally invented split id.** The id is the server's, and it is
     *   also what the server's own activity fan-out references on every
     *   affected member's row (§11.1's `relatedSplitExpenseId`).
     *
     * **What is still lost, stated rather than hidden:** `POST /transactions`
     * accepts no `splitExpenseId` (§4.2 — only a split expense may set it), and
     * this flow writes that transaction itself, so a split-originated
     * transaction carries no link back to its split. The Dashboard's "SPLIT"
     * badge and Transaction Detail's "PAID" tag therefore do not appear on it.
     * Flagged in this round's report.
     */
    // Device selections -> backend contacts (reused by number, else created).
    // Only now, at Save: picking someone persisted nothing.
    let contactIdBySelectionId = new Map();
    if (splitMode === 'individual') {
      setIsResolvingContacts(true);
      const resolution = await resolveContactIds(selectedContacts);
      setIsResolvingContacts(false);
      if (!resolution.success) {
        setFormError(resolution.error);
        return;
      }
      contactIdBySelectionId = resolution.contactIdBySelectionId;
    }

    const result = await saveSplitExpense({
      title: title.trim(),
      // Optional: no category is a legal split (ADR 0023 §3). It is only
      // non-null here when the user picked one, and the validation above makes
      // it mandatory solely for the "add to my expenses" path.
      categoryId: selectedCategory?.id ?? null,
      splitDate: selectedDate,
      amount: parsedAmount,
      splitMode,
      groupId: splitMode === 'group' ? selectedGroup.id : null,
      // Selection order. `utils/splitRequests.js` sends one contact in the
      // legacy single field (today's body, byte for byte) and 2+ as
      // `individualCounterpartContactIds` (ADR 0026 §8.4).
      individualCounterpartContactIds:
        splitMode === 'individual'
          ? selectedContacts.map((contact) => contactIdBySelectionId.get(contact.id) ?? contact.id)
          : null,
      splitConfig,
      participants: withResolvedContactIds(participants, contactIdBySelectionId),
      addToExpenses,
      yourShare: finalYourShare,
    });

    if (!result.success) {
      setFormError(result.error);
      return;
    }

    // No activity-log write here any more — see this screen's note. The
    // server's fan-out wrote the §11.1 rows in the same transaction as
    // `POST /split-expenses`, one per affected member.

    navigation.goBack();
  }

  const splitSummaryText = getSplitSummaryText(splitConfig, participants);
  // U2 (ADR 0028 §6.2): only the creator may change an edited split's category.
  const canPickCategory = !editing.isEditing || editing.canEditCategory;

  if (editing.isMissing) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="Edit expense" onClose={handleCancel} />
        <Text style={styles.missingText}>This expense was deleted, or isn&apos;t available offline.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title={editing.isEditing ? 'Edit expense' : 'Split Expense'}
        onClose={handleCancel}
        // Disabled while the personal transaction's POST is in flight: this
        // save is no longer instantaneous, and a second tap would fire a
        // second create (the store also guards it, this is the visible half).
        rightSlot={
          <HeaderCheckmark onPress={handleSave} disabled={isSaving || isResolvingContacts} />
        }
      />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
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
            placeholder="e.g. Dinner with friends"
            error={errors.title}
          />

          <View style={styles.categoryContainer}>
            <Text style={styles.label}>CATEGORY</Text>
            <Pressable
              style={styles.fieldTrigger}
              onPress={() => canPickCategory && setIsCategoryListOpen((prev) => !prev)}
              disabled={!canPickCategory}
              accessibilityRole="button"
            >
              {selectedCategory ? (
                <>
                  <IconBadge
                    glyph={selectedCategory.glyph}
                    tone="accent"
                    size="small"
                    style={styles.fieldIcon}
                  />
                  {/* Full path when a subcategory is chosen — same shared
                      formatter and same reason as Add Expense's trigger: a
                      bare leaf name is ambiguous (docs/decisions/
                      0019-subcategories-one-optional-level.md §3/§10.3). */}
                  <Text style={styles.fieldText}>
                    {formatCategoryPath(selectedCategory.parentCategoryName, selectedCategory.name)}
                  </Text>
                </>
              ) : (
                <Text style={styles.fieldPlaceholder}>Select a category</Text>
              )}
            </Pressable>
            {errors.category ? <Text style={styles.errorText}>{errors.category}</Text> : null}
            {canPickCategory ? null : (
              <Text style={styles.helperText}>
                Only the person who added this expense can change its category.
              </Text>
            )}

            {isCategoryListOpen ? (
              <View style={styles.inlineList}>
                {quickPickCategories.map((category) => (
                  <ListItem
                    key={category.id}
                    leading={<IconBadge glyph={category.glyph} tone="accent" size="small" />}
                    // Same shared formatter as the trigger above, so one
                    // function decides how a category reads anywhere (ADR 0019
                    // §3/§10.3). Quick-pick rows are all top-level as of
                    // 2026-11-01, so this renders a bare name here — the
                    // helper's documented null-parent case.
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

          <View style={styles.dateContainer}>
            <Text style={styles.label}>DATE</Text>
            <Pressable
              style={styles.fieldTrigger}
              onPress={() => setIsDatePickerVisible(true)}
              accessibilityRole="button"
            >
              {/* Placeholder Text glyph standing in for `calendar-outline`
                  — see AddExpenseScreen.jsx's identical DATE field for the
                  full icon-library note. */}
              <Text style={styles.dateIcon}>▦</Text>
              <Text style={styles.fieldText}>{getDateDisplayLabel(selectedDate)}</Text>
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

          {editing.isEditing ? (
            // ADR 0028 §2.2/§11.5: who is in the expense is fixed after creation.
            <SplitEditLockedTarget {...editing.lockedTarget} />
          ) : (
            <>
              <Text style={[styles.label, styles.sectionSpacing]}>INDIVIDUAL/GROUP</Text>
              <SegmentedControl
                options={SPLIT_MODE_OPTIONS}
                value={splitMode}
                onChange={(value) => {
                  setSplitMode(value);
                  setChipMessage(null);
                }}
                style={styles.splitModeControl}
              />
            </>
          )}

          {editing.isEditing ? null : splitMode === 'individual' ? (
            // Multi-select chips, recent-4 + search, inline create — ADR 0026
            // §8.1. The selection itself stays here, in
            // `useSplitContactSelection`, because participants and the request
            // are built from it.
            <SplitContactField
              selectedContacts={selectedContacts}
              onAddContact={handleAddContact}
              onRemoveContact={handleRemoveContact}
              error={errors.contact}
            />
          ) : (
            <SplitGroupField
              groups={groups}
              selectedGroup={selectedGroup}
              onSelectGroup={handleSelectGroup}
              onClearGroup={handleClearGroup}
              onCreateGroup={handleOpenCreateGroup}
              error={errors.group}
              loadError={groupsError}
              onRetry={reloadGroups}
            />
          )}

          <Pressable
            style={styles.chip}
            onPress={handleOpenSplitConfig}
            accessibilityRole="button"
          >
            <Text style={styles.chipText}>{splitSummaryText}</Text>
          </Pressable>
          {chipMessage ? <Text style={styles.errorText}>{chipMessage}</Text> : null}

          {/* Hidden in edit mode: `addToPersonalExpenses` is immutable (ADR 0028 §2.2). */}
          {editing.isEditing ? null : (
            <Pressable
              style={styles.checkboxRow}
              onPress={() => {
                if (!isCheckboxDisabled) {
                  setAddToExpenses((prev) => !prev);
                }
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: addToExpenses, disabled: isCheckboxDisabled }}
            >
              <Text style={[styles.checkboxLabel, isCheckboxDisabled && styles.checkboxLabelDisabled]}>
                Add this transaction to my expenses
              </Text>
              <Checkbox checked={addToExpenses && !isCheckboxDisabled} />
            </Pressable>
          )}
          {isCheckboxDisabled && !editing.isEditing ? (
            <Text style={styles.helperText}>
              Your share of this expense is ₹0, so there&apos;s nothing to add to your own
              spending.
            </Text>
          ) : null}

          {/* The only failure on this screen that comes from the network: the
              personal transaction's `POST /transactions`. It belongs to no
              single field, so it takes the form-level slot (ADR 0016 §9.1) —
              placed under the checkbox that caused it, which is also the
              control the copy tells the user to untick when a group split is
              refused with `403 NOT_GROUP_MEMBER`. Nothing else in this save
              has been written when this shows: the split, the balances and the
              activity entry are all still untouched. */}
          <FormMessage message={formError} style={styles.formMessage} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// The split summary chip's copy now lives in `utils/splitSummary.js`, and the
// GROUP field in `components/SplitGroupField.jsx` (moved out unchanged with
// ADR 0028's edit mode, so this screen shrank rather than grew).

// `getInitialsFromName` lived here with the note "not promoted to a shared
// utility since this is its only call site". It has moved to
// `src/utils/initials.js` — the shared-ledger wiring added two more call sites
// (a group member and a settlement counterpart, neither of which carries an
// `initials` field the way a ContactResponse does), which crosses constitution
// §25's threshold. This screen no longer derives initials at all: a created
// contact's come back from the server.

// HeaderCheckmark (ScreenHeader's rightSlot "Save") now lives in
// `src/components/HeaderCheckmark.jsx` — promoted when "Who paid?" became its
// third call site (constitution §25, ADR 0025 §8.4).

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
      // Trailing space measured from the top of the bottom system bar, so
      // this form's last control never sits under it. 0 where there is no
      // bar — same designed spacing as before.
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
    categoryContainer: {
      marginBottom: theme.space.lg,
    },
    fieldTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      paddingBottom: theme.space.sm,
      minHeight: 40,
    },
    fieldIcon: {
      marginRight: theme.space.sm,
    },
    fieldText: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    fieldPlaceholder: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.bodyLg.fontSize,
    },
    inlineList: {
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
    // Edit mode, the split is not in any cached feed (ADR 0028 §11.3/§11.5).
    missingText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      padding: theme.space.xl,
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
    splitModeControl: {
      marginBottom: theme.space.lg,
    },
    chip: {
      alignSelf: 'stretch',
      alignItems: 'center',
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      backgroundColor: theme.color.background.surfaceAlt,
      paddingVertical: theme.space.md,
      marginTop: theme.space.sm,
      marginBottom: theme.space.lg,
    },
    chipText: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      fontWeight: '600',
    },
    checkboxRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    checkboxLabel: {
      flex: 1,
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginRight: theme.space.md,
    },
    checkboxLabelDisabled: {
      color: theme.color.text.tertiary,
    },
    helperText: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      marginTop: theme.space.xs,
    },
    // A FormMessage as the last thing inside a Card: its own bottom margin is
    // meant for a form field below it, so it is traded for a top gap here.
    formMessage: {
      marginTop: theme.space.md,
      marginBottom: 0,
    },
  });
}

export default SplitAddExpenseScreen;
