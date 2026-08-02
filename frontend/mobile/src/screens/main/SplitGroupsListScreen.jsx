import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import ScreenHeader from '../../components/ScreenHeader';
import ThemeToggleButton from '../../components/ThemeToggleButton';
import Avatar from '../../components/Avatar';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';
import PrimaryButton from '../../components/PrimaryButton';
import { splitSummary, activeGroups } from '../../mocks/splitMocks';
import { profileUser } from '../../mocks/profileMocks';

/**
 * Split groups list — total owe/owed summary + active groups list. Mock
 * data only (src/mocks/splitMocks.js) — there is no groups/split API yet.
 */
function SplitGroupsListScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const styles = createStyles(theme);
  const { currencySymbol } = splitSummary;

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Split"
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
        data={activeGroups}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
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

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>Active Groups</Text>
              <PrimaryButton
                label="New Group"
                glow={false}
                onPress={() => navigation.navigate('NewGroup')}
                style={styles.newGroupButton}
              />
            </View>
          </>
        }
        renderItem={({ item }) => {
          const isPositive = item.yourBalance > 0;
          const isSettled = item.yourBalance === 0;
          const trailingText = isSettled
            ? 'Settled up'
            : `${isPositive ? '+' : '-'}${currencySymbol}${Math.abs(item.yourBalance).toLocaleString('en-IN')}`;

          return (
            <Card style={styles.groupCard}>
              <ListItem
                leading={<IconBadge glyph={item.name.charAt(0)} tone="neutral" size="large" />}
                title={item.name}
                subtitle={`${item.memberCount} members • ${item.lastActivity}`}
                trailingText={trailingText}
                trailingSubtext={isSettled ? undefined : isPositive ? 'you lent' : 'you owe'}
                trailingTone={isSettled ? 'neutral' : isPositive ? 'positive' : 'negative'}
              />
            </Card>
          );
        }}
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
      paddingBottom: theme.space.xxxl * 2,
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
  });
}

export default SplitGroupsListScreen;
