import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme } from '../theme/useTheme';
import MyExpenseStack from './MyExpenseStack';
import SplitStack from './SplitStack';
import ProfileStack from './ProfileStack';
import IconBadge from '../components/IconBadge';

const Tab = createBottomTabNavigator();

// [ASSUMPTION] No icon font/vector-icon library is installed this phase, so
// tab icons are short text glyphs via IconBadge rather than true icons.
const TAB_GLYPHS = {
  MyExpenseTab: '₹',
  SplitTab: '⇄',
  ProfileTab: 'P',
};

/**
 * Bottom tab bar — MyExpense / Split / Profile, each owning its own stack
 * navigator (docs/architecture/frontend-navigation.md Section 2.3). Title
 * case labels per design-system.md Section 1.1's flagged assumption.
 */
function MainTabs() {
  const theme = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.color.accent.text,
        tabBarInactiveTintColor: theme.color.text.tertiary,
        tabBarStyle: {
          backgroundColor: theme.color.background.surface,
          borderTopWidth: 0,
          position: 'absolute',
          left: theme.space.xl,
          right: theme.space.xl,
          bottom: theme.space.lg,
          height: 64,
          borderRadius: theme.radius.pill,
          paddingTop: theme.space.sm,
        },
        tabBarLabelStyle: {
          fontSize: theme.type.caption.fontSize,
          fontWeight: '600',
        },
        tabBarIcon: ({ focused }) => (
          <IconBadge
            glyph={TAB_GLYPHS[route.name]}
            tone={focused ? 'accent' : 'neutral'}
            size="small"
          />
        ),
      })}
    >
      <Tab.Screen name="MyExpenseTab" component={MyExpenseStack} options={{ title: 'MyExpense' }} />
      <Tab.Screen name="SplitTab" component={SplitStack} options={{ title: 'Split' }} />
      <Tab.Screen name="ProfileTab" component={ProfileStack} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

export default MainTabs;
