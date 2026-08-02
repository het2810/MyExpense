module.exports = {
  preset: '@react-native/jest-preset',
  // Official mocks for the two native modules added by
  // docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §1 —
  // wired in jest.setup.js. Appended to the preset's own setupFiles.
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The preset transforms `react-native` and `@react-native(-community)`
  // packages only; AsyncStorage v3 ships its mock as an ES module under
  // `@react-native-async-storage`, so that scope is added here.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage)/)',
  ],
};
