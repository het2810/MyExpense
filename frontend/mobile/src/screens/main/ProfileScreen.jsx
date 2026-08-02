import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useAuthStore } from '../../store/useAuthStore';
import { useBudgetStore } from '../../store/useBudgetStore';
import { useUserIdentity } from '../../hooks/useUserIdentity';
import { useUserSettings } from '../../hooks/useUserSettings';
import { useCurrentUserProfile } from '../../hooks/useCurrentUserProfile';
import { useSignOutGuard } from '../../hooks/useSignOutGuard';
import { useIsOnline } from '../../hooks/useSyncStatus';
import ConfirmationDialog from '../../components/ConfirmationDialog';
import { isPeriodEnded } from '../../utils/budgetPeriod';
import ScreenHeader from '../../components/ScreenHeader';
import ThemeToggleButton from '../../components/ThemeToggleButton';
import NotificationBell from '../../components/NotificationBell';
import Avatar from '../../components/Avatar';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import ToggleSwitch from '../../components/ToggleSwitch';
import InlineMessage from '../../components/InlineMessage';
import { profileStats, preferenceItems } from '../../mocks/profileMocks';

/**
 * Profile — identity, stats, preferences list, upgrade banner.
 *
 * Server-backed as of Domain 2's wiring step (docs/api/api-overview.md §2,
 * docs/roadmap/backend-build-order.md workflow step 3): name/email/initials
 * come from `GET /users/me` (via useUserIdentity, which falls back to the
 * stored session so the block is never blank), the two preference toggles
 * from `GET`/`PATCH /users/me/settings`, and the upgrade banner from
 * `GET /users/me` + `PATCH /users/me/premium`. Both reads are triggered by
 * this screen's own hooks — nothing is fetched at app start.
 *
 * Still mock, deliberately: `profileStats` (nothing backs Total Spent /
 * Groups / Transactions until Transactions and Splits exist) and the
 * `preferenceItems` row definitions. The Currency row is unchanged —
 * premium-badged and destination-less; it can only lose the badge together
 * with a real currency-selection screen, which does not exist yet.
 *
 * The "Subcategories" switch that briefly lived in this list is gone as of
 * 2026-10-23 (Project Owner request). It is now the top bar of the new Manage
 * Categories screen, where it sits above the category list it reshapes, and
 * this list has a "Manage Categories" navigation row in its place. The setting
 * is unchanged — same `subcategoriesEnabled` field, same store action.
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
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { requestSignOut, dialog: signOutDialog } = useSignOutGuard();
  // Log Out is a real network call as of docs/decisions/
  // 0016-frontend-api-integration.md §6.4 (POST /api/v1/auth/logout), so the
  // row disables while it is in flight. Behavior is otherwise unchanged: this
  // screen still does not navigate — the isAuthenticated flip does the work.
  const isLoggingOut = useAuthStore((state) => state.isLoggingOut);
  const identity = useUserIdentity();
  const settings = useUserSettings();
  const profile = useCurrentUserProfile();
  const isPremiumUser = profile.isPremium;
  const styles = createStyles(theme, insets);

  // All three switches are inert until the server's values are known, and
  // while any settings PATCH is in flight. The store owns the reasoning
  // (pending-until-confirmed, one in-flight write at a time — see
  // useSettingsStore.js); this is only how that shows up on screen. The
  // consequence to know: offline, these rows are read-only rather than
  // flipping to a value that was never saved.
  const areTogglesDisabled = !settings.hasLoaded || settings.isBusy;
  // Premium is an entitlement the server must confirm, so it is online-only
  // (ADR 0027 §9): disabled offline, with "Connect to change this." below.
  const isOnline = useIsOnline();
  const isPremiumToggleDisabled = !profile.hasLoaded || profile.isSavingPremium || !isOnline;

  // Two 'toggle'-type preferenceItems exist (Payment Mode, Overspending
  // Alerts), each bound to its own server-backed field/setter — keyed by
  // item.id rather than assuming a single toggle row, per
  // docs/ui/design-system.md Section 7.1. The setters take the value the
  // Switch reports rather than flipping local state, so what is sent is
  // exactly what the user asked for.
  //
  // **"Subcategories" was a third entry here until 2026-10-23 and no longer
  // is.** The switch itself moved to the new Manage Categories screen
  // (ManageCategoriesScreen.jsx), where it sits directly above the category
  // list it reshapes — a lone toggle on this screen never showed what turning
  // it on actually does. This screen's row for it is now a plain navigation
  // row ('manage-categories'). Nothing about the *setting* changed: it is the
  // same `subcategoriesEnabled` field on `GET`/`PATCH /users/me/settings`,
  // read and written through the same useSettingsStore action, so no
  // preference is lost or re-keyed.
  const TOGGLE_BINDINGS = {
    'pref-payment-mode': {
      value: settings.paymentModeEnabled,
      onValueChange: settings.setPaymentModeEnabled,
    },
    'pref-overspending-alerts': {
      value: settings.overspendingAlertsEnabled,
      onValueChange: settings.setOverspendingAlertsEnabled,
    },
  };

  // Error copy already mapped to user-facing wording by the API layer
  // (src/api/errorMessages.js) — never a raw server message and never a stack
  // trace (constitution §22). A failed read offers Retry; a failed write does
  // not need one, since the switch is still there to tap again.
  const premiumMessage =
    profile.premiumError || profile.loadError || (isOnline ? null : 'Connect to change this.');
  const settingsMessage = settings.saveError || settings.loadError;

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
      // Async as of ADR 0016 §6.4, but deliberately not awaited here: the
      // store owns the in-flight flag this row renders, and local sign-out is
      // guaranteed by that action's own `finally` even if the network call
      // fails or the device is offline. With unsynced changes queued, the
      // guard asks first (ADR 0027 §8.9); otherwise it logs out directly.
      requestSignOut();
      return;
    }
    if (item.action === 'activities') {
      // docs/decisions/0008-activity-log-system.md §5 — the first
      // preferenceItems row whose target screen actually exists.
      navigation.navigate('Activities');
      return;
    }
    if (item.action === 'manage-categories') {
      // Added 2026-10-23, replacing the former "Subcategories" switch on this
      // screen. A plain push in ProfileStack.jsx, the same shape as Activities
      // above (frontend-navigation.md §2.3) — not a modal: it is a
      // drill-down into existing data, not a creation flow.
      navigation.navigate('ManageCategories');
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

  // Tap-to-toggle premium is a real write now (PATCH /users/me/premium,
  // api-overview.md §2.5) rather than a local flip. Deliberately not awaited:
  // the store owns the in-flight flag this banner renders from, and sends an
  // explicit target value rather than "flip" so a retry can never ask for the
  // opposite of what was intended.
  function handleTogglePremium() {
    profile.setPremium(!isPremiumUser);
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
          <Avatar initials={identity.initials} size="large" />
          <Text style={styles.name}>{identity.fullName}</Text>
          <Text style={styles.email}>{identity.email}</Text>
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

        {/* Tap-to-toggle premium affordance — ADR 0007 §3.2, now persisted
            through PATCH /users/me/premium (api-overview.md §2.5). Still a
            boolean stub with no purchase/billing flow behind it; what changed
            is that the flip survives a reinstall and is the same value that
            gates TransactionDetailScreen's Payment Method card. Inert (and
            dimmed) until the profile has loaded and while a write is in
            flight — there is nothing to toggle away from before the current
            value is known, and a second tap must not queue a contradictory
            write. Copy is unchanged. */}
        <Pressable
          onPress={handleTogglePremium}
          disabled={isPremiumToggleDisabled}
          accessibilityRole="button"
        >
          <Card style={[styles.upgradeBanner, isPremiumToggleDisabled && styles.rowDimmed]}>
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

        <InlineMessage
          message={premiumMessage}
          onRetry={profile.loadError ? profile.reload : null}
        />

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
            // Same dimmed/inert treatment while the logout request is in
            // flight, so the row can't be tapped twice (ADR 0016 §7).
            const isLogoutInFlight = item.action === 'logout' && isLoggingOut;
            return (
              <View key={item.id}>
                <ListItem
                  title={item.label}
                  subtitle={item.subtitle}
                  style={isCurrencyLocked || isLogoutInFlight ? styles.rowDimmed : undefined}
                  trailing={
                    isToggle && binding ? (
                      <ToggleSwitch
                        value={binding.value}
                        onValueChange={binding.onValueChange}
                        disabled={areTogglesDisabled}
                      />
                    ) : isCurrencyLocked ? (
                      <PremiumBadge />
                    ) : undefined
                  }
                  onPress={
                    isToggle || isCurrencyRow || isLogoutInFlight
                      ? undefined
                      : () => handlePreferencePress(item)
                  }
                />
                {index !== preferenceItems.length - 1 ? <View style={styles.rowDivider} /> : null}
              </View>
            );
          })}
        </Card>

        <InlineMessage
          message={settingsMessage}
          onRetry={settings.loadError ? settings.reload : null}
          style={styles.settingsMessage}
        />
      </ScrollView>

      {/* Sign-out with unsynced changes (ADR 0027 §8.9). */}
      <ConfirmationDialog
        visible={signOutDialog.visible}
        title={signOutDialog.title}
        message={signOutDialog.message}
        confirmLabel="Sign out anyway"
        secondaryLabel={signOutDialog.secondaryLabel}
        onSecondary={signOutDialog.onSecondary}
        onConfirm={signOutDialog.onConfirm}
        onCancel={signOutDialog.onCancel}
      />
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

function createStyles(theme, insets) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      paddingHorizontal: theme.space.xl,
      // This screen renders behind the floating tab bar only (no FAB). Its
      // top edge sits `getTabBarTopEdge(theme, insets)` (theme/layout.js) =
      // 80px above the screen bottom on a device with no navigation bar, and
      // that much plus the bottom inset on one that has it; adding
      // `theme.space.lg` (16px) leaves a comfortable gap above it instead of
      // just grazing it — computed from the same constants MainTabs.jsx
      // positions the tab bar with, so this can't silently drift out of sync.
      paddingBottom: getTabBarTopEdge(theme, insets) + theme.space.lg,
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
    // Shared dim treatment for an inert row — the premium-locked Currency
    // row, the Log Out row while its request is in flight, and the upgrade
    // banner while the premium write is in flight (or before the profile has
    // loaded). Matches PrimaryButton's own disabled opacity.
    rowDimmed: {
      opacity: 0.5,
    },
    // The settings message sits under the Preferences card, which has no
    // bottom margin of its own.
    settingsMessage: {
      marginTop: theme.space.lg,
      marginBottom: 0,
    },
  });
}

export default ProfileScreen;
