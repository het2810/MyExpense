import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useAuthStore } from '../../store/useAuthStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useProfileStore } from '../../store/useProfileStore';
import { useBudgetStore } from '../../store/useBudgetStore';
import { isPeriodEnded } from '../../utils/budgetPeriod';
import ScreenHeader from '../../components/ScreenHeader';
import ThemeToggleButton from '../../components/ThemeToggleButton';
import NotificationBell from '../../components/NotificationBell';
import Avatar from '../../components/Avatar';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import ToggleSwitch from '../../components/ToggleSwitch';
import { profileUser, profileStats, preferenceItems } from '../../mocks/profileMocks';

/**
 * Profile — stats, preferences list, upgrade banner. Mock data only
 * (src/mocks/profileMocks.js) — there is no user-profile API yet.
 *
 * [ASSUMPTION] design-system.md Section 5 specifies a "[bell][theme toggle]
 * [avatar]" header cluster on every main screen; here only NotificationBell
 * and ThemeToggleButton are shown since Profile already has a large avatar
 * as its hero element — a second, redundant small avatar in the header that
 * navigates to the screen you're already on would be a dead affordance.
 * Flagging for System Architect confirmation (pre-existing note, unrelated
 * to the NotificationBell addition below — docs/decisions/
 * 0012-notifications-system.md §2).
 */
function ProfileScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const logout = useAuthStore((state) => state.logout);
  const overspendingAlertsEnabled = useSettingsStore((state) => state.overspendingAlertsEnabled);
  const toggleOverspendingAlerts = useSettingsStore((state) => state.toggleOverspendingAlerts);
  const paymentModeEnabled = useSettingsStore((state) => state.paymentModeEnabled);
  const togglePaymentMode = useSettingsStore((state) => state.togglePaymentMode);
  const isPremiumUser = useProfileStore((state) => state.isPremiumUser);
  const toggleIsPremiumUser = useProfileStore((state) => state.toggleIsPremiumUser);
  const styles = createStyles(theme);

  // Two 'toggle'-type preferenceItems now exist (Payment Mode, Overspending
  // Alerts), each bound to its own Zustand store field/action — keyed by
  // item.id rather than assuming a single toggle row, per
  // docs/ui/design-system.md Section 7.1.
  const TOGGLE_BINDINGS = {
    'pref-payment-mode': { value: paymentModeEnabled, onValueChange: togglePaymentMode },
    'pref-overspending-alerts': {
      value: overspendingAlertsEnabled,
      onValueChange: toggleOverspendingAlerts,
    },
  };

  // Mid-session budget-gate re-check (docs/decisions/
  // 0011-post-auth-budget-gate.md's second same-day amendment, Part D) —
  // hooked here, at the moment "Budget Settings" is tapped, NOT inside
  // BudgetSettingsScreen's own save validation (that's a separate concern,
  // §4 of the same amendment — whether the period about to be SAVED is
  // itself already dead on arrival). This check instead asks: did the
  // period already sitting in useBudgetStore — the one about to be edited —
  // already end BEFORE this tap? It reads activePeriod exactly as it stood
  // at the moment of the tap, before any edit exists; a user voluntarily
  // adjusting a still-active period early is never routed through
  // BudgetSummary, regardless of what they change it to.
  function handlePreferencePress(item) {
    if (item.action === 'logout') {
      logout();
      return;
    }
    if (item.action === 'activities') {
      // docs/decisions/0008-activity-log-system.md §5 — the first
      // preferenceItems row whose target screen actually exists.
      navigation.navigate('Activities');
      return;
    }
    if (item.id === 'pref-budget') {
      const activePeriod = useBudgetStore.getState().activePeriod;
      if (activePeriod && isPeriodEnded(activePeriod)) {
        navigation.navigate('BudgetSummary', { period: activePeriod });
      } else {
        navigation.navigate('BudgetSettings');
      }
    }
    // "Notifications" no longer has a preferences row at all (docs/decisions/
    // 0012-notifications-system.md §1/§5.6) — the header bell above is now
    // the sole entry point to that screen.
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader
        rightSlot={
          <>
            <NotificationBell />
            <ThemeToggleButton />
          </>
        }
      />

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.identityBlock}>
          <Avatar initials={profileUser.initials} size="large" />
          <Text style={styles.name}>{profileUser.name}</Text>
          <Text style={styles.email}>{profileUser.email}</Text>
        </View>

        <Card style={styles.statsCard}>
          {profileStats.map((stat, index) => (
            <View
              key={stat.id}
              style={[styles.statItem, index !== profileStats.length - 1 && styles.statDivider]}
            >
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </Card>

        {/* Tap-to-toggle mock premium testing affordance — ADR 0007 §3.2.
            No real purchase/billing flow exists; tapping simply flips
            useProfileStore().isPremiumUser, which also gates
            TransactionDetailScreen's Payment Method card. */}
        <Pressable onPress={toggleIsPremiumUser} accessibilityRole="button">
          <Card style={styles.upgradeBanner}>
            <Text style={styles.upgradeTitle}>
              {isPremiumUser ? 'Premium Active' : 'Upgrade to Premium'}
            </Text>
            <Text style={styles.upgradeSubtitle}>
              {isPremiumUser
                ? 'Thanks for supporting MyExpense — all premium features unlocked.'
                : 'Unlock AI insights, receipt scanning, and unlimited groups.'}
            </Text>
          </Card>
        </Pressable>

        <Text style={styles.sectionHeader}>Preferences</Text>
        <Card>
          {preferenceItems.map((item, index) => {
            const isToggle = item.type === 'toggle';
            const binding = TOGGLE_BINDINGS[item.id];
            // Currency premium-lock gate — docs/decisions/
            // 0013-confirmation-dialog-and-free-tier-polish.md §3,
            // design-system.md §17. Free tier: row dims to opacity 0.5
            // (matching PrimaryButton's own disabled opacity) and shows a
            // "PREMIUM" chip badge in the trailing slot; onPress is ALWAYS
            // omitted (both tiers) — no currency-switching destination
            // exists this round, so a tappable row would be a dead
            // affordance.
            const isCurrencyRow = item.id === 'pref-currency';
            const isCurrencyLocked = isCurrencyRow && !isPremiumUser;
            return (
              <View key={item.id}>
                <ListItem
                  title={item.label}
                  subtitle={item.subtitle}
                  style={isCurrencyLocked ? styles.currencyRowDimmed : undefined}
                  trailing={
                    isToggle && binding ? (
                      <ToggleSwitch
                        value={binding.value}
                        onValueChange={binding.onValueChange}
                      />
                    ) : isCurrencyLocked ? (
                      <PremiumBadge />
                    ) : undefined
                  }
                  onPress={
                    isToggle || isCurrencyRow ? undefined : () => handlePreferencePress(item)
                  }
                />
                {index !== preferenceItems.length - 1 ? <View style={styles.rowDivider} /> : null}
              </View>
            );
          })}
        </Card>
      </ScrollView>
    </View>
  );
}

/**
 * "PREMIUM" chip badge — the Currency row's free-tier lock indicator
 * (docs/decisions/0013-confirmation-dialog-and-free-tier-polish.md §3).
 * Reuses the exact chip formula ListItem's own `badges` prop already
 * established for the payment-mode ("CASH"/"ONLINE"/"BOTH") and "SPLIT"
 * tags — `radius.sm` corners, `background.surfaceAlt` fill, `type.label`
 * text — with one deliberate difference: text color `accent.text`, not
 * `text.secondary`. A "you could unlock this" call-to-action tag should
 * read differently from those neutral, descriptive tags, not share their
 * exact treatment. No prior locked/premium-row convention existed anywhere
 * in this app before this round (checked, not assumed — see the ADR); this
 * is the first one, designed to be reused by any future gated row.
 */
function PremiumBadge() {
  const theme = useTheme();
  const styles = createPremiumBadgeStyles(theme);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>PREMIUM</Text>
    </View>
  );
}

function createPremiumBadgeStyles(theme) {
  return StyleSheet.create({
    badge: {
      alignSelf: 'flex-start',
      borderRadius: theme.radius.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      paddingHorizontal: theme.space.sm,
      paddingVertical: theme.space.xs,
    },
    badgeText: {
      color: theme.color.accent.text,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
    },
  });
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      paddingHorizontal: theme.space.xl,
      // This screen renders behind the floating tab bar only (no FAB). Its
      // top edge sits `getTabBarTopEdge(theme)` (theme/layout.js) = 80px
      // above the screen bottom; adding `theme.space.lg` (16px) leaves a
      // comfortable gap above it instead of just grazing it, for a total of
      // 96px — computed from the same constants MainTabs.jsx positions the
      // tab bar with, so this can't silently drift out of sync.
      paddingBottom: getTabBarTopEdge(theme) + theme.space.lg,
    },
    identityBlock: {
      alignItems: 'center',
      marginBottom: theme.space.xl,
    },
    name: {
      color: theme.color.text.primary,
      fontSize: theme.type.h1.fontSize,
      fontWeight: theme.type.h1.fontWeight,
      marginTop: theme.space.md,
    },
    email: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginTop: theme.space.xs,
    },
    statsCard: {
      flexDirection: 'row',
      marginBottom: theme.space.lg,
    },
    statItem: {
      flex: 1,
      alignItems: 'center',
    },
    statDivider: {
      borderRightWidth: 1,
      borderRightColor: theme.color.border.subtle,
    },
    statValue: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      fontWeight: theme.type.h2.fontWeight,
      marginBottom: theme.space.xs,
    },
    statLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      textAlign: 'center',
    },
    upgradeBanner: {
      backgroundColor: theme.color.background.surfaceAlt,
      marginBottom: theme.space.xl,
    },
    upgradeTitle: {
      color: theme.color.accent.text,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
      marginBottom: theme.space.xs,
    },
    upgradeSubtitle: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    sectionHeader: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      marginBottom: theme.space.md,
    },
    rowDivider: {
      height: 1,
      backgroundColor: theme.color.border.subtle,
    },
    // Free-tier Currency row dimming — the exact opacity value
    // PrimaryButton's own `disabled` state already uses (token-level
    // consistency, not a new opacity value) — docs/decisions/
    // 0013-confirmation-dialog-and-free-tier-polish.md §3.
    currencyRowDimmed: {
      opacity: 0.5,
    },
  });
}

export default ProfileScreen;
