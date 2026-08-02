import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * One day's header in the Dashboard's date-wise transaction list: the day of
 * month, a weekday chip (accent for today, negative tone on weekends), the
 * month.year, and that day's income and expense totals on the right. A total
 * of zero is hidden rather than shown as "₹0" noise.
 *
 * @param {{ section: ReturnType<typeof import('../utils/transactionDayGroups').groupTransactionsByDay>[number],
 *   currencySymbol: string }} props
 */
function TransactionDayHeader({ section, currencySymbol }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  const chipStyle = section.isToday
    ? styles.chipToday
    : section.isWeekend
      ? styles.chipWeekend
      : styles.chipWeekday;
  const chipTextStyle = section.isToday
    ? styles.chipTextToday
    : section.isWeekend
      ? styles.chipTextWeekend
      : styles.chipText;

  return (
    <View style={styles.container}>
      <Text style={styles.dayOfMonth}>{section.dayOfMonth}</Text>
      <View style={[styles.chip, chipStyle]}>
        <Text style={chipTextStyle}>{section.isToday ? 'Today' : section.weekday}</Text>
      </View>
      <Text style={styles.monthYear}>{section.monthYear}</Text>
      <View style={styles.totals}>
        {section.incomeTotal > 0 ? (
          <Text style={styles.income}>
            +{currencySymbol}
            {section.incomeTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </Text>
        ) : null}
        {section.expenseTotal > 0 ? (
          <Text style={styles.expense}>
            -{currencySymbol}
            {section.expenseTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: theme.space.lg,
      paddingVertical: theme.space.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
    },
    dayOfMonth: {
      color: theme.color.text.primary,
      fontSize: theme.type.h1.fontSize,
      lineHeight: theme.type.h1.lineHeight,
      fontWeight: theme.type.h1.fontWeight,
      marginRight: theme.space.sm,
    },
    chip: {
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.space.sm,
      paddingVertical: 2,
      marginRight: theme.space.sm,
    },
    chipWeekday: {
      backgroundColor: theme.color.background.surfaceAlt,
    },
    chipWeekend: {
      backgroundColor: theme.color.status.negative,
    },
    chipToday: {
      backgroundColor: theme.color.accent.primary,
    },
    chipText: {
      color: theme.color.text.primary,
      fontSize: theme.type.caption.fontSize,
      fontWeight: '600',
    },
    chipTextWeekend: {
      color: theme.color.status.onNegative,
      fontSize: theme.type.caption.fontSize,
      fontWeight: '600',
    },
    chipTextToday: {
      color: theme.color.accent.onPrimary,
      fontSize: theme.type.caption.fontSize,
      fontWeight: '600',
    },
    monthYear: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
    },
    totals: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: theme.space.md,
    },
    income: {
      color: theme.color.status.positive,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
    expense: {
      color: theme.color.status.negative,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
  });
}

export default TransactionDayHeader;
