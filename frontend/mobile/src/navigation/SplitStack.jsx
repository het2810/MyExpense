import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SplitGroupsListScreen from '../screens/main/SplitGroupsListScreen';

const Stack = createNativeStackNavigator();

/**
 * Split tab stack — docs/architecture/frontend-navigation.md Section 2.
 * SplitGroupsList is the only route built this phase. GroupDetail,
 * SplitExpenseDetail, SettlementFlow, and Notifications are documented as
 * future pushes onto this same stack — not registered yet (see scope note
 * in this phase's Frontend Engineer task).
 */
function SplitStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SplitGroupsList" component={SplitGroupsListScreen} />
    </Stack.Navigator>
  );
}

export default SplitStack;
