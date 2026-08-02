import { useMemo } from 'react';
import { debtSentence, remainingAfterSettlementSentence, settlementTitle } from '../utils/balanceCopy';
import { useGroupBalancesView } from './useGroupBalancesView';

/**
 * Settle Up's one-tap suggestions and copy —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md
 * §8.3/§9.2.
 *
 * - **Group:** the viewer's own simplified debts, each prefilled with the
 *   counterpart, the amount `t` and the direction (a **Pay** row when the
 *   viewer is `from`, **Record** when they are `to`). The "other member"
 *   picker keeps only members whose balance sign is opposite to the viewer's
 *   (all members when the server sends no per-member balance).
 * - `confirmLine` (`settlementTitle`) and, after a settlement, `resultLine`
 *   (`You still owe …` / `… still owes you …` / settled).
 *
 * The server's settlement rules are unchanged; a suggestion only fills the
 * form.
 *
 * @param {{ isGroup: boolean, groupId: string | null, signedBalance: number,
 *   me: string, symbol: string }} args
 * @returns {{ suggestions: object[], isOppositeSide: (memberKey: string) => boolean,
 *   buildConfirmLine: (counterpart: object | null, amount: number) => string | null,
 *   buildResultLine: (counterpart: object | null, owedBefore: number | null, amount: number) => string | null }}
 */
export function useSettleSuggestions({ isGroup, groupId, signedBalance, me, symbol }) {
  const groupBalances = useGroupBalancesView(isGroup ? groupId : null);

  return useMemo(() => {
    const suggestions = isGroup
      ? groupBalances.viewerDebts.map((debt) => {
          const viewerPays = debt.from?.isMe;
          const other = viewerPays ? debt.to : debt.from;
          return {
            key: `${debt.fromKey}>${debt.toKey}`,
            label: debtSentence(debt.from, debt.to, debt.amount, me, symbol),
            actionLabel: viewerPays ? 'Pay' : 'Record',
            counterpartKey: other?.userId ?? other?.invitedContactId ?? null,
            amount: debt.amount,
            // Signed from the viewer's side: positive = they owe the viewer.
            owedBefore: viewerPays ? -debt.amount : debt.amount,
          };
        })
      : [];

    const signByKey = new Map(
      groupBalances.members.map((member) => [member.userId ?? member.invitedContactId, member.balance]),
    );
    const isOppositeSide = (memberKey) => {
      const memberBalance = signByKey.get(memberKey);
      if (!groupBalances.hasBalances || !Number.isFinite(memberBalance) || signedBalance === 0) {
        return true;
      }
      return Math.sign(memberBalance) === -Math.sign(signedBalance);
    };

    const viewer = { userId: me, name: 'You' };
    const buildConfirmLine = (counterpart, amount) => {
      if (!counterpart || !(amount > 0)) {
        return null;
      }
      const viewerPays = signedBalance < 0;
      return settlementTitle(
        viewerPays ? viewer : counterpart,
        viewerPays ? counterpart : viewer,
        amount,
        me,
        symbol,
      );
    };
    const buildResultLine = (counterpart, owedBefore, amount) => {
      if (!counterpart || !Number.isFinite(owedBefore)) {
        return null;
      }
      const remaining =
        owedBefore > 0 ? Math.max(0, owedBefore - amount) : Math.min(0, owedBefore + amount);
      return remainingAfterSettlementSentence(counterpart.name, Math.round(remaining * 100) / 100, symbol);
    };

    return { suggestions, isOppositeSide, buildConfirmLine, buildResultLine };
  }, [isGroup, groupBalances, signedBalance, me, symbol]);
}
