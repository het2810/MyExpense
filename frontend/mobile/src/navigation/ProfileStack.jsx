import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ProfileScreen from '../screens/main/ProfileScreen';
import ActivitiesScreen from '../screens/main/ActivitiesScreen';
import BudgetSettingsScreen from '../screens/main/BudgetSettingsScreen';
import BudgetSummaryScreen from '../screens/main/BudgetSummaryScreen';
import NotificationsScreen from '../screens/main/NotificationsScreen';
import ManageCategoriesScreen from '../screens/main/ManageCategoriesScreen';

const Stack = createNativeStackNavigator();

/**
 * Profile tab stack — docs/architecture/frontend-navigation.md Section 2.
 * ProfileHome is the initial route.
 *
 * Activities is a real push route (docs/decisions/0008-activity-log-system.md
 * §5) — reached from ProfileScreen's "Activities" preferences row.
 *
 * BudgetSettings/BudgetSummary (docs/decisions/0010-budget-settings.md,
 * 0011-post-auth-budget-gate.md's second same-day amendment) — the same
 * two shared screen components the root-level mandatory gate renders
 * (RootNavigator.jsx), registered here a second time as normal,
 * back-navigable pushes (`isMandatory` omitted/false in this instance).
 * Reached from ProfileScreen's "Budget Settings" preferences row, which
 * routes to whichever of the two is appropriate depending on whether the
 * current activePeriod has already ended (ProfileScreen.jsx's
 * handlePreferencePress).
 *
 * Notifications (docs/decisions/0012-notifications-system.md) is now built
 * too — reached from this tab's header bell (NotificationBell.jsx,
 * ScreenHeader's rightSlot) — the same shared NotificationsScreen component
 * also registered in MyExpenseStack.jsx/SplitStack.jsx (one component,
 * three route registrations, per frontend-navigation.md §2.3's
 * long-standing plan). Profile's own former "Notifications" preferences row
 * is removed (profileMocks.js) — the header bell is the sole entry point.
 *
 * ManageCategories (new 2026-10-23, Project Owner request) — reached from
 * ProfileScreen's "Manage Categories" preferences row, which replaced the
 * former "Subcategories" switch. A plain back-navigable push, exactly like
 * Activities and BudgetSettings above and for the same reason: it is a
 * drill-down into data the account already has, not a creation flow, so it is
 * not a root-level modal. Needs a row in frontend-navigation.md §2.3 and in
 * its screen inventory — the System Architect owns that file.
 */
function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileHome" component={ProfileScreen} />
      <Stack.Screen name="Activities" component={ActivitiesScreen} />
      <Stack.Screen name="BudgetSettings" component={BudgetSettingsScreen} />
      <Stack.Screen name="BudgetSummary" component={BudgetSummaryScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="ManageCategories" component={ManageCategoriesScreen} />
    </Stack.Navigator>
  );
}

export default ProfileStack;
