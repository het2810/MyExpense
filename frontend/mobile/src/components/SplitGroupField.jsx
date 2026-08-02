import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import ListItem from './ListItem';
import SearchBar from './SearchBar';
import InlineMessage from './InlineMessage';

/**
 * Split Add Expense's GROUP field — the trigger, the in-place list with search,
 * and the "Create New Group" row (docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §4, docs/ui/design-system.md
 * §10.2). Extracted from SplitAddExpenseScreen.jsx unchanged in behaviour,
 * so that screen could take the edit mode of docs/decisions/
 * 0028-split-expense-edit-delete-feeds-and-balance-copy.md §11.5 without
 * growing (constitution §26). The sibling of `SplitContactField.jsx`.
 *
 * The list's open state and search query are this field's own; the selection
 * stays with the screen, because participants and the request are built from
 * it.
 *
 * @param {{ groups: object[], selectedGroup: object | null,
 *   onSelectGroup: (group: object) => void, onClearGroup: () => void,
 *   onCreateGroup: (suggestedName: string) => void, error?: string,
 *   loadError?: string | null, onRetry?: () => void }} props
 */
function SplitGroupField({
  groups,
  selectedGroup,
  onSelectGroup,
  onClearGroup,
  onCreateGroup,
  error,
  loadError,
  onRetry,
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [isListOpen, setIsListOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // ADR 0006 §4: filter by name; the create row shows while searching or when
  // nothing matches.
  const isSearching = searchQuery.trim().length > 0;
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return groups;
    }
    return groups.filter((group) => group.name.toLowerCase().includes(query));
  }, [groups, searchQuery]);
  const showCreateRow = isSearching || filteredGroups.length === 0;

  function handleSelect(group) {
    setIsListOpen(false);
    setSearchQuery('');
    onSelectGroup(group);
  }

  function handleCreate() {
    setIsListOpen(false);
    onCreateGroup(searchQuery.trim());
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>GROUP</Text>
      <Pressable
        style={styles.fieldTrigger}
        onPress={() => setIsListOpen((previous) => !previous)}
        accessibilityRole="button"
      >
        {selectedGroup ? (
          <>
            <Text style={[styles.fieldText, styles.fieldTextFill]}>{selectedGroup.name}</Text>
            {/* Same ✕ glyph placeholder as the CONTACT field. */}
            <Pressable
              onPress={onClearGroup}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${selectedGroup.name}`}
            >
              <Text style={styles.clearGlyph}>✕</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.fieldPlaceholder}>
            {groups.length === 0 ? 'No groups yet' : 'Select a group'}
          </Text>
        )}
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {isListOpen ? (
        <View style={styles.inlineList}>
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search groups"
            style={styles.searchBar}
          />
          {filteredGroups.map((group) => (
            <ListItem key={group.id} title={group.name} onPress={() => handleSelect(group)} />
          ))}
          {/* Same rule as the contact list: a failed read says so, with a
              Retry, instead of reading as "No groups yet". */}
          {loadError ? (
            <InlineMessage message={loadError} onRetry={onRetry} />
          ) : isSearching && filteredGroups.length === 0 ? (
            <Text style={styles.emptySearchText}>No groups match &quot;{searchQuery.trim()}&quot;.</Text>
          ) : !isSearching && groups.length === 0 ? (
            <Text style={styles.emptySearchText}>No groups yet.</Text>
          ) : null}
          {showCreateRow ? (
            <ListItem title="Create New Group" onPress={handleCreate} style={styles.createItem} />
          ) : null}
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
    fieldText: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    fieldTextFill: {
      flex: 1,
    },
    clearGlyph: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.bodyLg.fontSize,
      paddingHorizontal: theme.space.sm,
    },
    fieldPlaceholder: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.bodyLg.fontSize,
    },
    errorText: {
      color: theme.color.status.negative,
      fontSize: theme.type.caption.fontSize,
      marginTop: theme.space.xs,
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
    createItem: {
      borderTopWidth: 1,
      borderTopColor: theme.color.border.subtle,
      marginTop: theme.space.xs,
      paddingTop: theme.space.sm,
    },
    emptySearchText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginTop: theme.space.sm,
    },
  });
}

export default SplitGroupField;
