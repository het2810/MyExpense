import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSyncStatus } from '../hooks/useSyncStatus';
import OfflineBanner from '../components/OfflineBanner';
import { useTheme } from '../theme/useTheme';
import { getTabBarBottomOffset, getTabBarHeight } from '../theme/layout';
import MyExpenseStack from './MyExpenseStack';
import SplitStack from './SplitStack';
import StatisticsStack from './StatisticsStack';
import ProfileStack from './ProfileStack';
import IconBadge from '../components/IconBadge';

const Tab = createBottomTabNavigator();

// [ASSUMPTION] No icon font/vector-icon library is installed this phase, so
// tab icons are short text glyphs via IconBadge rather than true icons.
//
// StatisticsTab's '▤' stands in for a stats/chart icon the way the three above
// stand in for theirs. docs/ui/design-system.md §6 has **no approved Ionicons
// name for a statistics concept** — `stats-chart-outline` would be a guess, and
// guessing an icon name is exactly what that section exists to prevent — so no
// name is invented here and the §6 entry is owed by the System Architect. The
// glyph is deliberately the horizontal-bars one, because horizontal bars are
// literally what the screen renders.
const TAB_GLYPHS = {
  MyExpenseTab: '₹',
  SplitTab: '⇄',
  StatisticsTab: '▤',
  ProfileTab: 'P',
};

/**
 * Bottom tab bar — MyExpense / Split / Statistics / Profile, each owning its
 * own stack navigator (docs/architecture/frontend-navigation.md Section 2.3).
 * Title case labels per design-system.md Section 1.1's flagged assumption.
 *
 * Statistics was added fourth (docs/decisions/
 * 0022-statistics-expenses-by-parent-category.md) and sits **third, before
 * Profile**: Profile is the account/settings tab and reads as the last one, and
 * Statistics belongs beside the two tabs whose data it summarizes. Nothing
 * about the existing three changed.
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
  const navigation = useNavigation();
  const { banner } = useSyncStatus();

  // Offline banner (ADR 0027 §8.9), rendered once, below the top inset. While
  // it shows, it owns the top inset itself, so the screens below it are given
  // `top: 0` through the safe-area context instead of padding twice.
  const childInsets = banner ? { ...insets, top: 0 } : insets;

  return (
    <View style={styles.flex}>
      {banner ? (
        <OfflineBanner
          message={banner.message}
          actionLabel={banner.actionLabel}
          tone={banner.tone}
          topInset={insets.top}
          onPress={() => navigation.navigate('SyncStatus')}
        />
      ) : null}
      <SafeAreaInsetsContext.Provider value={childInsets}>
        {renderTabs(theme, insets)}
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

/**
 * @param {object} theme
 * @param {{ top: number, bottom: number, left: number, right: number }} insets
 * @returns {React.ReactElement}
 */
function renderTabs(theme, insets) {
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
      <Tab.Screen
        name="StatisticsTab"
        component={StatisticsStack}
        options={{ title: 'Statistics' }}
      />
      <Tab.Screen name="ProfileTab" component={ProfileStack} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});

export default MainTabs;
