import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { getDeviceSelectionId } from '../utils/deviceContacts';
import Avatar from './Avatar';
import ListItem from './ListItem';
import Checkbox from './Checkbox';
import ExpandChevron from './ExpandChevron';

/**
 * One device contact in a picker — avatar (photo when the device has one),
 * name and number.
 *
 * - **One number**: tapping the row picks it.
 * - **Several numbers**: still one row, never one row per number. Tapping it
 *   expands the numbers underneath, and the user picks which one.
 * - **No usable number**: shown, dimmed and not tappable, saying why — a split
 *   participant needs a number the server accepts, and future invites go to it.
 *
 * @param {{
 *   contact: object,
 *   onSelectPhone: (contact: object, phone: object) => void,
 *   selectedIds?: Set<string>,
 *   showCheckbox?: boolean,
 *   style?: object,
 * }} props `selectedIds` holds selection ids (`device:+91…`); with
 *   `showCheckbox` each number shows whether it is selected.
 */
function DeviceContactRow({ contact, onSelectPhone, selectedIds, showCheckbox = false, style }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [isExpanded, setIsExpanded] = useState(false);
  const { phones } = contact;

  const isSelected = (phone) => Boolean(selectedIds?.has(getDeviceSelectionId(phone.e164)));
  const leading = (
    <Avatar
      source={contact.thumbnailUri ? { uri: contact.thumbnailUri } : undefined}
      initials={contact.initials}
      size="small"
    />
  );

  if (phones.length === 0) {
    return (
      <ListItem
        leading={leading}
        title={contact.name}
        titleTone="secondary"
        subtitle={contact.unusablePhoneCount > 0 ? "Number can't be used" : 'No phone number'}
        style={style}
      />
    );
  }

  if (phones.length === 1) {
    const [phone] = phones;
    return (
      <ListItem
        leading={leading}
        title={contact.name}
        subtitle={phone.display}
        onPress={() => onSelectPhone(contact, phone)}
        trailing={showCheckbox ? <Checkbox checked={isSelected(phone)} /> : undefined}
        style={style}
      />
    );
  }

  const selectedCount = phones.filter(isSelected).length;
  const toggle = () => setIsExpanded((prev) => !prev);

  return (
    <View style={style}>
      <ListItem
        leading={leading}
        title={contact.name}
        subtitle={
          selectedCount > 0
            ? `${phones.length} numbers · ${selectedCount} selected`
            : `${phones.length} numbers`
        }
        onPress={toggle}
        trailing={
          <ExpandChevron
            isExpanded={isExpanded}
            onPress={toggle}
            accessibilityLabel={`${isExpanded ? 'Hide' : 'Show'} numbers for ${contact.name}`}
          />
        }
      />
      {isExpanded
        ? phones.map((phone) => (
            <ListItem
              key={phone.e164}
              title={phone.display}
              subtitle={phone.label || undefined}
              onPress={() => onSelectPhone(contact, phone)}
              trailing={showCheckbox ? <Checkbox checked={isSelected(phone)} /> : undefined}
              style={styles.numberRow}
            />
          ))
        : null}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    // Indented under the contact's avatar so the numbers read as its children.
    numberRow: {
      paddingLeft: theme.space.xxxl + theme.space.md,
    },
  });
}

export default DeviceContactRow;
