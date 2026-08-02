import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../store/useAuthStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import ScreenHeader from '../../components/ScreenHeader';
import ThemeToggleButton from '../../components/ThemeToggleButton';
import Avatar from '../../components/Avatar';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import ToggleSwitch from '../../components/ToggleSwitch';
import { profileUser, profileStats, preferenceItems } from '../../mocks/profileMocks';

/**
 * Profile — stats, preferences list, upgrade banner. Mock data only
 * (src/mocks/profileMocks.js) — there is no user-profile API yet.
 *
 * [ASSUMPTION] design-system.md Section 5 specifies a "[theme toggle]
 * [avatar]" header cluster on every main screen; here only ThemeToggleButton
 * is shown since Profile already has a large avatar as its hero element —
 * a second, redundant small avatar in the header that navigates to the
 * screen you're already on would be a dead affordance. Flagging for System
 * Architect confirmation.
 */
function ProfileScreen() {
  const theme = useTheme();
  const logout = useAuthStore((state) => state.logout);
  const overspendingAlertsEnabled = useSettingsStore((state) => state.overspendingAlertsEnabled);
  const toggleOverspendingAlerts = useSettingsStore((state) => state.toggleOverspendingAlerts);
  const styles = createStyles(theme);

  function handlePreferencePress(item) {
    if (item.action === 'logout') {
      logout();
    }
    // Other rows (Budget Settings, Notifications) are inert this phase —
    // those screens aren't built yet (see docs/architecture/frontend-navigation.md).
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader rightSlot={<ThemeToggleButton />} />

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

        <Card style={styles.upgradeBanner}>
          <Text style={styles.upgradeTitle}>Upgrade to Premium</Text>
          <Text style={styles.upgradeSubtitle}>
            Unlock AI insights, receipt scanning, and unlimited groups.
          </Text>
        </Card>

        <Text style={styles.sectionHeader}>Preferences</Text>
        <Card>
          {preferenceItems.map((item, index) => {
            const isToggle = item.type === 'toggle';
            return (
              <View key={item.id}>
                <ListItem
                  title={item.label}
                  subtitle={item.subtitle}
                  trailing={
                    isToggle ? (
                      <ToggleSwitch
                        value={overspendingAlertsEnabled}
                        onValueChange={toggleOverspendingAlerts}
                      />
                    ) : undefined
                  }
                  onPress={isToggle ? undefined : () => handlePreferencePress(item)}
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

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      paddingHorizontal: theme.space.xl,
      paddingBottom: theme.space.xxxl * 2,
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
  });
}

export default ProfileScreen;
