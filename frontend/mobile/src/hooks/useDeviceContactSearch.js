import { useMemo } from 'react';
import { useDeviceContacts } from './useDeviceContacts';
import { excludeSelectedNumbers, filterDeviceContacts } from '../utils/deviceContacts';

/**
 * Most rows a picker renders at once. An address book can hold thousands of
 * entries and both pickers live inside a form's ScrollView, so the rest is
 * reached by searching ("Search to see N more"), the hint the CONTACT dropdown
 * already used.
 */
const MAX_VISIBLE_CONTACTS = 30;

/**
 * The device address book, searched (name or number) and capped for a picker.
 *
 * @param {{ enabled: boolean, query: string, excludeSelections?: object[] }} args
 *   `excludeSelections` drops already-selected numbers (the CONTACT field's
 *   rule); New Group passes nothing and shows checkboxes instead.
 * @returns {ReturnType<typeof useDeviceContacts> & {
 *   visibleContacts: object[],
 *   hiddenCount: number,
 *   matchCount: number,
 * }}
 */
export function useDeviceContactSearch({ enabled, query, excludeSelections }) {
  const deviceContacts = useDeviceContacts(enabled);
  const { contacts } = deviceContacts;

  const matches = useMemo(() => {
    const available = excludeSelections ? excludeSelectedNumbers(contacts, excludeSelections) : contacts;
    return filterDeviceContacts(available, query);
  }, [contacts, excludeSelections, query]);

  return {
    ...deviceContacts,
    visibleContacts: matches.slice(0, MAX_VISIBLE_CONTACTS),
    hiddenCount: Math.max(0, matches.length - MAX_VISIBLE_CONTACTS),
    matchCount: matches.length,
  };
}
