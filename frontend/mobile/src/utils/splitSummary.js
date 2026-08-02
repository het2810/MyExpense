import { joinPayerLabels, labelDraftPayers } from './splitParticipants';

/**
 * Split Add Expense's summary-chip copy — ADR 0005 §3.4's general rule,
 * exhaustive for every splitConfig the feature can produce. Moved out of
 * SplitAddExpenseScreen.jsx unchanged when that screen took the edit mode of
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md
 * §11.5 and had to shrink rather than grow (constitution §26).
 */

// ADR 0005 §3.4's exhaustive method-label mapping for the chip's fallback copy
// (`${payerLabel} paid, split by ${methodLabel}.`).
const METHOD_LABELS = {
  equally: 'equally',
  unequally: 'exact amounts',
  percentage: 'percentage',
  shares: 'shares',
  adjustment: 'adjustment',
};

/**
 * @param {object | null} splitConfig
 * @param {object[] | null} participants The roster, self first.
 * @returns {string}
 */
export function getSplitSummaryText(splitConfig, participants) {
  if (!splitConfig || !participants || participants.length < 2) {
    return 'You paid, split equally.';
  }

  // Multiple payers (docs/decisions/0025-multiple-payers-per-split-expense.md
  // §8.6): the joined payer labels in roster order, "You" for 'self'.
  // Single-payer copy below is unchanged.
  if (Array.isArray(splitConfig.payers) && splitConfig.payers.length >= 2) {
    const joinedPayers = joinPayerLabels(
      labelDraftPayers(splitConfig.payers, participants).map((payer) => payer.label),
    );
    if (splitConfig.method === 'equally' && participants.length === 2) {
      return `${joinedPayers} paid, split equally.`;
    }
    const multiMethodLabel = METHOD_LABELS[splitConfig.method] ?? splitConfig.method;
    return `${joinedPayers} paid, split by ${multiMethodLabel}.`;
  }

  const other = participants[1];

  if (splitConfig.method === 'equally' && participants.length === 2) {
    return splitConfig.paidById === 'self'
      ? 'You paid, split equally.'
      : `${other.name} paid, split equally.`;
  }

  const payer = participants.find((participant) => participant.participantId === splitConfig.paidById);
  const payerLabel = splitConfig.paidById === 'self' ? 'You' : payer?.name ?? 'Someone';
  const methodLabel = METHOD_LABELS[splitConfig.method] ?? splitConfig.method;

  return `${payerLabel} paid, split by ${methodLabel}.`;
}
