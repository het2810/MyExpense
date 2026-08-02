import { Linking, PermissionsAndroid, Platform } from 'react-native';
import Contacts from 'react-native-contacts';

/**
 * The device address book — the only module that touches
 * `react-native-contacts` and the contacts permission. The device-side
 * counterpart of `src/api/*`: thin calls, no state, no React, never a store.
 *
 * **Permission states**, one vocabulary for both platforms:
 * - `'granted'` — readable (iOS "limited" access counts: the user chose which
 *   contacts to share, and those are readable).
 * - `'denied'` — refused, but the system will ask again.
 * - `'blocked'` — refused for good; only the app's Settings page can change it.
 *   Android: "Don't ask again" / a second refusal (`never_ask_again`). iOS: any
 *   refusal, because iOS shows its prompt once per install.
 *
 * Nothing here logs a contact or a number (docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §1: device contacts are
 * third-party PII).
 */

const ANDROID_PERMISSION = PermissionsAndroid.PERMISSIONS.READ_CONTACTS;

/**
 * @param {string} iosStatus `'authorized' | 'limited' | 'denied' | 'undefined'`
 * @returns {'granted' | 'blocked' | 'undetermined'}
 */
function fromIosStatus(iosStatus) {
  if (iosStatus === 'authorized' || iosStatus === 'limited') {
    return 'granted';
  }
  return iosStatus === 'denied' ? 'blocked' : 'undetermined';
}

/**
 * Asks for access, showing the system prompt only when the OS still allows
 * one. Safe to call when access is already granted: no prompt appears.
 *
 * @returns {Promise<'granted' | 'denied' | 'blocked'>}
 */
export async function requestContactsPermission() {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(ANDROID_PERMISSION);
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      return 'granted';
    }
    return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
  }
  const status = fromIosStatus(await Contacts.requestPermission());
  return status === 'undetermined' ? 'denied' : status;
}

/**
 * Reads the current state without prompting — used when the app returns to
 * the foreground, in case the user changed it in Settings.
 *
 * @returns {Promise<boolean>} whether access is granted.
 */
export async function hasContactsPermission() {
  if (Platform.OS === 'android') {
    return PermissionsAndroid.check(ANDROID_PERMISSION);
  }
  return fromIosStatus(await Contacts.checkPermission()) === 'granted';
}

/**
 * Every device contact, with thumbnails. Call only once access is granted.
 *
 * @returns {Promise<object[]>} `react-native-contacts` `Contact[]`.
 */
export function readDeviceContacts() {
  return Contacts.getAll();
}

/** Opens this app's page in the system Settings. */
export function openAppSettings() {
  return Linking.openSettings();
}
