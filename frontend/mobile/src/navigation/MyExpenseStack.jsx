import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DashboardScreen from '../screens/main/DashboardScreen';
import TransactionDetailScreen from '../screens/main/TransactionDetailScreen';
import NotificationsScreen from '../screens/main/NotificationsScreen';

const Stack = createNativeStackNavigator();

/**
 * MyExpense tab stack — docs/architecture/frontend-navigation.md Section 2.
 * Dashboard and TransactionDetail (added per docs/decisions/
 * 0007-transaction-detail-screen.md §9 — a plain stack push, not a modal,
 * reached by tapping a Dashboard transaction row) were the routes built in
 * an earlier phase. Notifications (docs/decisions/
 * 0012-notifications-system.md) is now built too — reached from this tab's
 * header bell (NotificationBell.jsx, ScreenHeader's rightSlot) — the same
 * shared NotificationsScreen component also registered in
 * SplitStack.jsx/ProfileStack.jsx (one component, three route
 * registrations, per frontend-navigation.md §2.3's long-standing plan).
 * AllExpenses is documented as a future push onto this same stack —
 * intentionally not registered yet (nothing currently navigates to it, so
 * it's not needed for the navigator to compile).
 */
function MyExpenseStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
    </Stack.Navigator>
  );
}

export default MyExpenseStack;
