import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { useGroups } from '../../hooks/useGroups';
import { useDeviceContactSearch } from '../../hooks/useDeviceContactSearch';
import { useDeviceContactResolver } from '../../hooks/useDeviceContactResolver';
import { getDeviceSelectionId, toDeviceSelection } from '../../utils/deviceContacts';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import SearchBar from '../../components/SearchBar';
import Avatar from '../../components/Avatar';
import ScreenHeader from '../../components/ScreenHeader';
import FormMessage from '../../components/FormMessage';
import DeviceContactRow from '../../components/DeviceContactRow';
import DeviceContactsNotice from '../../components/DeviceContactsNotice';

/**
 * New Group — root-level modal (docs/architecture/frontend-navigation.md
 * Section 2.4).
 *
 * **A real write as of Domain 6's wiring step**: `POST /api/v1/groups`
 * (docs/api/api-overview.md §7.2).
 *
 * **Members are picked from the device address book** (Project Owner,
 * 2026-11-12), searched by name or number. Picking persists nothing; at
 * Create Group each picked number is resolved to a backend contact — reused by
 * number, else created (`hooks/useDeviceContactResolver.js`) — and those ids
 * become `memberContactIds`.
 *
 * Three consequences of the real endpoint, visible here:
 *
 * - **`memberContactIds` are contact ids and the creator is added
 *   server-side** (§7.2), so nothing here adds "you" to the list.
 * - **Duplicates collapse rather than erroring** — §7.2 defines no `409`, and
 *   two contacts linked to the same account become one member
 *   (`backend/README.md` §15.3(d)).
 * - **Each unlinked member with a phone triggers the same invite** §6.2 fires.
 *   The response carries no `inviteStatus`, so this screen deliberately says
 *   nothing about it — claiming an invite went out would be inventing an
 *   outcome the contract does not report (and the gateway is a logging stub
 *   either way).
 *
 * **The "Recent" contacts strip is gone.** It was driven by
 * `contactsMocks.recentContactIds`, a hand-written list of mock ids that can
 * never match a server contact id, so after wiring it could only ever render
 * empty. §6.1 exposes no recency or usage signal to replace it with, and
 * inventing one client-side (most recently created? most split with?) would be
 * fabricating a product rule. Flagged in this round's report rather than faked.
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
 * Activity log: **this screen no longer writes one.** It used to mint a local
 * `group_created` entry (ADR 0008 §2.3) because §11 was unwired. Domain 7's
 * wiring step made `GET /api/v1/activities` (api-overview.md §11.1) the source
 * of the Activities feed, and an `activities` row is written only by the
 * server's own fan-out — §11 has no write endpoint at all
 * (`backend/README.md` §17). A client-minted entry would sit in that feed
 * looking like a server one and would exist on no other device.
 *
 * **Note the honest consequence:** nothing in the backend writes a
 * `group_created` row either, so creating a group currently produces no
 * activity entry anywhere (`backend/README.md` §17.8 flag 8 — the sentence,
 * icon, glyph, tone and recipient rule for that type are all still
 * unspecified). That is a gap to close server-side, not something to paper over
 * here.
 */
function NewGroupScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { createGroup, isSaving } = useGroups();
  const { resolveContactIds } = useDeviceContactResolver();
  const styles = createStyles(theme, insets);

  const [groupName, setGroupName] = useState(route.params?.suggestedName ?? '');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  // Device selections (`utils/deviceContacts.js#toDeviceSelection`), in pick order.
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [isResolvingMembers, setIsResolvingMembers] = useState(false);
  const [errors, setErrors] = useState({});
  // Form-level copy for a failed `POST /groups` — it belongs to no single
  // field (ADR 0016 §9.1's slot).
  const [formError, setFormError] = useState(null);

  // Opening this screen is what asks for contacts permission.
  const {
    status: contactsStatus,
    contacts,
    visibleContacts,
    hiddenCount,
    matchCount,
    requestAccess,
    reload: reloadContacts,
    openSettings,
  } = useDeviceContactSearch({ enabled: true, query: memberSearchQuery });
  const selectedIds = useMemo(
    () => new Set(selectedMembers.map((member) => member.id)),
    [selectedMembers],
  );

  function toggleMember(contact, phone) {
    const id = getDeviceSelectionId(phone.e164);
    setSelectedMembers((prev) =>
      prev.some((member) => member.id === id)
        ? prev.filter((member) => member.id !== id)
        : [...prev, toDeviceSelection(contact, phone)],
    );
    if (errors.members) {
      setErrors((prev) => ({ ...prev, members: undefined }));
    }
  }

  function handleCancel() {
    navigation.goBack();
  }

  async function handleCreateGroup() {
    const nextErrors = {};
    if (!groupName.trim()) {
      nextErrors.groupName = 'Enter a group name.';
    }
    if (selectedMembers.length === 0) {
      nextErrors.members = 'Select at least one member.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setFormError(null);

    // Picked numbers -> backend contacts, only now that the group is saved.
    setIsResolvingMembers(true);
    const resolution = await resolveContactIds(selectedMembers);
    setIsResolvingMembers(false);
    if (!resolution.success) {
      setFormError(resolution.error);
      return;
    }

    const result = await createGroup({
      name: groupName.trim(),
      // The caller's own contact ids (§7.2). The creator is added
      // server-side and must not be listed — which is also why the member
      // count below is `members.length` and no longer `+ 1`.
      memberContactIds: selectedMembers.map(
        (member) => resolution.contactIdBySelectionId.get(member.id) ?? member.id,
      ),
    });

    if (!result.success) {
      setFormError(result.error);
      return;
    }

    const newGroup = result.group;

    // No activity-log write here any more — see this screen's note. The
    // server's fan-out owns §11.1's feed, and it does not currently write a
    // `group_created` row.

    // Generalizes CategoryPickerScreen.jsx's own returnTo mechanism
    // (ADR 0005 §3) a second time — ADR 0006 §4. No returnTo param (this
    // screen's original entry point) keeps the exact original goBack()
    // behavior. The group handed back is the server's `GroupResponse`, which
    // is exactly what Split Add Expense's GROUP field now expects.
    const returnTo = route.params?.returnTo;
    if (returnTo) {
      // `{ merge: true }` — see CategoryPickerScreen's `popTo` note: the
      // flagless form replaces the destination's params instead of layering
      // onto them. The only caller today is Split Add Expense, whose params are
      // consumed at mount, so nothing is lost now; merging closes the trap for
      // any future caller that is still holding one.
      navigation.popTo(returnTo, { selectedGroup: newGroup }, { merge: true });
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
          placeholder="Search name or number"
          style={styles.searchBar}
        />

        <Text style={styles.subSectionHeader}>
          {selectedMembers.length > 0 ? `All Contacts · ${selectedMembers.length} selected` : 'All Contacts'}
        </Text>
        {errors.members ? <Text style={styles.errorText}>{errors.members}</Text> : null}
        <Card style={styles.contactsCard}>
          {contactsStatus !== 'ready' ? (
            <DeviceContactsNotice
              status={contactsStatus}
              onRequestAccess={requestAccess}
              onOpenSettings={openSettings}
              onRetry={reloadContacts}
            />
          ) : matchCount > 0 ? (
            <>
              {visibleContacts.map((contact, index) => (
                <DeviceContactRow
                  key={contact.recordID}
                  contact={contact}
                  onSelectPhone={toggleMember}
                  selectedIds={selectedIds}
                  showCheckbox
                  style={
                    index === visibleContacts.length - 1 && hiddenCount === 0
                      ? styles.lastListItem
                      : null
                  }
                />
              ))}
              {hiddenCount > 0 ? (
                <Text style={styles.emptyText}>
                  Search to see {hiddenCount} more {hiddenCount === 1 ? 'contact' : 'contacts'}.
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.emptyText}>
              {contacts.length === 0
                ? 'There are no contacts on this device.'
                : `No contacts match "${memberSearchQuery.trim()}".`}
            </Text>
          )}
        </Card>

        <FormMessage message={formError} />

        <PrimaryButton
          label="Create Group"
          onPress={handleCreateGroup}
          // The create is no longer instantaneous; a second tap would fire a
          // second `POST /groups` (the store also guards it, this is the
          // visible half).
          disabled={isSaving || isResolvingMembers}
          style={styles.createButton}
        />
      </ScrollView>
    </View>
  );
}

function createStyles(theme, insets) {
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
      paddingTop: theme.space.xxl,
      // Trailing space measured from the top of the bottom system bar, so
      // the "Create Group" button never sits under it. 0 where there is no
      // bar — same designed spacing as before.
      paddingBottom: theme.space.xxl + insets.bottom,
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
    // The four `recent*` styles that lived here are gone with the "Recent"
    // contacts strip — see this screen's header note for why that strip could
    // no longer render anything.
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
