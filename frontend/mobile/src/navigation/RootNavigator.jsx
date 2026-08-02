import React, { useCallback, useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/useAuthStore';
import { useBudgetStore } from '../store/useBudgetStore';
import { resolveGateActivePeriod } from '../store/postAuthGate';
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
import WhoPaidScreen from '../screens/modals/WhoPaidScreen';
import SyncStatusScreen from '../screens/modals/SyncStatusScreen';
import ChangeDetailScreen from '../screens/main/ChangeDetailScreen';

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
 * Splash is a TWO-condition gate as of docs/decisions/
 * 0016-frontend-api-integration.md §8.1: it hides only once BOTH the timer
 * has elapsed AND restoreSession() has settled. Restore is a local keychain
 * read and is normally far faster than the splash beat, so the perceived cost
 * is zero in the common case — but hiding the splash first would flash
 * AuthStack and then jump to MainTabs (or to the mandatory budget gate),
 * which looks like a bug.
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
  const isRestoringSession = useAuthStore((state) => state.isRestoringSession);
  const theme = useTheme();
  const [hasSplashTimerElapsed, setHasSplashTimerElapsed] = useState(false);
  const [postAuthDestination, setPostAuthDestination] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setHasSplashTimerElapsed(true), SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  // Cold-start session restore (ADR 0016 §8.2) — read once, on mount. Called
  // through getState() rather than subscribing to the action, so this effect
  // can keep an empty dependency list and can never fire twice.
  useEffect(() => {
    useAuthStore.getState().restoreSession();
  }, []);

  const [gateError, setGateError] = useState(null);

  // Hydrates the account's on-device cache, starts the sync engine, then
  // resolves the active period and routes —
  // docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.4.
  // Online, the server's period wins (5 s cap). Offline, or when the backend
  // cannot be reached, the CACHED period (with any queued budget save
  // applied) routes instead of the splash Retry. Only with no cache and no
  // network does the splash keep its Retry ("Connect once to load your
  // budget"). getPostAuthDestination itself is unchanged.
  const resolvePostAuthDestination = useCallback(async () => {
    const user = useAuthStore.getState().user;
    if (!user) {
      return;
    }
    setGateError(null);
    const result = await resolveGateActivePeriod(user.id);
    if (!useAuthStore.getState().isAuthenticated) {
      return;
    }
    if (!result.resolved) {
      setGateError(result.errorMessage);
      return;
    }
    setPostAuthDestination(
      result.periodUnknown
        ? 'Dashboard'
        : getPostAuthDestination(useAuthStore.getState().user, result.activePeriod),
    );
  }, []);

  // One-shot per isAuthenticated transition — docs/decisions/
  // 0011-post-auth-budget-gate.md §3. Keyed on isAuthenticated only, never on
  // activePeriod or user, so a mid-session budget edit or profile refresh can
  // never yank the user out of MainTabs.
  useEffect(() => {
    setPostAuthDestination(null);
    if (isAuthenticated) {
      resolvePostAuthDestination();
    }
  }, [isAuthenticated, resolvePostAuthDestination]);

  // Two-condition gate (ADR 0016 §8.1): the splash beat AND session restore.
  if (!hasSplashTimerElapsed || isRestoringSession) {
    return <SplashScreen />;
  }

  // Authenticated but the destination is not known yet: the active-period
  // read is in flight, or failed and is waiting on Retry.
  if (isAuthenticated && postAuthDestination === null) {
    return (
      <SplashScreen errorMessage={gateError} onRetry={resolvePostAuthDestination} />
    );
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
          {/* Change Detail — pushed (not modal) from both the Activities feed
              (ProfileStack) and Transaction Detail (MyExpenseStack), so it is
              registered once here rather than in each tab's stack
              (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md
              §8.9). Renders its own ScreenHeader. */}
          <RootStack.Screen name="ChangeDetail" component={ChangeDetailScreen} />
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
            <RootStack.Screen
              name="WhoPaid"
              component={WhoPaidScreen}
              // Pushed from Adjust Split's "Multiple people" row (returns via
              // popTo('AdjustSplit')) or How Was This Split?'s "Paid by
              // multiple people" row (returnTo: 'SplitAddExpense'). Own
              // ScreenHeader (back + checkmark) —
              // docs/decisions/0025-multiple-payers-per-split-expense.md §8.4.
              options={{ headerShown: false }}
            />
            <RootStack.Screen
              name="SyncStatus"
              component={SyncStatusScreen}
              // Opened from the offline banner (ADR 0027 §8.9). Own
              // ScreenHeader (close only).
              options={{ headerShown: false }}
            />
          </RootStack.Group>
        </RootStack.Group>
      )}
    </RootStack.Navigator>
  );
}

export default RootNavigator;
