import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { useSettingsStore } from '../../store/useSettingsStore';
import ScreenHeader from '../../components/ScreenHeader';
import ThemeToggleButton from '../../components/ThemeToggleButton';
import Avatar from '../../components/Avatar';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';
import SegmentedControl from '../../components/SegmentedControl';
import ProgressBar from '../../components/ProgressBar';
import FloatingActionButton from '../../components/FloatingActionButton';
import { dashboardSummary, recentTransactions } from '../../mocks/dashboardMocks';
import { profileUser } from '../../mocks/profileMocks';

const VIEW_OPTIONS = [
  { label: 'Personal', value: 'personal' },
  { label: 'Group', value: 'group' },
];

// Spending ratio at which the overspending warning first appears.
const WARNING_THRESHOLD = 0.8;

// Duration (ms) of the cross-fade applied to the transaction list content
// whenever the Personal/Group toggle changes.
const CONTENT_FADE_DURATION = 220;

/**
 * MyExpense home/dashboard — monthly budget, remaining, daily average,
 * savings, personal/group toggle, recent transactions. Mock data only
 * (src/mocks/dashboardMocks.js) — there is no expense/budget API yet.
 */
function DashboardScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const [viewMode, setViewMode] = useState('personal');
  const overspendingAlertsEnabled = useSettingsStore((state) => state.overspendingAlertsEnabled);
  const styles = createStyles(theme);

  const progress = useMemo(
    () => dashboardSummary.spent / dashboardSummary.monthlyBudget,
    [],
  );

  const { currencySymbol } = dashboardSummary;
  const isOverBudget = progress >= 1;

  // Filters the transaction list by the active Personal/Group segment. The
  // budget/remaining/daily-avg/savings summary card is intentionally NOT
  // scoped by viewMode — only the transaction list below it changes.
  const filteredTransactions = useMemo(
    () => recentTransactions.filter((transaction) => transaction.scope === viewMode),
    [viewMode],
  );

  // Meaningful, percentage-aware copy — see constitution Section 22
  // (frontend error/warning messages must be clear, never generic).
  const overspendingWarning = useMemo(() => {
    if (isOverBudget) {
      const overspendAmount = dashboardSummary.spent - dashboardSummary.monthlyBudget;
      return `You've exceeded your monthly budget by ${currencySymbol}${overspendAmount.toLocaleString('en-IN')}.`;
    }
    if (progress >= WARNING_THRESHOLD) {
      const spentPercent = Math.round(progress * 100);
      return `You've used ${spentPercent}% of your monthly budget — pace yourself for the rest of the month.`;
    }
    return null;
  }, [progress, isOverBudget, currencySymbol]);

  // Cross-fade on the transaction list content (section header + rows) when
  // the Personal/Group toggle changes, layered on top of the real data
  // filter above so the list swap doesn't feel like an abrupt content jump.
  const contentOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    contentOpacity.setValue(0);
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: CONTENT_FADE_DURATION,
      useNativeDriver: true,
    }).start();
  }, [viewMode, contentOpacity]);

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="MyExpense"
        align="left"
        rightSlot={
          <>
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
        data={filteredTransactions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <Card style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>MONTHLY BUDGET</Text>
              <Text style={styles.summaryAmount}>
                {currencySymbol}
                {dashboardSummary.monthlyBudget.toLocaleString('en-IN')}
              </Text>
              <Text style={styles.spentLine}>
                {currencySymbol}
                {dashboardSummary.spent.toLocaleString('en-IN')} spent of {currencySymbol}
                {dashboardSummary.monthlyBudget.toLocaleString('en-IN')}
              </Text>
              <ProgressBar progress={progress} style={styles.progressBar} />
              <View style={styles.statRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>REMAINING</Text>
                  <Text style={styles.statValuePositive}>
                    {currencySymbol}
                    {dashboardSummary.remaining.toLocaleString('en-IN')}
                  </Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>DAILY AVG</Text>
                  <Text style={styles.statValue}>
                    {currencySymbol}
                    {dashboardSummary.dailyAverage.toLocaleString('en-IN', {
                      maximumFractionDigits: 0,
                    })}
                  </Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>SAVINGS</Text>
                  <Text style={styles.statValuePositive}>
                    {currencySymbol}
                    {dashboardSummary.savings.toLocaleString('en-IN')}
                  </Text>
                </View>
              </View>

              {overspendingAlertsEnabled && overspendingWarning ? (
                <View
                  style={[
                    styles.warningBanner,
                    isOverBudget ? styles.warningBannerNegative : styles.warningBannerWarning,
                  ]}
                >
                  <Text
                    style={[
                      styles.warningText,
                      isOverBudget ? styles.warningTextNegative : styles.warningTextWarning,
                    ]}
                  >
                    {overspendingWarning}
                  </Text>
                </View>
              ) : null}
            </Card>

            <SegmentedControl
              options={VIEW_OPTIONS}
              value={viewMode}
              onChange={setViewMode}
              style={styles.segmentedControl}
            />

            <Animated.View style={{ opacity: contentOpacity }}>
              <Text style={styles.sectionHeader}>Recent Transactions</Text>
            </Animated.View>
          </>
        }
        renderItem={({ item }) => (
          <Animated.View style={{ opacity: contentOpacity }}>
            <ListItem
              leading={<IconBadge glyph={item.glyph} tone={item.tone} />}
              title={item.title}
              subtitle={`${item.category} • ${item.date}`}
              trailingText={`${item.type === 'income' ? '+' : '-'}${currencySymbol}${item.amount.toLocaleString('en-IN')}`}
              trailingTone={item.type === 'income' ? 'positive' : 'negative'}
            />
          </Animated.View>
        )}
      />

      <FloatingActionButton onPress={() => navigation.navigate('AddExpense')} />
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
      paddingBottom: theme.space.xxxl * 2,
    },
    summaryCard: {
      marginBottom: theme.space.xl,
    },
    summaryLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    summaryAmount: {
      color: theme.color.text.primary,
      fontSize: theme.type.display.fontSize,
      lineHeight: theme.type.display.lineHeight,
      fontWeight: theme.type.display.fontWeight,
    },
    spentLine: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.md,
    },
    progressBar: {
      marginBottom: theme.space.lg,
    },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    statItem: {
      flex: 1,
    },
    statLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    statValue: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    statValuePositive: {
      color: theme.color.status.positive,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    warningBanner: {
      marginTop: theme.space.lg,
      paddingVertical: theme.space.sm,
      paddingHorizontal: theme.space.md,
      borderRadius: theme.radius.sm,
      borderLeftWidth: 3,
      backgroundColor: theme.color.background.surfaceAlt,
    },
    warningBannerWarning: {
      borderLeftColor: theme.color.status.warning,
    },
    warningBannerNegative: {
      borderLeftColor: theme.color.status.negative,
    },
    warningText: {
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    warningTextWarning: {
      color: theme.color.status.warning,
    },
    warningTextNegative: {
      color: theme.color.status.negative,
    },
    segmentedControl: {
      marginBottom: theme.space.xxl,
    },
    sectionHeader: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      marginBottom: theme.space.md,
    },
  });
}

export default DashboardScreen;
