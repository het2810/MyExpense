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
import { useTheme } from '../../theme/useTheme';
import { useTransactionsStore } from '../../store/useTransactionsStore';
import { useGroupsStore } from '../../store/useGroupsStore';
import { useIndividualSplitsStore } from '../../store/useIndividualSplitsStore';
import { useSplitExpensesStore } from '../../store/useSplitExpensesStore';
import { useContactsStore } from '../../store/useContactsStore';
import { useActivityLogStore } from '../../store/useActivityLogStore';
import { useRecentCategories } from '../../hooks/useRecentCategories';
import { profileUser } from '../../mocks/profileMocks';
import {
  getDateDisplayLabel,
  parseIsoDate,
  toIsoDateString,
  getTodayIsoDate,
  getCurrentTimeString,
} from '../../utils/dateDisplay';
import { toPaise, allocateByWeights } from '../../utils/currency';
import { buildSplitSavedActivity } from '../../utils/activityLogEntries';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import SegmentedControl from '../../components/SegmentedControl';
import IconBadge from '../../components/IconBadge';
import ListItem from '../../components/ListItem';
import ScreenHeader from '../../components/ScreenHeader';
import Avatar from '../../components/Avatar';
import Checkbox from '../../components/Checkbox';
import SearchBar from '../../components/SearchBar';
import PrimaryButton from '../../components/PrimaryButton';
import TextButton from '../../components/TextButton';

// New local const, independent of Add Expense's TYPE_OPTIONS and the Split
// tab's own SPLIT_TABS — docs/decisions/0005-split-add-expense-flow.md
// §3.2's explicit label-collision analysis: this toggle answers "who am I
// splitting with," a different question from either of those, and never
// appears on-screen at the same time as the Split tab's own switcher.
const SPLIT_MODE_OPTIONS = [
  { label: 'Individual', value: 'individual' },
  { label: 'Group', value: 'group' },
];

// ADR 0005 §3.4's exhaustive method-label mapping for the split-summary
// chip's fallback copy (`${payerLabel} paid, split by ${methodLabel}.`) —
// exact and exhaustive, no wording left to invent per split method.
const METHOD_LABELS = {
  equally: 'equally',
  unequally: 'exact amounts',
  percentage: 'percentage',
  shares: 'shares',
  adjustment: 'adjustment',
};

/**
 * Split Add Expense — root-level modal (docs/decisions/
 * 0005-split-add-expense-flow.md §3, docs/ui/design-system.md §9.2).
 * Reached from the Split screen's FAB. Mock data only: saves a full split
 * record into useSplitExpensesStore, updates the relevant
 * useIndividualSplitsStore/useGroupsStore aggregate entry, and
 * conditionally appends a transaction to useTransactionsStore — see
 * handleSave below and ADR 0005 §6 for the full financial-correctness
 * rule.
 *
 * AMOUNT/EXPENSE NAME/CATEGORY/DATE are reused verbatim from
 * AddExpenseScreen.jsx (identical components, validation, hooks/utils) —
 * this screen has no ENTRY TYPE toggle (a split is always an expense) and
 * no PAYMENT MODE fields (out of scope per the ADR).
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
 * Activity log (docs/decisions/0008-activity-log-system.md §2.2): handleSave
 * logs exactly one useActivityLogStore entry per save, via
 * buildSplitSavedActivity, immediately after addSplitExpense — on every
 * split save, regardless of whether "Add this transaction to my expenses"
 * was checked (relatedTransactionId is simply null when it wasn't).
 *
 * CONTACT/GROUP search & inline creation — docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §3/§4, docs/ui/design-system.md
 * §10.1/§10.2. Both fields' in-place lists gain a SearchBar and a
 * "Create Contact"/"Create New Group" row. Create Contact swaps the
 * dropdown's content to a small inline form (no navigation) and saves to
 * useContactsStore; Create New Group navigates to NewGroupScreen with
 * `returnTo`/`suggestedName` params and consumes the returned
 * `selectedGroup` param via a dedicated effect below.
 */
function SplitAddExpenseScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const addTransaction = useTransactionsStore((state) => state.addTransaction);
  const applyGroupSplitExpense = useGroupsStore((state) => state.applySplitExpense);
  const applyIndividualSplitExpense = useIndividualSplitsStore((state) => state.applySplitExpense);
  const addSplitExpense = useSplitExpensesStore((state) => state.addSplitExpense);
  const addActivity = useActivityLogStore((state) => state.addActivity);
  const groups = useGroupsStore((state) => state.groups);
  const contacts = useContactsStore((state) => state.contacts);
  const addContact = useContactsStore((state) => state.addContact);
  const recentCategories = useRecentCategories();
  const styles = createStyles(theme);

  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [isCategoryListOpen, setIsCategoryListOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getTodayIsoDate());
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [splitMode, setSplitMode] = useState(route.params?.initialSplitMode ?? 'individual');
  const [selectedContact, setSelectedContact] = useState(null);
  const [isContactListOpen, setIsContactListOpen] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState('');
  const [isCreatingContact, setIsCreatingContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhoneOrEmail, setNewContactPhoneOrEmail] = useState('');
  const [newContactErrors, setNewContactErrors] = useState({});
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [isGroupListOpen, setIsGroupListOpen] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [customSplitConfig, setCustomSplitConfig] = useState(null);
  const [chipMessage, setChipMessage] = useState(null);
  const [addToExpenses, setAddToExpenses] = useState(false);
  const [errors, setErrors] = useState({});

  const isFirstRender = useRef(true);

  // Synthesized (not stored) participant list, always "you" first — ADR
  // 0005 §3.3.
  const participants = useMemo(() => {
    if (splitMode === 'individual') {
      if (!selectedContact) {
        return null;
      }
      return [
        { participantId: 'self', name: profileUser.name, initials: profileUser.initials },
        {
          participantId: selectedContact.id,
          name: selectedContact.name,
          initials: selectedContact.initials,
        },
      ];
    }

    if (!selectedGroup) {
      return null;
    }
    const memberParticipants = selectedGroup.memberContactIds
      .map((contactId) => contacts.find((contact) => contact.id === contactId))
      .filter(Boolean)
      .map((contact) => ({
        participantId: contact.id,
        name: contact.name,
        initials: contact.initials,
      }));

    return [
      { participantId: 'self', name: profileUser.name, initials: profileUser.initials },
      ...memberParticipants,
    ];
  }, [splitMode, selectedContact, selectedGroup, contacts]);

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
  // against a new total or changed participant roster.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setCustomSplitConfig(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, splitMode, selectedContact, selectedGroup]);

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

  // CONTACT search/creation — ADR 0006 §3, design-system.md §10.1. Live,
  // case-insensitive substring match on contact.name, identical to
  // NewGroupScreen.jsx's own filteredContacts algorithm.
  const isContactSearching = contactSearchQuery.trim().length > 0;
  const filteredContacts = useMemo(() => {
    const query = contactSearchQuery.trim().toLowerCase();
    if (!query) {
      return contacts;
    }
    return contacts.filter((contact) => contact.name.toLowerCase().includes(query));
  }, [contacts, contactSearchQuery]);
  // Exact visibility rule, ADR 0006 §3: an active search with partial or
  // zero matches, or (defensively) an entirely empty contact pool.
  const showCreateContactRow = isContactSearching || filteredContacts.length === 0;

  // GROUP search/creation — ADR 0006 §4, design-system.md §10.2. Same
  // algorithm as above, filtering by group.name.
  const isGroupSearching = groupSearchQuery.trim().length > 0;
  const filteredGroups = useMemo(() => {
    const query = groupSearchQuery.trim().toLowerCase();
    if (!query) {
      return groups;
    }
    return groups.filter((group) => group.name.toLowerCase().includes(query));
  }, [groups, groupSearchQuery]);
  const showCreateGroupRow = isGroupSearching || filteredGroups.length === 0;

  function handleCancel() {
    navigation.goBack();
  }

  function handleDateChange(event, date) {
    setIsDatePickerVisible(false);
    if (event.type === 'set' && date) {
      setSelectedDate(toIsoDateString(date));
    }
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
    // returnTo tells the shared CategoryPicker screen to popTo this screen
    // (not AddExpense, its other caller) once a category is selected — see
    // CategoryPickerScreen.jsx's top-of-file note.
    navigation.navigate('CategoryPicker', { returnTo: 'SplitAddExpense' });
  }

  function handleSelectContact(contact) {
    setSelectedContact(contact);
    setIsContactListOpen(false);
    setContactSearchQuery('');
    setIsCreatingContact(false);
    setChipMessage(null);
    if (errors.contact) {
      setErrors((prev) => ({ ...prev, contact: undefined }));
    }
  }

  function handleOpenCreateContact() {
    setNewContactName('');
    setNewContactPhoneOrEmail('');
    setNewContactErrors({});
    setIsCreatingContact(true);
  }

  // Returns to the search+list view with the previously typed query
  // preserved (not cleared) — ADR 0006 §3.
  function handleBackFromCreateContact() {
    setIsCreatingContact(false);
    setNewContactName('');
    setNewContactPhoneOrEmail('');
    setNewContactErrors({});
  }

  function handleSaveNewContact() {
    const name = newContactName.trim();
    const phoneOrEmail = newContactPhoneOrEmail.trim();
    const nextErrors = {};
    if (!name) {
      nextErrors.name = 'Enter a name.';
    }
    if (!phoneOrEmail) {
      nextErrors.phoneOrEmail = 'Enter a phone number or email.';
    }
    if (Object.keys(nextErrors).length > 0) {
      setNewContactErrors(nextErrors);
      return;
    }

    const newContact = {
      id: `contact-${Date.now()}`,
      name,
      initials: getInitialsFromName(name),
      phoneOrEmail,
    };
    addContact(newContact);
    // Reuses the exact same selection handler the existing list rows
    // already use — no separate code path (ADR 0006 §3).
    handleSelectContact(newContact);
  }

  function handleSelectGroup(group) {
    setSelectedGroup(group);
    setIsGroupListOpen(false);
    setGroupSearchQuery('');
    setChipMessage(null);
    if (errors.group) {
      setErrors((prev) => ({ ...prev, group: undefined }));
    }
  }

  function handleOpenCreateGroup() {
    setIsGroupListOpen(false);
    navigation.navigate('NewGroup', {
      returnTo: 'SplitAddExpense',
      suggestedName: groupSearchQuery.trim(),
    });
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
    if (!selectedCategory) {
      nextErrors.category = 'Select a category.';
    }
    if (splitMode === 'individual' && !selectedContact) {
      nextErrors.contact = 'Select a person to split with.';
    }
    if (splitMode === 'group' && !selectedGroup) {
      nextErrors.group = 'Select a group.';
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

    const activityLabel = `${title.trim()} • Today`;
    const finalYourShare =
      splitConfig.participantAmounts.find((entry) => entry.participantId === 'self')?.amount ?? 0;
    const netPositionDelta =
      (splitConfig.paidById === 'self' ? parsedAmount : 0) - finalYourShare;

    // Update the relevant aggregate entry FIRST — for Individual mode this
    // also performs the find-or-create rule (ADR 0005 §2.2) and returns the
    // resulting entry, whose `id` is needed below for the split-expense
    // record's `individualId` field (§2.3).
    let individualId = null;
    let groupId = null;

    if (splitMode === 'individual') {
      const individualEntry = applyIndividualSplitExpense(
        selectedContact.id,
        netPositionDelta,
        activityLabel,
      );
      individualId = individualEntry.id;
    } else {
      applyGroupSplitExpense(selectedGroup.id, netPositionDelta, activityLabel);
      groupId = selectedGroup.id;
    }

    // Computed once, before the conditional addTransaction call, so the
    // same id can be threaded into both records below — completes the
    // two-way link between a transaction and the split it came from
    // (ADR 0006 §5).
    const splitExpenseId = `split-${Date.now()}`;

    // Conditionally append the user's own consumption share to
    // useTransactionsStore — ADR 0005 §6.1/§6.2 (corrected 2026-08-11):
    // ALWAYS the user's own participants[].amount entry, NEVER totalAmount,
    // and NEVER gated on paidById.
    let personalTransactionId = null;
    if (addToExpenses && finalYourShare > 0) {
      personalTransactionId = `txn-${Date.now()}`;
      addTransaction({
        id: personalTransactionId,
        title: title.trim(),
        date: selectedDate,
        // ADR 0007's 2026-08-13 amendment to ADR 0003 §3 / ADR 0007 §6,
        // final paragraph — keeps the transaction shape uniform across
        // every writer. This screen gains no TIME UI of its own; the
        // moment of save is a reasonable, consistent default (mirrors
        // AddExpenseScreen's own create-mode TIME default).
        time: getCurrentTimeString(),
        amount: finalYourShare,
        type: 'expense',
        category: selectedCategory.name,
        iconName: selectedCategory.iconName,
        glyph: selectedCategory.glyph,
        tone: 'neutral',
        scope: splitMode === 'individual' ? 'personal' : 'group',
        groupId: splitMode === 'group' ? selectedGroup.id : null,
        // Same [ASSUMPTION] fallback AddExpenseScreen already uses when
        // Payment Mode tracking is off/not applicable — not a new invented
        // default (ADR 0005 §6.2).
        paymentMode: 'cash',
        cashAmount: null,
        onlineAmount: null,
        splitExpenseId,
        // Present-but-null (never omitted) — ADR 0007 §6, final paragraph.
        // This screen has no NOTES/RECEIPT ATTACHMENT UI of its own.
        notes: null,
        receiptUri: null,
      });
    }

    addSplitExpense({
      id: splitExpenseId,
      title: title.trim(),
      category: selectedCategory.name,
      iconName: selectedCategory.iconName,
      glyph: selectedCategory.glyph,
      tone: 'neutral',
      date: selectedDate,
      amount: parsedAmount,
      splitMode,
      individualId,
      groupId,
      splitMethod: splitConfig.method,
      paidById: splitConfig.paidById,
      participants: splitConfig.participantAmounts,
      addedToPersonalExpenses: Boolean(personalTransactionId),
      personalTransactionId,
    });

    // Activity log (ADR 0008 §2.2) — logged on every split save, regardless
    // of whether "Add this transaction to my expenses" was checked
    // (relatedTransactionId is simply null when it wasn't).
    addActivity(
      buildSplitSavedActivity({
        title: title.trim(),
        amount: parsedAmount,
        splitMode,
        paidById: splitConfig.paidById,
        participants,
        selectedGroup,
        transactionId: personalTransactionId,
        splitExpenseId,
      }),
    );

    navigation.goBack();
  }

  const splitSummaryText = getSplitSummaryText(splitConfig, participants);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title="Split Expense"
        onClose={handleCancel}
        rightSlot={<HeaderCheckmark onPress={handleSave} />}
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
              onPress={() => setIsCategoryListOpen((prev) => !prev)}
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
                  <Text style={styles.fieldText}>{selectedCategory.name}</Text>
                </>
              ) : (
                <Text style={styles.fieldPlaceholder}>Select a category</Text>
              )}
            </Pressable>
            {errors.category ? <Text style={styles.errorText}>{errors.category}</Text> : null}

            {isCategoryListOpen ? (
              <View style={styles.inlineList}>
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

          {splitMode === 'individual' ? (
            <View style={styles.selectorContainer}>
              <Text style={styles.label}>CONTACT</Text>
              <Pressable
                style={styles.fieldTrigger}
                onPress={() => setIsContactListOpen((prev) => !prev)}
                accessibilityRole="button"
              >
                {selectedContact ? (
                  <>
                    <Avatar
                      initials={selectedContact.initials}
                      size="small"
                      style={styles.fieldAvatar}
                    />
                    <Text style={styles.fieldText}>{selectedContact.name}</Text>
                  </>
                ) : (
                  <Text style={styles.fieldPlaceholder}>Select a contact</Text>
                )}
              </Pressable>
              {errors.contact ? <Text style={styles.errorText}>{errors.contact}</Text> : null}

              {isContactListOpen ? (
                <View style={styles.inlineList}>
                  {isCreatingContact ? (
                    <View style={styles.createForm}>
                      <TextInput
                        label="NAME"
                        value={newContactName}
                        onChangeText={(value) => {
                          setNewContactName(value);
                          if (newContactErrors.name) {
                            setNewContactErrors((prev) => ({ ...prev, name: undefined }));
                          }
                        }}
                        placeholder="Contact name"
                        error={newContactErrors.name}
                        style={styles.createFormField}
                      />
                      <TextInput
                        label="PHONE OR EMAIL"
                        value={newContactPhoneOrEmail}
                        onChangeText={(value) => {
                          setNewContactPhoneOrEmail(value);
                          if (newContactErrors.phoneOrEmail) {
                            setNewContactErrors((prev) => ({ ...prev, phoneOrEmail: undefined }));
                          }
                        }}
                        placeholder="Phone number or email"
                        error={newContactErrors.phoneOrEmail}
                        style={styles.createFormField}
                      />
                      <View style={styles.createFormActions}>
                        <TextButton label="Back" onPress={handleBackFromCreateContact} />
                        <PrimaryButton
                          label="Save"
                          glow={false}
                          onPress={handleSaveNewContact}
                        />
                      </View>
                    </View>
                  ) : (
                    <>
                      <SearchBar
                        value={contactSearchQuery}
                        onChangeText={setContactSearchQuery}
                        placeholder="Search contacts"
                        style={styles.searchBar}
                      />
                      {filteredContacts.map((contact) => (
                        <ListItem
                          key={contact.id}
                          leading={<Avatar initials={contact.initials} size="small" />}
                          title={contact.name}
                          onPress={() => handleSelectContact(contact)}
                        />
                      ))}
                      {isContactSearching && filteredContacts.length === 0 ? (
                        <Text style={styles.emptySearchText}>
                          No contacts match &quot;{contactSearchQuery.trim()}&quot;.
                        </Text>
                      ) : !isContactSearching && contacts.length === 0 ? (
                        <Text style={styles.emptySearchText}>No contacts yet.</Text>
                      ) : null}
                      {showCreateContactRow ? (
                        <ListItem
                          title="Create Contact"
                          onPress={handleOpenCreateContact}
                          style={styles.searchMoreItem}
                        />
                      ) : null}
                    </>
                  )}
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.selectorContainer}>
              <Text style={styles.label}>GROUP</Text>
              <Pressable
                style={styles.fieldTrigger}
                onPress={() => setIsGroupListOpen((prev) => !prev)}
                accessibilityRole="button"
              >
                {selectedGroup ? (
                  <Text style={styles.fieldText}>{selectedGroup.name}</Text>
                ) : (
                  <Text style={styles.fieldPlaceholder}>
                    {groups.length === 0 ? 'No groups yet' : 'Select a group'}
                  </Text>
                )}
              </Pressable>
              {errors.group ? <Text style={styles.errorText}>{errors.group}</Text> : null}

              {isGroupListOpen ? (
                <View style={styles.inlineList}>
                  <SearchBar
                    value={groupSearchQuery}
                    onChangeText={setGroupSearchQuery}
                    placeholder="Search groups"
                    style={styles.searchBar}
                  />
                  {filteredGroups.map((group) => (
                    <ListItem
                      key={group.id}
                      title={group.name}
                      onPress={() => handleSelectGroup(group)}
                    />
                  ))}
                  {isGroupSearching && filteredGroups.length === 0 ? (
                    <Text style={styles.emptySearchText}>
                      No groups match &quot;{groupSearchQuery.trim()}&quot;.
                    </Text>
                  ) : !isGroupSearching && groups.length === 0 ? (
                    <Text style={styles.emptySearchText}>No groups yet.</Text>
                  ) : null}
                  {showCreateGroupRow ? (
                    <ListItem
                      title="Create New Group"
                      onPress={handleOpenCreateGroup}
                      style={styles.searchMoreItem}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          )}

          <Pressable
            style={styles.chip}
            onPress={handleOpenSplitConfig}
            accessibilityRole="button"
          >
            <Text style={styles.chipText}>{splitSummaryText}</Text>
          </Pressable>
          {chipMessage ? <Text style={styles.errorText}>{chipMessage}</Text> : null}

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
          {isCheckboxDisabled ? (
            <Text style={styles.helperText}>
              Your share of this expense is ₹0, so there&apos;s nothing to add to your own
              spending.
            </Text>
          ) : null}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Split summary chip copy — ADR 0005 §3.4's general rule, exhaustive for
// every splitConfig this feature can produce.
function getSplitSummaryText(splitConfig, participants) {
  if (!splitConfig || !participants || participants.length < 2) {
    return 'You paid, split equally.';
  }

  const other = participants[1];

  if (splitConfig.method === 'equally' && participants.length === 2) {
    return splitConfig.paidById === 'self'
      ? 'You paid, split equally.'
      : `${other.name} paid, split equally.`;
  }

  const payer = participants.find((participant) => participant.participantId === splitConfig.paidById);
  const payerLabel = splitConfig.paidById === 'self' ? 'You' : payer?.name ?? 'Someone';
  const methodLabel = METHOD_LABELS[splitConfig.method] ?? splitConfig.method;

  return `${payerLabel} paid, split by ${methodLabel}.`;
}

// Initials derivation for a newly created contact (ADR 0006 §3) — first
// letter of the first word + first letter of the last word, uppercased; a
// single-word name uses just that word's first letter. Not promoted to a
// shared utility since this is its only call site (constitution §3.5/§25).
function getInitialsFromName(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  if (words.length === 1) {
    return words[0].charAt(0).toUpperCase();
  }
  const first = words[0].charAt(0);
  const last = words[words.length - 1].charAt(0);
  return `${first}${last}`.toUpperCase();
}

// Composed into ScreenHeader's rightSlot, mirroring how ThemeToggleButton +
// Avatar are already composed there on other screens — ADR 0005 §3.1.
function HeaderCheckmark({ onPress }) {
  const theme = useTheme();
  const styles = createHeaderCheckmarkStyles(theme);

  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save">
      {/* Placeholder Text glyph standing in for Ionicons `checkmark-outline`
          (design-system.md §6/§9) — the real icon library isn't
          installed/linked in this codebase yet, matching the same
          glyph-fallback convention already used by ScreenHeader (←/✕) and
          AddExpenseScreen's date field. */}
      <Text style={styles.icon}>✓</Text>
    </Pressable>
  );
}

function createHeaderCheckmarkStyles(theme) {
  return StyleSheet.create({
    icon: {
      color: theme.color.text.primary,
      fontSize: 22,
      fontWeight: '700',
    },
  });
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
    fieldAvatar: {
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
    searchBar: {
      marginTop: theme.space.sm,
      marginBottom: theme.space.xs,
    },
    searchMoreItem: {
      borderTopWidth: 1,
      borderTopColor: theme.color.border.subtle,
      marginTop: theme.space.xs,
      paddingTop: theme.space.sm,
    },
    // Zero-results text, directly above the "Create Contact"/"Create New
    // Group" row — docs/decisions/0013-confirmation-dialog-and-free-tier-polish.md
    // §4.3, mirroring CategoryPickerScreen's own already-established
    // zero-match text styling (type.body/text.secondary).
    emptySearchText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginTop: theme.space.sm,
    },
    createForm: {
      paddingTop: theme.space.sm,
    },
    createFormField: {
      marginBottom: theme.space.md,
    },
    createFormActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: theme.space.sm,
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
    selectorContainer: {
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
  });
}

export default SplitAddExpenseScreen;
