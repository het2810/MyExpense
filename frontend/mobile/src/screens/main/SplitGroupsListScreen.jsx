import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { getFabTopEdge } from '../../theme/layout';
import { useGroupsStore } from '../../store/useGroupsStore';
import { useIndividualSplitsStore } from '../../store/useIndividualSplitsStore';
import ScreenHeader from '../../components/ScreenHeader';
import ThemeToggleButton from '../../components/ThemeToggleButton';
import NotificationBell from '../../components/NotificationBell';
import Avatar from '../../components/Avatar';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';
import PrimaryButton from '../../components/PrimaryButton';
import SegmentedControl from '../../components/SegmentedControl';
import FloatingActionButton from '../../components/FloatingActionButton';
import { splitSummary } from '../../mocks/splitMocks';
import { profileUser } from '../../mocks/profileMocks';
import { getBalanceTrailing } from '../../utils/splitCalculations';

// New local const, independent of Dashboard's VIEW_OPTIONS and Add
// Expense's TYPE_OPTIONS — see docs/decisions/0004-split-individual-tab.md
// §1/§4. "Individual" is scoped to this one tab switcher only.
const SPLIT_TABS = [
  { label: 'Individual', value: 'individual' },
  { label: 'Group', value: 'group' },
];

// Duration (ms) of the cross-fade applied to the list content (section
// header + rows) whenever the Individual/Group tab changes — reuses
// Dashboard's exact CONTENT_FADE_DURATION value (DashboardScreen.jsx) per
// ADR 0004 §5; not re-derived or re-tuned for this screen.
const CONTENT_FADE_DURATION = 220;

/**
 * Split screen — total owe/owed summary, an Individual/Group tab switcher,
 * and the active tab's list. Mock data only (src/mocks/splitMocks.js,
 * src/store/useGroupsStore.js, src/store/useIndividualSplitsStore.js) —
 * there is no split/groups API yet. See
 * docs/decisions/0004-split-individual-tab.md for the tab switcher's own
 * spec.
 *
 * FAB (docs/decisions/0005-split-add-expense-flow.md §1): opens the new
 * Split Add Expense flow, hinting the currently-active tab as
 * `initialSplitMode` so the destination screen's own Individual/Group
 * toggle defaults to whichever tab the user was already looking at.
 */
function SplitGroupsListScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const groups = useGroupsStore((state) => state.groups);
  const individualSplits = useIndividualSplitsStore((state) => state.individualSplits);
  const [activeTab, setActiveTab] = useState('individual');
  const styles = createStyles(theme);
  const { currencySymbol } = splitSummary;

  // Cross-fade on the list content (section header + rows) when the
  // Individual/Group tab changes — identical mechanism to Dashboard's
  // Personal/Group toggle fade (see DashboardScreen.jsx).
  const contentOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    contentOpacity.setValue(0);
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: CONTENT_FADE_DURATION,
      useNativeDriver: true,
    }).start();
  }, [activeTab, contentOpacity]);

  const listData = activeTab === 'individual' ? individualSplits : groups;

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Split"
        align="left"
        rightSlot={
          <>
            <NotificationBell />
            <ThemeToggleButton />
            <Avatar
              initials={profileUser.initials}
              size="small"
              onPress={() => navigation.navigate('ProfileTab')}
            />
          </>
        }
      />

      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          // Zero entries in the active Individual/Group tab —
          // docs/ui/design-system.md §18.2. Per-tab copy.
          <View style={styles.emptyState}>
            <IconBadge glyph="⇄" tone="neutral" size="large" />
            <Text style={styles.emptyStateText}>
              {activeTab === 'group'
                ? 'No groups yet — tap New Group or + to get started.'
                : 'No individual splits yet — tap + to split an expense with someone.'}
            </Text>
          </View>
        }
        ListHeaderComponent={
          <>
            <View style={styles.summaryRow}>
              <Card style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>YOU OWE</Text>
                <Text style={styles.summaryAmountNegative}>
                  {currencySymbol}
                  {splitSummary.totalYouOwe.toLocaleString('en-IN')}
                </Text>
              </Card>
              <Card style={[styles.summaryCard, styles.summaryCardLast]}>
                <Text style={styles.summaryLabel}>YOU ARE OWED</Text>
                <Text style={styles.summaryAmountPositive}>
                  {currencySymbol}
                  {splitSummary.totalYouAreOwed.toLocaleString('en-IN')}
                </Text>
              </Card>
            </View>

            <SegmentedControl
              options={SPLIT_TABS}
              value={activeTab}
              onChange={setActiveTab}
              style={styles.segmentedControl}
            />

            <Animated.View style={{ opacity: contentOpacity }}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>
                  {activeTab === 'group' ? 'Active Groups' : 'Individual Splits'}
                </Text>
                {activeTab === 'group' ? (
                  <PrimaryButton
                    label="New Group"
                    glow={false}
                    onPress={() => navigation.navigate('NewGroup')}
                    style={styles.newGroupButton}
                  />
                ) : null}
              </View>
            </Animated.View>
          </>
        }
        renderItem={({ item }) => {
          const { trailingText, trailingSubtext, trailingTone } = getBalanceTrailing(
            item.yourBalance,
            currencySymbol,
          );

          if (activeTab === 'individual') {
            return (
              <Animated.View style={{ opacity: contentOpacity }}>
                <Card style={styles.groupCard}>
                  <ListItem
                    leading={
                      <IconBadge glyph={item.personName.charAt(0)} tone="neutral" size="large" />
                    }
                    title={item.personName}
                    subtitle={item.lastActivity}
                    trailingText={trailingText}
                    trailingSubtext={trailingSubtext}
                    trailingTone={trailingTone}
                    onPress={() =>
                      navigation.navigate('SplitDetail', { mode: 'individual', individualId: item.id })
                    }
                  />
                </Card>
              </Animated.View>
            );
          }

          // memberCount is now a derived value (memberContactIds.length + 1
          // — see useGroupsStore.js), not a stored field — docs/decisions/
          // 0005-split-add-expense-flow.md §2.1.
          const memberCount = item.memberContactIds.length + 1;

          return (
            <Animated.View style={{ opacity: contentOpacity }}>
              <Card style={styles.groupCard}>
                <ListItem
                  leading={<IconBadge glyph={item.name.charAt(0)} tone="neutral" size="large" />}
                  title={item.name}
                  subtitle={`${memberCount} members • ${item.lastActivity}`}
                  trailingText={trailingText}
                  trailingSubtext={trailingSubtext}
                  trailingTone={trailingTone}
                  onPress={() => navigation.navigate('SplitDetail', { mode: 'group', groupId: item.id })}
                />
              </Card>
            </Animated.View>
          );
        }}
      />

      <FloatingActionButton
        onPress={() => navigation.navigate('SplitAddExpense', { initialSplitMode: activeTab })}
      />
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    listContent: {
      paddingHorizontal: theme.space.xl,
      // This screen now renders behind the FAB as well as the floating tab
      // bar (docs/decisions/0005-split-add-expense-flow.md §1) — the FAB
      // sits higher off the screen bottom, so its top edge is the one that
      // must be cleared. Identical to DashboardScreen.jsx's own
      // listContent.paddingBottom computation.
      paddingBottom: getFabTopEdge(theme) + theme.space.lg,
    },
    summaryRow: {
      flexDirection: 'row',
      gap: theme.space.md,
      marginBottom: theme.space.xxl,
    },
    summaryCard: {
      flex: 1,
      marginRight: theme.space.md,
    },
    summaryCardLast: {
      marginRight: 0,
    },
    summaryLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    summaryAmountNegative: {
      color: theme.color.status.negative,
      fontSize: theme.type.h1.fontSize,
      fontWeight: theme.type.h1.fontWeight,
    },
    summaryAmountPositive: {
      color: theme.color.status.positive,
      fontSize: theme.type.h1.fontSize,
      fontWeight: theme.type.h1.fontWeight,
    },
    segmentedControl: {
      marginBottom: theme.space.xxl,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.space.md,
    },
    sectionHeader: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
    },
    newGroupButton: {
      paddingVertical: theme.space.sm,
      paddingHorizontal: theme.space.lg,
    },
    groupCard: {
      marginBottom: theme.space.md,
    },
    emptyState: {
      alignItems: 'center',
      paddingVertical: theme.space.xxxl,
    },
    emptyStateText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      marginTop: theme.space.md,
    },
  });
}

export default SplitGroupsListScreen;
