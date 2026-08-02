import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useGroups } from '../../hooks/useGroups';
import { useIndividualBalances } from '../../hooks/useIndividualBalances';
import { useSettleUp } from '../../hooks/useSettleUp';
import { useUserIdentity } from '../../hooks/useUserIdentity';
import { splitSummary } from '../../mocks/splitMocks';
import { getExactDateLabel, getTodayIsoDate } from '../../utils/dateDisplay';
import { getInitialsFromName } from '../../utils/initials';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import Avatar from '../../components/Avatar';
import IconBadge from '../../components/IconBadge';
import TextInput from '../../components/TextInput';
import FormMessage from '../../components/FormMessage';
import InlineMessage from '../../components/InlineMessage';
import PrimaryButton from '../../components/PrimaryButton';
import ConfettiBurst from '../../components/ConfettiBurst';
import SettleSuggestions from '../../components/SettleSuggestions';
import { useSettleSuggestions } from '../../hooks/useSettleSuggestions';

const SETTLEMENT_METHODS = [
  { value: 'marked_paid', label: 'Mark as Paid' },
  { value: 'upi', label: 'Settle via UPI / External App' },
];

/**
 * Settle Up — dedicated pushed screen, docs/decisions/
 * 0009-split-detail-and-settle-up.md's 2026-08-14 amendment,
 * docs/ui/design-system.md §13.6-13.8. Reached from SplitDetailScreen with
 * `{ mode: 'group', groupId }` or `{ mode: 'individual', individualBalanceId }`.
 *
 * **This screen now records a real settlement**: `POST /api/v1/splits/settle`
 * (docs/api/api-overview.md §10.1, as corrected by
 * docs/decisions/0023-shared-ledger-contract-corrections.md §4), through
 * `useSettleUp`. The former local `settleBalance` mutators are gone — a balance
 * is shared state and cannot be zeroed from one device (see the two balance
 * stores). It still never touches `useTransactionsStore`, in either direction:
 * ADR 0009 §6.1's reasoned "no" is unchanged, and the server does not create a
 * transaction for a settlement either.
 *
 * ---
 * **TWO CONTROLS ARE NEW, AND NEITHER IS DECORATION.**
 *
 * 1. **AMOUNT.** Partial settlement is legal (§10.1, ADR 0017 §4): the balance
 *    is reduced to its residual, never zeroed. A screen that could only send
 *    the whole balance would make a legal, specified behaviour unreachable, and
 *    would make a group settlement fail outright whenever the counterpart is
 *    owed less than the user owes. It defaults to the full outstanding amount,
 *    so the common case is still one tap.
 * 2. **WHO YOU ARE SETTLING WITH (group mode only).** A group settlement
 *    **must** carry exactly one of `counterpartUserId`/`counterpartContactId`.
 *    ADR 0023 §4 requires it, `V12` enforces it, and §10.1's request block does
 *    not list it (`backend/README.md` §16.6 flag-back 1) — without it every
 *    group settlement fails. A group settlement moves *both* members' rows, so
 *    there is genuinely no such thing as settling "with the group".
 *
 * The **direction is never chosen here**: the server derives who pays from the
 * two balances and rejects a request the ledger contradicts (ADR 0023 §4.2).
 * Nothing on this screen negates a balance either — `yourBalance`/`balance`
 * arrive oriented to the caller, and only `Math.abs` is applied, after testing
 * the sign.
 *
 * "Mark as Paid" and "Settle via UPI / External App" fire the identical request
 * with a different `method` value; neither performs any real payment.
 *
 * On success a one-shot ConfettiBurst plays and `goBack()` returns to Split
 * Detail, whose reactive reads already show the **re-read** balance — the
 * residual after a partial settlement, or zero after a full one.
 * `remainingBalance` from the response is deliberately not rendered: one shared
 * number must have one source (constitution §17).
 *
 * ---
 * **ACTIVITY LOG: THIS SCREEN NO LONGER WRITES ONE.**
 *
 * It used to mint a local `settlement` entry (ADR 0009 §6.3) because §11 was
 * unwired. The server now writes that row itself — the fan-out runs in the same
 * transaction as `POST /splits/settle` and writes one privately-owned row per
 * affected member, each with its own viewer-relative sentence
 * (api-overview.md §10.1/§11.1, `backend/README.md` §17.1). Keeping the
 * client-side write would double-count every settlement in the feed, and would
 * do it invisibly: the two entries render identically. It also produced only
 * *this* user's sentence, never the counterpart's — which the fan-out gets
 * right for free.
 *
 * The one thing lost with it is the `method` distinction ("… via UPI"): the
 * server composes its own sentence and §10.1 has no field that carries which
 * option the user tapped. Flagged rather than reinstated locally — a sentence
 * in the audit trail has exactly one author now.
 */
function SettleUpScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme, insets);

  const { mode, groupId, individualBalanceId } = route.params ?? {};
  const isGroup = mode === 'group';
  const { currencySymbol } = splitSummary;

  const {
    groups,
    hasLoaded: hasLoadedGroups,
    isLoading: isLoadingGroups,
    loadError: groupsError,
    reload: reloadGroups,
  } = useGroups();
  const {
    balances,
    hasLoaded: hasLoadedBalances,
    isLoading: isLoadingBalances,
    loadError: balancesError,
    reload: reloadBalances,
  } = useIndividualBalances();
  const { settle, isSettling, settleError, clearSettleError } = useSettleUp();
  const identity = useUserIdentity();

  const group = isGroup ? groups.find((item) => item.id === groupId) : null;
  const balance = !isGroup ? balances.find((item) => item.id === individualBalanceId) : null;
  const entity = isGroup ? group : balance;

  const [method, setMethod] = useState('marked_paid');
  const [amountText, setAmountText] = useState('');
  const [counterpartKey, setCounterpartKey] = useState(null);
  const [formError, setFormError] = useState(null);
  const [isCelebrating, setIsCelebrating] = useState(false);

  // Used exactly as the server states it; only the magnitude is taken.
  const signedBalance = isGroup ? group?.yourBalance ?? 0 : balance?.balance ?? 0;
  const outstanding = Math.abs(signedBalance);

  // Seeded once, the first time a real balance is known — not on every change,
  // so a figure the user has edited (or deliberately cleared) is never
  // overwritten, including after the post-rejection reload.
  const hasSeededAmount = useRef(false);
  useEffect(() => {
    if (!hasSeededAmount.current && outstanding > 0) {
      hasSeededAmount.current = true;
      setAmountText(String(outstanding));
    }
  }, [outstanding]);

  // Group mode: everyone in the group except the signed-in user. Exactly one
  // of the two ids is set per member (§7.1) and that is what the request
  // carries; the local key only has to be unique for the row list.
  const counterparts = useMemo(() => {
    if (!isGroup || !group) {
      return [];
    }
    return group.members
      .filter((member) => !(member.userId && member.userId === identity.userId))
      .map((member) => ({
        key: member.userId ?? member.invitedContactId,
        name: member.name,
        initials: getInitialsFromName(member.name),
        counterpartUserId: member.userId ?? null,
        counterpartContactId: member.userId ? null : member.invitedContactId,
      }));
  }, [isGroup, group, identity.userId]);

  const selectedCounterpart =
    counterparts.find((candidate) => candidate.key === counterpartKey) ?? null;

  // One-tap suggestions and the confirm/result copy (ADR 0028 §8.3/§9.2).
  const settleCopy = useSettleSuggestions({
    isGroup,
    groupId,
    signedBalance,
    me: identity.userId,
    symbol: currencySymbol,
  });
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);
  const otherMembers = counterparts.filter((candidate) => settleCopy.isOppositeSide(candidate.key));
  const copyCounterpart = isGroup
    ? selectedCounterpart && { userId: selectedCounterpart.counterpartUserId, name: selectedCounterpart.name }
    : balance && { userId: balance.counterpartUserId, name: balance.counterpartName };

  function handleSelectSuggestion(suggestion) {
    setSelectedSuggestion(suggestion);
    setCounterpartKey(suggestion.counterpartKey);
    setAmountText(String(suggestion.amount));
    setFormError(null);
    clearSettleError();
  }

  if (!entity) {
    // Three conditions, not one — the same distinction Split Detail makes:
    // still loading, the read failed, or the target genuinely is not there
    // (which for a membership-gated resource also covers "no longer a member",
    // a `404` and never a `403`).
    const hasLoaded = isGroup ? hasLoadedGroups : hasLoadedBalances;
    const isLoading = isGroup ? isLoadingGroups : isLoadingBalances;
    const loadError = isGroup ? groupsError : balancesError;

    return (
      <View style={styles.flex}>
        <ScreenHeader title="Settle Up" onBack={() => navigation.goBack()} />
        <View style={styles.notFoundContainer}>
          {!hasLoaded && isLoading ? (
            <Text style={styles.notFoundText}>Loading…</Text>
          ) : !hasLoaded && loadError ? (
            <InlineMessage
              message={loadError}
              onRetry={isGroup ? reloadGroups : reloadBalances}
            />
          ) : (
            <>
              <Text style={styles.notFoundText}>
                This {isGroup ? 'group' : 'split'} couldn&apos;t be found. It may have been
                removed.
              </Text>
              <PrimaryButton
                label="Go Back"
                onPress={() => navigation.goBack()}
                style={styles.notFoundButton}
              />
            </>
          )}
        </View>
      </View>
    );
  }

  const name = isGroup ? group.name : balance.counterpartName;

  // The same three-way balance sentence Split Detail's YOUR BALANCE block
  // computes (ADR 0009 §4) — duplicated rather than shared, per that ADR's own
  // "minor, non-architecturally-significant call" framing (constitution §25).
  const balanceCopy =
    signedBalance > 0
      ? {
          text: `You are owed ${currencySymbol}${signedBalance.toLocaleString('en-IN')}`,
          color: theme.color.status.positive,
        }
      : signedBalance < 0
        ? {
            text: `You owe ${currencySymbol}${outstanding.toLocaleString('en-IN')}`,
            color: theme.color.status.negative,
          }
        : {
            text: "You're all settled up",
            color: theme.color.text.secondary,
          };

  const selectedMethodLabel =
    SETTLEMENT_METHODS.find((option) => option.value === method)?.label ?? 'Mark as Paid';

  const parsedAmount = parseFloat(amountText);
  const isAmountParsed = amountText !== '' && !Number.isNaN(parsedAmount);

  async function handleConfirmSettlement() {
    setFormError(null);

    if (!isAmountParsed || parsedAmount <= 0) {
      setFormError('Enter an amount greater than 0.');
      return;
    }
    // The caller's own side of the bound. For a group the real limit is the
    // lesser of the two positions and this client cannot know the other one
    // (§7.1 exposes no per-member breakdown), so the server's
    // `400 AMOUNT_EXCEEDS_BALANCE` remains a reachable, mapped outcome — this
    // check only catches the half that is knowable here.
    if (parsedAmount > outstanding) {
      setFormError(
        `You can settle at most ${currencySymbol}${outstanding.toLocaleString('en-IN')} here.`,
      );
      return;
    }
    if (isGroup && !selectedCounterpart) {
      setFormError('Choose who you are settling with.');
      return;
    }

    const didSettle = await settle({
      mode,
      groupId,
      individualBalanceId,
      counterpartUserId: selectedCounterpart?.counterpartUserId ?? null,
      counterpartContactId: isGroup
        ? selectedCounterpart?.counterpartContactId ?? null
        : balance?.counterpartContactId ?? null,
      amount: parsedAmount,
      method,
      // The balance shown when the user confirmed — the queued-write path's
      // `expectedDirection` (ADR 0027 §7.3). Unused by the direct path.
      displayedBalance: signedBalance,
    });

    if (!didSettle) {
      return;
    }

    // No activity-log write here any more — see this screen's note. The
    // server's fan-out wrote the §11.1 rows in the same transaction as
    // `POST /splits/settle`, one per affected member.
    setIsCelebrating(true);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Settle Up" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          {isGroup ? (
            <IconBadge glyph={group.name.charAt(0)} tone="neutral" size="large" />
          ) : (
            <Avatar initials={getInitialsFromName(balance.counterpartName)} size="large" />
          )}
          <Text style={styles.heroName}>{name}</Text>
          <Text style={[styles.heroBalance, { color: balanceCopy.color }]}>
            {balanceCopy.text}
          </Text>
        </View>

        {isGroup ? (
          <>
            <SettleSuggestions
              suggestions={settleCopy.suggestions}
              selectedKey={selectedSuggestion?.key ?? null}
              onSelect={handleSelectSuggestion}
            />
            <Text style={styles.sectionLabel}>
              {settleCopy.suggestions.length > 0 ? 'OTHER MEMBER' : 'WHO ARE YOU SETTLING WITH?'}
            </Text>
            {otherMembers.length > 0 ? (
              otherMembers.map((candidate) => (
                <SelectableRow
                  key={candidate.key}
                  label={candidate.name}
                  leading={<Avatar initials={candidate.initials} size="small" />}
                  isSelected={counterpartKey === candidate.key}
                  onPress={() => {
                    setCounterpartKey(candidate.key);
                    setSelectedSuggestion(null);
                    setFormError(null);
                    // A rejection described the previous attempt; changing who
                    // is being paid makes it stale rather than current.
                    clearSettleError();
                  }}
                />
              ))
            ) : counterparts.length === 0 ? (
              <Text style={styles.helperText}>
                You are the only member of this group, so there is nobody to settle with yet.
              </Text>
            ) : null}
          </>
        ) : null}

        <TextInput
          label="AMOUNT"
          value={amountText}
          onChangeText={(value) => {
            setAmountText(value);
            setFormError(null);
            // Likewise: a changed amount is a different request, so the
            // previous refusal no longer describes what will happen.
            clearSettleError();
          }}
          placeholder="0.00"
          keyboardType="decimal-pad"
          helperText="Settling less than the full balance is fine — the rest stays outstanding."
          style={styles.amountField}
        />

        <Text style={styles.sectionLabel}>SETTLEMENT METHOD</Text>
        {SETTLEMENT_METHODS.map((option) => (
          <SelectableRow
            key={option.value}
            label={option.label}
            isSelected={method === option.value}
            onPress={() => setMethod(option.value)}
          />
        ))}

        <Card style={styles.detailsCard}>
          <Text style={styles.cardLabel}>SETTLEMENT DETAILS</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailRowLabel}>Amount</Text>
            <Text style={styles.detailRowValue}>
              {currencySymbol}
              {isAmountParsed ? parsedAmount.toLocaleString('en-IN') : '—'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailRowLabel}>Date</Text>
            <Text style={styles.detailRowValue}>{getExactDateLabel(getTodayIsoDate())}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailRowLabel}>Method</Text>
            <Text style={styles.detailRowValue}>{selectedMethodLabel}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailRowLabel}>{isGroup ? 'Group' : 'With'}</Text>
            <Text style={styles.detailRowValue}>{name}</Text>
          </View>
          {isGroup ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailRowLabel}>Paying</Text>
              <Text style={styles.detailRowValue}>{selectedCounterpart?.name ?? '—'}</Text>
            </View>
          ) : null}
          {/* `settlementTitle` (ADR 0028 §9.2): who pays whom, in one line. */}
          {isAmountParsed ? (
            <Text style={styles.confirmLine}>
              {settleCopy.buildConfirmLine(copyCounterpart, parsedAmount)}
            </Text>
          ) : null}
        </Card>
        {isCelebrating ? (
          <Text style={styles.confirmLine}>
            {settleCopy.buildResultLine(
              copyCounterpart,
              isGroup ? selectedSuggestion?.owedBefore ?? null : signedBalance,
              parsedAmount,
            )}
          </Text>
        ) : null}

        {/* Client-side validation and the server's own refusal share one slot:
            both belong to the whole form rather than to a single field, and
            only one can be true at a time. */}
        <FormMessage message={formError ?? settleError} style={styles.formMessage} />

        <PrimaryButton
          label="Confirm Settlement"
          icon={<Text style={styles.confirmIcon}>⇄</Text>}
          onPress={handleConfirmSettlement}
          disabled={isSettling || isCelebrating}
          style={styles.confirmButton}
        />
      </ScrollView>

      {isCelebrating ? <ConfettiBurst onComplete={() => navigation.goBack()} /> : null}
    </View>
  );
}

/**
 * One single-select row with a trailing checkmark — the interaction
 * docs/decisions/0005-split-add-expense-flow.md §4.1's preset rows established
 * (HowWasThisSplitScreen's PresetRow), now serving both the settlement method
 * and the counterpart picker on this screen. `leading` is optional, so a method
 * row renders exactly as it did before.
 */
function SelectableRow({ label, leading, isSelected, onPress }) {
  const theme = useTheme();
  const styles = createSelectableRowStyles(theme);

  return (
    <Card style={styles.card}>
      <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
        <View style={styles.labelGroup}>
          {leading ? <View style={styles.leading}>{leading}</View> : null}
          <Text style={styles.label}>{label}</Text>
        </View>
        <View style={styles.checkmarkSlot}>
          {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
      </Pressable>
    </Card>
  );
}

function createSelectableRowStyles(theme) {
  return StyleSheet.create({
    card: {
      marginBottom: theme.space.sm,
      padding: theme.space.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    labelGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
    },
    leading: {
      marginRight: theme.space.md,
    },
    label: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    checkmarkSlot: {
      width: 24,
      alignItems: 'flex-end',
    },
    checkmark: {
      color: theme.color.accent.primary,
      fontSize: 20,
      fontWeight: '700',
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
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      // No FAB on this screen — only the floating tab bar needs clearing,
      // same helper SplitDetailScreen.jsx/TransactionDetailScreen.jsx use.
      paddingBottom: getTabBarTopEdge(theme, insets) + theme.space.lg,
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
      marginBottom: theme.space.lg,
    },
    notFoundButton: {
      minWidth: 160,
    },
    hero: {
      alignItems: 'center',
      marginBottom: theme.space.xl,
    },
    heroName: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      textAlign: 'center',
      marginTop: theme.space.md,
      marginBottom: theme.space.xs,
    },
    heroBalance: {
      fontSize: theme.type.h1.fontSize,
      lineHeight: theme.type.h1.lineHeight,
      fontWeight: theme.type.h1.fontWeight,
      textAlign: 'center',
    },
    sectionLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.sm,
    },
    amountField: {
      marginTop: theme.space.lg,
    },
    helperText: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.caption.lineHeight,
      marginBottom: theme.space.lg,
    },
    detailsCard: {
      marginTop: theme.space.md,
      marginBottom: theme.space.lg,
    },
    cardLabel: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.sm,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: theme.space.xs,
    },
    detailRowLabel: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    detailRowValue: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    // ADR 0028 §9.2: the confirm line and the after-settlement line.
    confirmLine: {
      marginTop: theme.space.sm,
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    formMessage: {
      marginBottom: theme.space.md,
    },
    confirmIcon: {
      color: theme.color.accent.onPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    confirmButton: {
      marginBottom: theme.space.lg,
    },
  });
}

export default SettleUpScreen;
