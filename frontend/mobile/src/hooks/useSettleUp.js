import { useCallback, useState } from 'react';
import { useGroupsStore } from '../store/useGroupsStore';
import { useIndividualSplitsStore } from '../store/useIndividualSplitsStore';

/**
 * Settle Up's one write — `POST /api/v1/splits/settle` (docs/api/api-overview.md
 * §10.1, as corrected by docs/decisions/0023-shared-ledger-contract-corrections.md
 * §4) — routed to whichever store owns the target.
 *
 * The two halves of this endpoint are genuinely different requests, so each
 * lives with the data it moves: `useGroupsStore.settleGroupBalance` (which must
 * name a counterpart, and re-reads one group) and
 * `useIndividualSplitsStore.settleIndividualBalance` (which must not, and
 * re-reads the pairwise list). This hook is the seam that lets one screen drive
 * either without knowing which store it is talking to, and it holds the one
 * piece of state that belongs to the screen rather than to the data: the
 * message from a failed attempt.
 *
 * **The error is held here, not in a store**, for the reason every other write
 * in this app returns its outcome instead of storing it: a failed settlement
 * belongs to the screen the user is looking at, and a message left in global
 * state would reappear the next time any settle screen opened.
 *
 * **Nothing here renders `remainingBalance`.** §10.1 returns it, and the
 * authoritative figure after a settlement is the re-read balance — one shared
 * number must have one source (constitution §17). The screen simply navigates
 * back, where the refreshed balance is already on the previous screen.
 *
 * @returns {{
 *   settle: (values: {
 *     mode: 'group' | 'individual',
 *     groupId?: string | null,
 *     individualBalanceId?: string | null,
 *     counterpartUserId?: string | null,
 *     counterpartContactId?: string | null,
 *     amount: number,
 *     method: 'marked_paid' | 'upi',
 *   }) => Promise<boolean>,
 *   isSettling: boolean,
 *   settleError: string | null,
 *   clearSettleError: () => void,
 * }}
 */
export function useSettleUp() {
  const settleGroupBalance = useGroupsStore((state) => state.settleGroupBalance);
  const isSettlingGroup = useGroupsStore((state) => state.isSettling);
  const settleIndividualBalance = useIndividualSplitsStore(
    (state) => state.settleIndividualBalance,
  );
  const isSettlingIndividual = useIndividualSplitsStore((state) => state.isSettling);

  const [settleError, setSettleError] = useState(null);

  const settle = useCallback(
    async ({
      mode,
      groupId = null,
      individualBalanceId = null,
      counterpartUserId = null,
      counterpartContactId = null,
      amount,
      method,
      // The balance the user saw when confirming (ADR 0027 §7.3) — becomes
      // `expectedDirection` on the queued-write path. Optional.
      displayedBalance = null,
    }) => {
      setSettleError(null);

      const result =
        mode === 'group'
          ? await settleGroupBalance({
              groupId,
              // Exactly one of these two is required for a group settlement and
              // the request builder enforces it. Without it the settlement
              // records that someone paid but not who was paid, and the group
              // stops summing to zero (ADR 0023 §4).
              counterpartUserId,
              counterpartContactId,
              amount,
              method,
              displayedBalance,
            })
          : await settleIndividualBalance({
              individualBalanceId,
              amount,
              method,
              counterpartContactId,
              displayedBalance,
            });

      if (!result.success) {
        // `null` on a terminal 401: credentials are already wiped and the
        // screen is being torn down, so there is nothing useful to say
        // (errorMessages.js's `isSessionTerminalError` note).
        setSettleError(result.error);
        return false;
      }
      return true;
    },
    [settleGroupBalance, settleIndividualBalance],
  );

  const clearSettleError = useCallback(() => {
    setSettleError(null);
  }, []);

  return {
    settle,
    isSettling: isSettlingGroup || isSettlingIndividual,
    settleError,
    clearSettleError,
  };
}
