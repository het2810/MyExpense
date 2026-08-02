import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useTransactionsStore } from '../../store/useTransactionsStore';
import { computeSpentForPeriod } from '../../utils/budgetPeriod';
import { getExactDateLabel } from '../../utils/dateDisplay';
import { dashboardSummary } from '../../mocks/dashboardMocks';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import PrimaryButton from '../../components/PrimaryButton';

/**
 * Budget Summary — a one-time retrospective for a just-ended budget period,
 * shown once, per docs/decisions/0010-budget-settings.md's second same-day
 * amendment (Part B/C) and docs/ui/design-system.md §14.6. Single-use and
 * transient — reads only the one just-ended `activePeriod` record passed to
 * it; no history list, no browsable past-summaries screen.
 *
 * Two entry points, one shared component, `isMandatory` distinguishes them
 * exactly as it does for BudgetSettingsScreen (docs/decisions/
 * 0011-post-auth-budget-gate.md's second same-day amendment, Part B/D):
 * - Root-level mandatory gate (`isMandatory` true, `period` prop, direct
 *   store read, `onSetNewBudget` callback) — shown right after Sign In when
 *   the stored period had already ended. No onBack. "Set New Budget" flips
 *   RootNavigator's local state to reveal BudgetGate, never a direct
 *   navigation call.
 * - Normal `ProfileStack` push (`isMandatory` omitted/false, `period` route
 *   param) — reached from Profile's "Budget Settings" row when the current
 *   period has already ended. `onBack` renders normally. "Set New Budget"
 *   pushes `BudgetSettings` directly.
 *
 * No new derivation logic beyond reusing ADR 0010 §8.2's `spent` formula
 * (computeSpentForPeriod, shared with DashboardScreen) and a straightforward
 * subtraction — deliberately the smallest screen that honestly answers "how
 * did my last budget period go."
 */
function BudgetSummaryScreen({ isMandatory = false, period: periodProp, onSetNewBudget } = {}) {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme);

  const period = periodProp ?? route.params?.period;
  const transactions = useTransactionsStore((state) => state.transactions);
  const { currencySymbol } = dashboardSummary;

  // Defensive case (constitution §22) — this screen should only ever be
  // reached with a real, ended period, but a stale/missing param must not
  // crash on undefined fields.
  if (!period) {
    return (
      <View style={styles.flex}>
        <ScreenHeader
          title="Budget Summary"
          onBack={isMandatory ? undefined : () => navigation.goBack()}
        />
        <View style={styles.notFoundContainer}>
          <Text style={styles.notFoundText}>
            No budget period to summarize right now.
          </Text>
        </View>
      </View>
    );
  }

  const spent = computeSpentForPeriod(transactions, period);
  const isOverBudget = spent > period.amount;
  const savings = Math.max(period.amount - spent, 0);

  function handleSetNewBudget() {
    if (isMandatory) {
      onSetNewBudget?.();
    } else {
      navigation.navigate('BudgetSettings');
    }
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Budget Summary"
        onBack={isMandatory ? undefined : () => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.card}>
          <Text style={styles.cardLabel}>PERIOD</Text>
          <Text style={styles.cardValue}>
            {getExactDateLabel(period.startDate)} – {getExactDateLabel(period.endDate)}
          </Text>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardLabel}>MONTHLY BUDGET</Text>
          <Text style={styles.cardValue}>
            {currencySymbol}
            {period.amount.toLocaleString('en-IN')}
          </Text>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardLabel}>TOTAL SPENT</Text>
          <Text style={styles.cardValue}>
            {currencySymbol}
            {spent.toLocaleString('en-IN')}
          </Text>
        </Card>

        {isOverBudget ? (
          <Card style={styles.card}>
            <Text style={styles.cardLabel}>OVER BUDGET</Text>
            <Text style={[styles.cardValue, styles.negativeValue]}>
              You went {currencySymbol}
              {(spent - period.amount).toLocaleString('en-IN')} over budget this period.
            </Text>
          </Card>
        ) : (
          <Card style={styles.card}>
            <Text style={styles.cardLabel}>SAVINGS FOR THIS PERIOD</Text>
            <Text style={[styles.cardValue, styles.positiveValue]}>
              {currencySymbol}
              {savings.toLocaleString('en-IN')}
            </Text>
          </Card>
        )}

        <PrimaryButton
          label="Set New Budget"
          onPress={handleSetNewBudget}
          style={styles.actionButton}
        />
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
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      paddingBottom: getTabBarTopEdge(theme) + theme.space.lg,
    },
    notFoundContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.space.xl,
    },
    notFoundText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
    },
    card: {
      marginBottom: theme.space.md,
    },
    cardLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.sm,
    },
    cardValue: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      lineHeight: theme.type.bodyLg.lineHeight,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    positiveValue: {
      color: theme.color.status.positive,
    },
    negativeValue: {
      color: theme.color.status.negative,
    },
    actionButton: {
      marginTop: theme.space.md,
      marginBottom: theme.space.lg,
    },
  });
}

export default BudgetSummaryScreen;
