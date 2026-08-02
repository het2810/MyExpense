import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { useGroupsStore } from '../../store/useGroupsStore';
import { useContactsStore } from '../../store/useContactsStore';
import { useActivityLogStore } from '../../store/useActivityLogStore';
import { buildGroupCreatedActivity } from '../../utils/activityLogEntries';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import SearchBar from '../../components/SearchBar';
import Avatar from '../../components/Avatar';
import ListItem from '../../components/ListItem';
import ScreenHeader from '../../components/ScreenHeader';
import Checkbox from '../../components/Checkbox';
import { recentContactIds } from '../../mocks/contactsMocks';

/**
 * New Group — root-level modal (docs/architecture/frontend-navigation.md
 * Section 2.4). Mock data only: saves into useGroupsStore, which feeds
 * SplitGroupsListScreen's Active Groups list reactively. There is no
 * groups API yet — nothing here makes a network call. Member search
 * filters useContactsStore's contacts client-side only (promoted from a
 * plain contactsMocks.js array — docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §2).
 *
 * Photo picker is intentionally NOT implemented — adding an image-picker
 * dependency is out of scope for this phase and would need its own System
 * Architect dependency-approval ADR, the same process the icon library
 * went through (docs/decisions/0002-icon-library-selection.md). A plain
 * decorative Avatar circle (no image, no initials) stands in for the photo
 * placeholder instead, per the task's explicitly allowed option.
 *
 * Two entry points (ADR 0006 §4):
 * 1. The original "New Group" button on SplitGroupsListScreen — no
 *    `returnTo` param, `handleCreateGroup` ends in `navigation.goBack()`,
 *    completely unchanged from before this ADR.
 * 2. Split Add Expense's GROUP field "Create New Group" row — passes
 *    `returnTo: 'SplitAddExpense'` and `suggestedName` (the in-progress
 *    search query). `groupName` pre-fills from `suggestedName` (still fully
 *    editable), and `handleCreateGroup` returns via
 *    `navigation.popTo(returnTo, { selectedGroup: newGroup })` instead.
 *
 * Activity log (docs/decisions/0008-activity-log-system.md §2.3):
 * `handleCreateGroup` logs one useActivityLogStore entry immediately after
 * `addGroup`, unconditionally — regardless of which of the two entry points
 * above was used.
 */
function NewGroupScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const addGroup = useGroupsStore((state) => state.addGroup);
  const mockContacts = useContactsStore((state) => state.contacts);
  const addActivity = useActivityLogStore((state) => state.addActivity);
  const styles = createStyles(theme);

  const [groupName, setGroupName] = useState(route.params?.suggestedName ?? '');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [errors, setErrors] = useState({});

  const isSearchingMembers = memberSearchQuery.trim().length > 0;

  const recentContacts = useMemo(
    () => mockContacts.filter((contact) => recentContactIds.includes(contact.id)),
    [mockContacts],
  );

  const filteredContacts = useMemo(() => {
    const query = memberSearchQuery.trim().toLowerCase();
    if (!query) {
      return mockContacts;
    }
    return mockContacts.filter((contact) => contact.name.toLowerCase().includes(query));
  }, [mockContacts, memberSearchQuery]);

  function toggleMember(contactId) {
    setSelectedMemberIds((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId],
    );
    if (errors.members) {
      setErrors((prev) => ({ ...prev, members: undefined }));
    }
  }

  function handleCancel() {
    navigation.goBack();
  }

  function handleCreateGroup() {
    const nextErrors = {};
    if (!groupName.trim()) {
      nextErrors.groupName = 'Enter a group name.';
    }
    if (selectedMemberIds.length === 0) {
      nextErrors.members = 'Select at least one member.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    const newGroup = {
      id: `group-${Date.now()}`,
      name: groupName.trim(),
      // Persisted (not discarded) as of
      // docs/decisions/0005-split-add-expense-flow.md §2.1 — Group-mode
      // splitting needs to know who the members actually are, not just a
      // count. Does NOT include the current user, who is implicitly a
      // member of every group they create; `memberCount` is now a derived
      // value (`memberContactIds.length + 1`), not stored here.
      memberContactIds: selectedMemberIds,
      lastActivity: 'Group created',
      yourBalance: 0,
    };
    addGroup(newGroup);

    // Activity log (ADR 0008 §2.3) — logged unconditionally, regardless of
    // whether this screen was opened from its original "New Group" button
    // or via Split Add Expense's "Create New Group" returnTo round trip.
    // memberCount reuses the same `memberContactIds.length + 1` derivation
    // used everywhere else a member count is displayed in this app.
    addActivity(
      buildGroupCreatedActivity({
        group: newGroup,
        memberCount: newGroup.memberContactIds.length + 1,
      }),
    );

    // Generalizes CategoryPickerScreen.jsx's own returnTo mechanism
    // (ADR 0005 §3) a second time — ADR 0006 §4. No returnTo param (this
    // screen's original entry point) keeps the exact original goBack()
    // behavior.
    const returnTo = route.params?.returnTo;
    if (returnTo) {
      navigation.popTo(returnTo, { selectedGroup: newGroup });
    } else {
      navigation.goBack();
    }
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="New Group" onClose={handleCancel} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.photoNameRow}>
          <View style={styles.photoColumn}>
            <Avatar initials="" size="large" style={styles.photoPlaceholder} />
            <Text style={styles.photoLabel}>Add group photo</Text>
          </View>
          <TextInput
            label="GROUP NAME"
            value={groupName}
            onChangeText={setGroupName}
            placeholder="e.g. Flatmates"
            error={errors.groupName}
            style={styles.groupNameInput}
          />
        </View>

        <Text style={styles.sectionHeader}>Add Members</Text>
        <SearchBar
          value={memberSearchQuery}
          onChangeText={setMemberSearchQuery}
          placeholder="Search contacts"
          style={styles.searchBar}
        />

        {!isSearchingMembers && recentContacts.length > 0 ? (
          <>
            <Text style={styles.subSectionHeader}>Recent</Text>
            <View style={styles.recentRow}>
              {recentContacts.map((contact) => {
                const isSelected = selectedMemberIds.includes(contact.id);
                return (
                  <Pressable
                    key={contact.id}
                    style={styles.recentContact}
                    onPress={() => toggleMember(contact.id)}
                    accessibilityRole="button"
                  >
                    <Avatar
                      initials={contact.initials}
                      size="medium"
                      style={isSelected ? styles.recentAvatarSelected : null}
                    />
                    <Text style={styles.recentContactName} numberOfLines={1}>
                      {contact.name.split(' ')[0]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={styles.subSectionHeader}>All Contacts</Text>
        {errors.members ? <Text style={styles.errorText}>{errors.members}</Text> : null}
        <Card style={styles.contactsCard}>
          {filteredContacts.length > 0 ? (
            filteredContacts.map((contact, index) => {
              const isSelected = selectedMemberIds.includes(contact.id);
              return (
                <ListItem
                  key={contact.id}
                  leading={<Avatar initials={contact.initials} size="small" />}
                  title={contact.name}
                  onPress={() => toggleMember(contact.id)}
                  trailing={<Checkbox checked={isSelected} />}
                  style={index === filteredContacts.length - 1 ? styles.lastListItem : null}
                />
              );
            })
          ) : (
            <Text style={styles.emptyText}>
              No contacts match &quot;{memberSearchQuery.trim()}&quot;.
            </Text>
          )}
        </Card>

        <PrimaryButton
          label="Create Group"
          onPress={handleCreateGroup}
          style={styles.createButton}
        />
      </ScrollView>
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    scroll: {
      flex: 1,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.xxl,
    },
    // Photo + Name side by side (docs/ui/design-system.md Section 10.4),
    // replacing the previous stacked Avatar-then-Card layout.
    photoNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: theme.space.xl,
    },
    photoColumn: {
      width: 88,
      alignItems: 'flex-start',
      marginRight: theme.space.lg,
    },
    photoPlaceholder: {
      marginBottom: theme.space.sm,
    },
    photoLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
    },
    groupNameInput: {
      flex: 1,
      marginBottom: 0,
    },
    sectionHeader: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      marginBottom: theme.space.md,
    },
    subSectionHeader: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.md,
    },
    searchBar: {
      marginBottom: theme.space.lg,
    },
    recentRow: {
      flexDirection: 'row',
      marginBottom: theme.space.xl,
    },
    recentContact: {
      alignItems: 'center',
      marginRight: theme.space.lg,
      width: 64,
    },
    recentAvatarSelected: {
      borderWidth: 2,
      borderColor: theme.color.accent.primary,
      borderRadius: theme.radius.circle,
      padding: 2,
    },
    recentContactName: {
      color: theme.color.text.secondary,
      fontSize: theme.type.caption.fontSize,
      marginTop: theme.space.xs,
    },
    errorText: {
      color: theme.color.status.negative,
      fontSize: theme.type.caption.fontSize,
      marginBottom: theme.space.sm,
    },
    contactsCard: {
      marginBottom: theme.space.xl,
    },
    lastListItem: {
      paddingBottom: 0,
    },
    emptyText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      paddingVertical: theme.space.sm,
    },
    createButton: {
      marginBottom: theme.space.lg,
    },
  });
}

export default NewGroupScreen;
