/**
 * Client-generated ids — docs/decisions/0027-offline-first-local-cache-and-replay-sync.md
 * §1.3/§3.
 *
 * These ids become **primary keys** on the server, so they must come from a
 * cryptographically secure generator. `Math.random()` is forbidden here: a
 * predictable id lets an attacker squat a row a victim's device will create
 * (§3.6).
 *
 * The runtime must expose `global.crypto.getRandomValues`. React Native
 * 0.86's Hermes does not ship it, so `react-native-get-random-values`
 * (pre-approved by ADR 0027 §1.3) must be installed and imported first in
 * `index.js` before `OFFLINE_WRITES_ENABLED` is turned on. Until then this
 * module throws rather than falling back to anything weaker — and nothing
 * calls it while the flag is off.
 */

/**
 * @returns {boolean}
 */
export function isSecureRandomAvailable() {
  return typeof global.crypto?.getRandomValues === 'function';
}

const HEX = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, '0'));

/**
 * RFC 4122 version-4 UUID from 16 CSPRNG bytes.
 *
 * @returns {string}
 * @throws {Error} When no secure random source exists.
 */
export function newId() {
  if (!isSecureRandomAvailable()) {
    throw new Error(
      'A secure random generator is not available. Install react-native-get-random-values.',
    );
  }
  const bytes = new Uint8Array(16);
  global.crypto.getRandomValues(bytes);
  // Version 4 and the RFC 4122 variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => HEX[byte]);
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
