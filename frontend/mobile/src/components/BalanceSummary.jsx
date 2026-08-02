import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * The "who owes whom" block — docs/decisions/
 * 0028-split-expense-edit-delete-feeds-and-balance-copy.md §9.2: one summary
 * sentence, up to two of the viewer's debts, and `+{n} more`. Used by the
 * Split tab's cards and Split Detail's header. Copy comes from
 * `utils/balanceCopy.js#buildBalanceSummary`; this only renders it.
 *
 * @param {{ summary: { sentence: string, tone: string, debtLines: string[],
 *   moreCount: number }, prefix?: string, caption?: string | null,
 *   onPressMore?: () => void, size?: 'large' | 'small', style?: object }} props
 */
function BalanceSummary({ summary, prefix = '', caption = null, onPressMore, size = 'large', style }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const toneStyle =
    summary.tone === 'positive' ? styles.positive : summary.tone === 'negative' ? styles.negative : styles.muted;

  return (
    <View style={style}>
      <Text style={[size === 'large' ? styles.sentenceLarge : styles.sentenceSmall, toneStyle]}>
        {prefix}
        {summary.sentence}
      </Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      {summary.debtLines.map((line) => (
        <Text key={line} style={styles.debtLine}>
          {line}
        </Text>
      ))}
      {summary.moreCount > 0 ? (
        <Pressable onPress={onPressMore} disabled={!onPressMore} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.more}>+{summary.moreCount} more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    sentenceLarge: {
      fontSize: theme.type.h1.fontSize,
      lineHeight: theme.type.h1.lineHeight,
      fontWeight: theme.type.h1.fontWeight,
    },
    sentenceSmall: {
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      fontWeight: '600',
    },
    positive: {
      color: theme.color.status.positive,
    },
    negative: {
      color: theme.color.status.negative,
    },
    muted: {
      color: theme.color.text.secondary,
    },
    caption: {
      marginTop: theme.space.xs,
      color: theme.color.text.secondary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.caption.lineHeight,
    },
    debtLine: {
      marginTop: theme.space.xs,
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    more: {
      marginTop: theme.space.xs,
      color: theme.color.accent.primary,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
  });
}

export default BalanceSummary;
