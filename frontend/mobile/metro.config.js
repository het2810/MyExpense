const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // Native build output churns rapidly (CMake temp dirs, Gradle build/) and
  // isn't part of the JS source tree. Watching it crashes Metro's fallback
  // file watcher on Windows (no Watchman) with ENOENT when a transient dir
  // disappears mid-scan.
  resolver: {
    blockList: [
      /android[/\\]app[/\\]\.cxx[/\\].*/,
      /android[/\\]app[/\\]build[/\\].*/,
      /android[/\\]\.gradle[/\\].*/,
      /ios[/\\]build[/\\].*/,
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
