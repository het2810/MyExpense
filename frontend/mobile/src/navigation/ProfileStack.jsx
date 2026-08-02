import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ProfileScreen from '../screens/main/ProfileScreen';

const Stack = createNativeStackNavigator();

/**
 * Profile tab stack — docs/architecture/frontend-navigation.md Section 2.
 * ProfileHome is the only route built this phase. BudgetSettings and
 * Notifications are documented as future pushes onto this same stack — not
 * registered yet (see scope note in this phase's Frontend Engineer task).
 */
function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileHome" component={ProfileScreen} />
    </Stack.Navigator>
  );
}

export default ProfileStack;
