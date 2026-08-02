import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SplitGroupsListScreen from '../screens/main/SplitGroupsListScreen';
import SplitDetailScreen from '../screens/main/SplitDetailScreen';
import SplitExpenseDetailScreen from '../screens/main/SplitExpenseDetailScreen';
import SettleUpScreen from '../screens/main/SettleUpScreen';
import NotificationsScreen from '../screens/main/NotificationsScreen';

const Stack = createNativeStackNavigator();

/**
 * Split tab stack — docs/architecture/frontend-navigation.md Section 2.
 * SplitGroupsList, SplitDetail, SettleUp, and Notifications are the routes
 * built so far. SplitDetail (docs/decisions/0009-split-detail-and-settle-up.md)
 * fills this stack's previously-inventoried-but-unregistered "GroupDetail"
 * slot — one shared screen, parameterized by `mode: 'group' | 'individual'`,
 * reached from either of SplitGroupsList's tab cards. SettleUp (same ADR's
 * 2026-08-14 amendment) is reached from SplitDetail's "Settle Up" button —
 * a dedicated confirmation screen replacing the previous inline
 * Alert.alert flow. Notifications (docs/decisions/
 * 0012-notifications-system.md) is reached from this tab's header bell —
 * the same shared NotificationsScreen component also registered in
 * MyExpenseStack.jsx/ProfileStack.jsx (one component, three route
 * registrations, per frontend-navigation.md §2.3's long-standing plan).
 * SplitExpenseDetail (docs/decisions/
 * 0028-split-expense-edit-delete-feeds-and-balance-copy.md §11.3, inventory #11)
 * is pushed from a Split Detail feed row with `{ splitExpenseId, target }`.
 * SettlementFlow remains documented as a future push — not registered yet.
 */
function SplitStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SplitGroupsList" component={SplitGroupsListScreen} />
      <Stack.Screen name="SplitDetail" component={SplitDetailScreen} />
      <Stack.Screen name="SplitExpenseDetail" component={SplitExpenseDetailScreen} />
      <Stack.Screen name="SettleUp" component={SettleUpScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
    </Stack.Navigator>
  );
}

export default SplitStack;
