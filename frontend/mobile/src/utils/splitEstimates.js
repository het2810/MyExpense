import { toPaise } from './currency';

/**
 * Device-side balance **estimates** for a split saved while offline —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.8.
 *
 * These numbers are only ever displayed, always with "≈" and
 * "Estimated · n change(s) waiting to sync", and are replaced by the server's
 * figures on the next pull. They are never sent: the server recomputes every
 * balance on replay (§7.1).
 *
 * Group: the caller's balance moves by `paid − share`.
 * Individual (one or more contacts): each participant's net position is
 * `paid − share`; the caller's credit (or debt) is spread over the debtors (or
 * creditors) in proportion to their net positions. That is exact for the
 * common shapes (one payer; one counterpart) and a labelled approximation for
 * multi-payer multi-contact splits, where the server's own pairing rule
 * decides the final pair figures.
 *
 * Pure.
 */

const SELF_PARTICIPANT_ID = 'self';

/**
 * @param {number} value
 * @returns {number}
 */
function roundToPaise(value) {
  return toPaise(value) / 100;
}

/**
 * Who paid how much, from a split config in either payer form.
 *
 * @param {{ paidById: string | null,
 *   payers?: Array<{ participantId: string, amount: number }> | null }} splitConfig
 * @param {number} amount
 * @returns {Record<string, number>}
 */
function paidByParticipant(splitConfig, amount) {
  const paid = {};
  const payers = Array.isArray(splitConfig.payers) ? splitConfig.payers : null;
  if (payers && payers.length >= 2) {
    payers.forEach((entry) => {
      paid[entry.participantId] = (paid[entry.participantId] ?? 0) + Number(entry.amount);
    });
    return paid;
  }
  const payerId = payers && payers.length === 1 ? payers[0].participantId : splitConfig.paidById;
  if (payerId) {
    paid[payerId] = Number(amount);
  }
  return paid;
}

/**
 * @param {{ amount: number, splitMode: 'individual' | 'group',
 *   splitConfig: { paidById: string | null, payers?: object[] | null,
 *     participantAmounts: Array<{ participantId: string, amount: number }> },
 *   participants: object[] }} values
 * @returns {{ callerPaid: number, callerShare: number,
 *   counterpartNetAmounts: Array<{ contactId: string, netAmount: number, name: string }> }}
 */
export function estimateSplitBalanceEffects({ amount, splitMode, splitConfig, participants }) {
  if (!splitConfig) {
    return { callerPaid: 0, callerShare: 0, counterpartNetAmounts: [] };
  }
  const paid = paidByParticipant(splitConfig, amount);
  const shares = {};
  (splitConfig.participantAmounts ?? []).forEach((entry) => {
    shares[entry.participantId] = Number(entry.amount);
  });

  const callerPaid = roundToPaise(paid[SELF_PARTICIPANT_ID] ?? 0);
  const callerShare = roundToPaise(shares[SELF_PARTICIPANT_ID] ?? 0);
  if (splitMode === 'group') {
    return { callerPaid, callerShare, counterpartNetAmounts: [] };
  }

  const roster = participants ?? [];
  const netOf = (participantId) => (paid[participantId] ?? 0) - (shares[participantId] ?? 0);
  const callerNet = netOf(SELF_PARTICIPANT_ID);
  const totalCredit = roster.reduce(
    (sum, participant) => sum + Math.max(0, netOf(participant.participantId)),
    0,
  );

  const counterpartNetAmounts = roster
    .filter((participant) => participant.participantContactId)
    .map((participant) => {
      const contactNet = netOf(participant.participantId);
      let netAmount = 0;
      if (totalCredit > 0 && callerNet > 0 && contactNet < 0) {
        // The contact owes; part of it is owed to the caller.
        netAmount = -(-contactNet * (callerNet / totalCredit));
      } else if (totalCredit > 0 && callerNet < 0 && contactNet > 0) {
        // The caller owes; part of it goes to this contact.
        netAmount = -callerNet * (contactNet / totalCredit);
      }
      return {
        contactId: participant.participantContactId,
        name: participant.name ?? '',
        netAmount: roundToPaise(netAmount),
      };
    });

  return { callerPaid, callerShare, counterpartNetAmounts };
}
