import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useDeviceContactSearch } from '../hooks/useDeviceContactSearch';
import { toDeviceSelection } from '../utils/deviceContacts';
import Avatar from './Avatar';
import SearchBar from './SearchBar';
import DeviceContactRow from './DeviceContactRow';
import DeviceContactsNotice from './DeviceContactsNotice';

/**
 * Split Add Expense's CONTACT field — a multi-select with removable chips
 * (docs/decisions/0026-multi-contact-individual-splits.md §8.1), whose
 * dropdown lists the **device address book** (Project Owner, 2026-11-12;
 * reverses ADR 0006 §1's "not yet").
 *
 * - One chip per selected person, in selection order: avatar, name and a ✕
 *   that removes only that person. Then an "Add person" chip that opens the
 *   dropdown. With nothing selected the field reads "Select a contact".
 * - Opening the dropdown is what asks for contacts permission
 *   (`hooks/useDeviceContacts.js`); refused, blocked, loading and failed
 *   states render in its place (`components/DeviceContactsNotice.jsx`).
 * - Search matches names and numbers as the user types. Already-selected
 *   numbers are not offered again.
 * - A contact with several numbers is one row; the user picks the number. A
 *   contact with no usable number is shown but cannot be picked.
 *
 * **Manual "Create Contact" is gone**, and selecting persists nothing: a
 * selection is local (`id: 'device:+91…'`) until the split is saved, when
 * Split Add Expense resolves it to a backend contact
 * (`hooks/useDeviceContactResolver.js`).
 *
 * The selection itself is owned by the screen (`hooks/useSplitContactSelection.js`),
 * which builds participants and the request from it; this component only asks
 * to add or remove. A refused add (already selected, the 49-person cap) shows
 * its reason under the field.
 *
 * @param {{
 *   selectedContacts: object[],
 *   onAddContact: (contact: object) => { added: boolean, error: string | null },
 *   onRemoveContact: (contactId: string) => void,
 *   error?: string | null,
 * }} props
 */
function SplitContactField({ selectedContacts, onAddContact, onRemoveContact, error }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  const [isListOpen, setIsListOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [addError, setAddError] = useState(null);

  const {
    status,
    contacts,
    visibleContacts,
    hiddenCount,
    matchCount,
    requestAccess,
    reload,
    openSettings,
  } = useDeviceContactSearch({
    enabled: isListOpen,
    query: searchQuery,
    excludeSelections: selectedContacts,
  });
  const isSearching = searchQuery.trim().length > 0;

  function handleSelectPhone(contact, phone) {
    const result = onAddContact(toDeviceSelection(contact, phone));
    if (!result.added) {
      setAddError(result.error);
      return;
    }
    setIsListOpen(false);
    setSearchQuery('');
    setAddError(null);
  }

  function handleRemoveContact(contact) {
    onRemoveContact(contact.id);
    setAddError(null);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>CONTACT</Text>
      {selectedContacts.length > 0 ? (
        <View style={styles.chipRow}>
          {selectedContacts.map((contact) => (
            <View key={contact.id} style={styles.chip}>
              <Avatar
                source={contact.thumbnailUri ? { uri: contact.thumbnailUri } : undefined}
                initials={contact.initials}
                size="small"
                style={styles.chipAvatar}
              />
              <Text style={styles.chipText} numberOfLines={1}>
                {contact.name}
              </Text>
              {/* Glyph placeholder for a close icon — same fallback convention
                  ScreenHeader's ✕ uses (ADR 0002). */}
              <Pressable
                onPress={() => handleRemoveContact(contact)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${contact.name}`}
              >
                <Text style={styles.chipRemove}>✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            style={[styles.chip, styles.addChip]}
            onPress={() => setIsListOpen((prev) => !prev)}
            accessibilityRole="button"
          >
            <Text style={styles.addChipText}>+ Add person</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={styles.fieldTrigger}
          onPress={() => setIsListOpen((prev) => !prev)}
          accessibilityRole="button"
        >
          <Text style={styles.fieldPlaceholder}>Select a contact</Text>
        </Pressable>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {addError ? <Text style={styles.errorText}>{addError}</Text> : null}

      {isListOpen ? (
        <View style={styles.inlineList}>
          {status === 'ready' ? (
            <>
              <SearchBar
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search name or number"
                style={styles.searchBar}
              />
              {visibleContacts.map((contact) => (
                <DeviceContactRow
                  key={contact.recordID}
                  contact={contact}
                  onSelectPhone={handleSelectPhone}
                />
              ))}
              {contacts.length === 0 ? (
                <Text style={styles.emptySearchText}>There are no contacts on this device.</Text>
              ) : isSearching && matchCount === 0 ? (
                <Text style={styles.emptySearchText}>
                  No contacts match &quot;{searchQuery.trim()}&quot;.
                </Text>
              ) : matchCount === 0 ? (
                <Text style={styles.emptySearchText}>
                  Everyone in your contacts is already in this split.
                </Text>
              ) : hiddenCount > 0 ? (
                <Text style={styles.helperText}>
                  Search to see {hiddenCount} more {hiddenCount === 1 ? 'contact' : 'contacts'}.
                </Text>
              ) : null}
            </>
          ) : (
            <DeviceContactsNotice
              status={status}
              onRequestAccess={requestAccess}
              onOpenSettings={openSettings}
              onRetry={reload}
              style={styles.notice}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      marginBottom: theme.space.lg,
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
    fieldTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      paddingBottom: theme.space.sm,
      minHeight: 40,
    },
    fieldPlaceholder: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.bodyLg.fontSize,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.space.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      paddingBottom: theme.space.sm,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: '100%',
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      backgroundColor: theme.color.background.surfaceAlt,
      paddingVertical: theme.space.xs,
      paddingLeft: theme.space.xs,
      paddingRight: theme.space.sm,
    },
    chipAvatar: {
      marginRight: theme.space.xs,
    },
    chipText: {
      flexShrink: 1,
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
    chipRemove: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.body.fontSize,
      paddingLeft: theme.space.sm,
    },
    addChip: {
      paddingLeft: theme.space.md,
      paddingRight: theme.space.md,
      minHeight: 32,
    },
    addChipText: {
      color: theme.color.accent.primary,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
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
    notice: {
      paddingTop: theme.space.sm,
    },
    emptySearchText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginTop: theme.space.sm,
    },
    errorText: {
      color: theme.color.status.negative,
      fontSize: theme.type.caption.fontSize,
      marginTop: theme.space.xs,
    },
    helperText: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      marginTop: theme.space.xs,
    },
  });
}

export default SplitContactField;
