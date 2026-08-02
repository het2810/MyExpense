import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/useAuthStore';
import { useTheme } from '../theme/useTheme';
import SplashScreen from '../screens/SplashScreen';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';
import PlaceholderScreen from '../screens/PlaceholderScreen';

const RootStack = createNativeStackNavigator();

// Splash is shown for a fixed beat on cold start, matching the PDF's
// glow-in splash animation (docs/architecture/frontend-navigation.md
// Section 2.1). [ASSUMPTION] Exact duration isn't specified in the PDF
// beyond "~1.5-2s"; 1800ms was picked as a reasonable midpoint.
const SPLASH_DURATION_MS = 1800;

/**
 * Root navigator — docs/architecture/frontend-navigation.md Section 2.
 *
 * Splash renders first regardless of auth state. After the timer elapses,
 * this swaps between AuthStack and MainTabs by conditionally rendering the
 * appropriate navigator based on useAuthStore.isAuthenticated — not by
 * pushing screens across stacks (Section 2.1's explicit instruction).
 *
 * Root-level modals (AddExpense, NewGroup, CategoryPicker) are registered
 * alongside MainTabs so they can be presented over any tab
 * (Section 2.4). They are STUB screens (PlaceholderScreen) this phase —
 * see docs/decisions/0001-shared-component-library.md and this phase's
 * scope discipline notes; full UI for these three is future work.
 */
function RootNavigator() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const theme = useTheme();
  const [isSplashVisible, setIsSplashVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsSplashVisible(false), SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  if (isSplashVisible) {
    return <SplashScreen />;
  }

  return (
    <RootStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.color.background.base },
      }}
    >
      {isAuthenticated ? (
        <RootStack.Group>
          <RootStack.Screen name="MainTabs" component={MainTabs} />
          <RootStack.Group
            screenOptions={{
              presentation: 'modal',
              headerShown: true,
            }}
          >
            <RootStack.Screen
              name="AddExpense"
              component={PlaceholderScreen}
              options={{ title: 'Add Expense' }}
            />
            <RootStack.Screen
              name="NewGroup"
              component={PlaceholderScreen}
              options={{ title: 'New Group' }}
            />
            <RootStack.Screen
              name="CategoryPicker"
              component={PlaceholderScreen}
              options={{ title: 'Select Category' }}
            />
          </RootStack.Group>
        </RootStack.Group>
      ) : (
        <RootStack.Screen name="AuthStack" component={AuthStack} />
      )}
    </RootStack.Navigator>
  );
}

export default RootNavigator;
