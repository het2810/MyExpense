import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/useAuthStore';
import { useBudgetStore } from '../store/useBudgetStore';
import { useTheme } from '../theme/useTheme';
import { getPostAuthDestination } from './getPostAuthDestination';
import SplashScreen from '../screens/SplashScreen';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';
import BudgetSettingsScreen from '../screens/main/BudgetSettingsScreen';
import BudgetSummaryScreen from '../screens/main/BudgetSummaryScreen';
import AddExpenseScreen from '../screens/modals/AddExpenseScreen';
import NewGroupScreen from '../screens/modals/NewGroupScreen';
import CategoryPickerScreen from '../screens/modals/CategoryPickerScreen';
import SplitAddExpenseScreen from '../screens/modals/SplitAddExpenseScreen';
import HowWasThisSplitScreen from '../screens/modals/HowWasThisSplitScreen';
import AdjustSplitScreen from '../screens/modals/AdjustSplitScreen';

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
 * this swaps between AuthStack and the post-auth budget-gate/MainTabs
 * states by conditionally rendering the appropriate navigator/screen — not
 * by pushing screens across stacks (Section 2.1's explicit instruction).
 *
 * Post-auth budget gate (docs/decisions/0011-post-auth-budget-gate.md,
 * amended the same day — getPostAuthDestination is three-valued): a
 * one-shot effect, keyed on `isAuthenticated` transitioning to `true`,
 * computes `postAuthDestination` via getPostAuthDestination(user,
 * useBudgetStore.getState().activePeriod) exactly once per login/signup —
 * not a continuously-reactive useBudgetStore subscription, which would risk
 * yanking the user out of MainTabs mid-session (see that ADR §3 for the
 * full reasoning). Render branches on the result:
 * - 'BudgetSummary' -> the stored period already ended; a mandatory,
 *   non-dismissible BudgetSummaryScreen shows its final numbers before
 *   proceeding to BudgetGate.
 * - 'BudgetSettings' -> no period ever existed, or the user just proceeded
 *   from BudgetSummary; a mandatory, non-dismissible BudgetSettingsScreen.
 * - 'Dashboard' -> a valid, unexpired, funded period exists; MainTabs
 *   renders normally.
 * Neither mandatory screen navigates directly — both act through callbacks
 * (`onSetNewBudget`/`onComplete`) that flip this component's own local
 * `postAuthDestination` state.
 *
 * Root-level modals (AddExpense, NewGroup, CategoryPicker, and — as of
 * docs/decisions/0005-split-add-expense-flow.md — SplitAddExpense,
 * HowWasThisSplit, AdjustSplit) are registered alongside MainTabs so they
 * can be presented over any tab (Section 2.4). All six use mock data only
 * (no backend calls) — see src/screens/modals/ for each screen's own
 * top-of-file note. The three new Split-flow screens are additional
 * siblings in this same modal RootStack.Group (not a nested navigator) —
 * see ADR 0005 §7 / docs/architecture/frontend-navigation.md §2.4 for the
 * full confirmation of why this mirrors CategoryPicker's existing
 * modal-over-modal pattern rather than introducing a new one.
 */
function RootNavigator() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const theme = useTheme();
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const [postAuthDestination, setPostAuthDestination] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsSplashVisible(false), SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  // One-shot per isAuthenticated transition — docs/decisions/
  // 0011-post-auth-budget-gate.md §3. Reads useBudgetStore.getState()
  // directly (not a hook subscription) so this effect only re-runs when
  // isAuthenticated itself changes, never when activePeriod changes on its
  // own mid-session.
  useEffect(() => {
    if (isAuthenticated) {
      const activePeriod = useBudgetStore.getState().activePeriod;
      setPostAuthDestination(getPostAuthDestination(user, activePeriod));
    } else {
      setPostAuthDestination(null);
    }
  }, [isAuthenticated, user]);

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
      {!isAuthenticated ? (
        <RootStack.Screen name="AuthStack" component={AuthStack} />
      ) : postAuthDestination === 'BudgetSummary' ? (
        <RootStack.Screen name="BudgetSummaryGate">
          {() => (
            <BudgetSummaryScreen
              isMandatory
              period={useBudgetStore.getState().activePeriod}
              onSetNewBudget={() => setPostAuthDestination('BudgetSettings')}
            />
          )}
        </RootStack.Screen>
      ) : postAuthDestination === 'BudgetSettings' ? (
        <RootStack.Screen name="BudgetGate">
          {() => (
            <BudgetSettingsScreen
              isMandatory
              onComplete={() => setPostAuthDestination('Dashboard')}
            />
          )}
        </RootStack.Screen>
      ) : (
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
              component={AddExpenseScreen}
              // headerShown: false (overriding this Group's own
              // headerShown: true default) — AddExpenseScreen now renders
              // its own ScreenHeader (title="Add Expense", onClose slot for
              // Cancel) in-body, per docs/ui/design-system.md Section 7.7.
              // Leaving the native header on here would stack a second,
              // duplicate header above it.
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="NewGroup"
              component={NewGroupScreen}
              // headerShown: false (overriding this Group's own
              // headerShown: true default) — NewGroupScreen now renders its
              // own ScreenHeader (title="New Group", onClose slot for
              // Cancel) in-body, per docs/ui/design-system.md Section 10.4.
              // Same change already made for AddExpense (Section 7.7) —
              // leaving the native header on here would stack a second,
              // duplicate header above it.
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="CategoryPicker"
              component={CategoryPickerScreen}
              options={{ title: 'Select Category' }}
            />
            <RootStack.Screen
              name="SplitAddExpense"
              component={SplitAddExpenseScreen}
              // headerShown: false — SplitAddExpenseScreen renders its own
              // ScreenHeader (title="Split Expense", onClose + rightSlot
              // checkmark), same override AddExpense already uses (ADR 0005
              // §3.1).
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="HowWasThisSplit"
              component={HowWasThisSplitScreen}
              // headerShown: false — renders its own ScreenHeader (onBack
              // only, no checkmark — ADR 0005 §4).
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="AdjustSplit"
              component={AdjustSplitScreen}
              // headerShown: false — renders its own ScreenHeader (onBack +
              // rightSlot checkmark simultaneously — ADR 0005 §5).
              options={{ headerShown: false }}
            />
          </RootStack.Group>
        </RootStack.Group>
      )}
    </RootStack.Navigator>
  );
}

export default RootNavigator;
