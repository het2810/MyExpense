/**
 * MyExpense — mobile app entry point.
 *
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import RootNavigator from './src/navigation/RootNavigator';
import { useTheme } from './src/theme/useTheme';
import { getNavigationTheme } from './src/navigation/navigationTheme';

function App() {
  const theme = useTheme();
  const navigationTheme = getNavigationTheme(theme);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* `initialMetrics` seeds the provider with the window's insets
          synchronously at startup. Without it, SafeAreaProvider renders
          nothing until the first native measurement arrives — and since
          ScreenHeader, MainTabs and FloatingActionButton now lay themselves
          out from those insets (src/theme/layout.js), that would show up as
          a visible reflow of the header and the floating tab bar on cold
          start. This is the seeding value the library exports for exactly
          this purpose; it is not a hardcoded per-device constant. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <StatusBar
          barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
          backgroundColor={theme.color.background.base}
        />
        <NavigationContainer theme={navigationTheme}>
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
