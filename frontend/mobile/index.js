/**
 * @format
 */

// Must be imported before anything else — required by React Navigation.
import 'react-native-gesture-handler';
// Installs crypto.getRandomValues, which src/offline/ids.js needs to mint
// offline-write ids (ADR 0027 — pre-approved dependency). Must load before
// any module that generates an id.
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
