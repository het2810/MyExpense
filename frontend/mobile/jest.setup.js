/* eslint-env jest */
/**
 * Jest setup — the official mocks for the offline layer's two native modules
 * (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §1).
 * Both packages ship them; nothing here re-implements either library.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// `src/offline/ids.js` needs a CSPRNG. Node ships Web Crypto; expose it if the
// test environment did not (never `Math.random`, even in tests).
if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  globalThis.crypto = require('crypto').webcrypto;
}
