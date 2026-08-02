import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DashboardScreen from '../screens/main/DashboardScreen';

const Stack = createNativeStackNavigator();

/**
 * MyExpense tab stack — docs/architecture/frontend-navigation.md Section 2.
 * Dashboard is the only route built this phase. AllExpenses, ExpenseDetail,
 * and Notifications are documented as future pushes onto this same stack —
 * intentionally not registered yet (nothing currently navigates to them,
 * so they're not needed for the navigator to compile; see scope note in
 * this phase's Frontend Engineer task).
 */
function MyExpenseStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
    </Stack.Navigator>
  );
}

export default MyExpenseStack;
