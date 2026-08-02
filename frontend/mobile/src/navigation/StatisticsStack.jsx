import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import StatisticsScreen from '../screens/main/StatisticsScreen';
import CategoryTransactionsScreen from '../screens/main/CategoryTransactionsScreen';
import NotificationsScreen from '../screens/main/NotificationsScreen';

const Stack = createNativeStackNavigator();

/**
 * Statistics tab stack — the fourth tab, added with
 * docs/decisions/0022-statistics-expenses-by-parent-category.md's frontend
 * work. StatisticsHome is the initial route.
 *
 * CategoryTransactions is the drill-down behind a tapped category bar
 * (docs/api/api-overview.md §14.1 / that ADR §6) — a plain back-navigable
 * push, exactly like TransactionDetail on the MyExpense stack and
 * ManageCategories on the Profile stack, and for the same reason: it is a
 * drill-down into data the account already has, not a creation flow, so it is
 * not a root-level modal. It carries **no new endpoint**; it reads
 * `GET /transactions?categoryId=&dateFrom=&dateTo=` (§4.1).
 *
 * Notifications is the same shared NotificationsScreen component already
 * registered in MyExpenseStack.jsx/SplitStack.jsx/ProfileStack.jsx — one
 * component, now four route registrations, because
 * `NotificationBell.navigate('Notifications')` resolves to whichever tab
 * stack's own registration is nearest, so back navigation always returns to
 * the tab the user was already on (docs/decisions/0012-notifications-system.md
 * §2). **Registering it here is what makes the header bell on this tab work at
 * all** — without it the bell would resolve nothing.
 *
 * Needs a row in docs/architecture/frontend-navigation.md §2.3 and in its
 * screen inventory, plus a §6 icon entry and a chart/empty-state treatment in
 * docs/ui/design-system.md — the System Architect owns both files (ADR 0022's
 * Consequences note that the Statistics screen's UI pass is raised through
 * them).
 */
function StatisticsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="StatisticsHome" component={StatisticsScreen} />
      <Stack.Screen name="CategoryTransactions" component={CategoryTransactionsScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
    </Stack.Navigator>
  );
}

export default StatisticsStack;
