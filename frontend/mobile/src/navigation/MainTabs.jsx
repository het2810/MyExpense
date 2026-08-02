import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';
import { getTabBarBottomOffset, getTabBarHeight } from '../theme/layout';
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
 *
 * Safe areas: this is a full-width, square-cornered bar anchored to the
 * physical bottom edge. Its height includes the bottom inset so the fill
 * covers the strip behind the system navigation bar, and it pads itself by
 * that inset from within to keep icons/labels clear of it — see
 * theme/layout.js. `insets` comes from this component's own
 * `useSafeAreaInsets()` call because layout.js is deliberately hook-free.
 */
function MainTabs() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

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
          left: 0,
          right: 0,
          // Kept in sync with theme/layout.js (TAB_BAR_HEIGHT /
          // getTabBarBottomOffset) — screens compute their clearing padding
          // from those same exports, so this bar's actual position/size
          // must never drift from what they assume. That helper already
          // includes `insets.bottom`, so nothing is added to it here.
          bottom: getTabBarBottomOffset(theme, insets),
          height: getTabBarHeight(theme, insets),
          borderRadius: 0,
          paddingTop: theme.space.sm,
          // The bar is anchored at the physical bottom edge and its height
          // already includes `insets.bottom` (getTabBarHeight), so the fill
          // covers the strip behind the system navigation bar. This padding
          // is what keeps the icons and labels out of that strip, leaving
          // them in the TAB_BAR_HEIGHT band above it. Set explicitly rather
          // than relying on BottomTabBar's own default, because `tabBarStyle`
          // is merged last and would otherwise win. Zero where there is no
          // bottom system bar.
          paddingBottom: insets.bottom,
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
