import { SPLIT_PATHS } from '../../api/config';
import { buildSettlementRequest } from '../../utils/splitRequests';
import { buildOp } from './buildOp';
import { getTodayIsoDate } from '../../utils/dateDisplay';
import { newId } from '../ids';

/**
 * `settlement.create` — `POST /splits/settle` with `id`, `expectedDirection`
 * and, for a pair the server has not created yet, `individualCounterpartContactId`
 * instead of `individualBalanceId` (ADR 0027 §7.2/§7.3).
 *
 * `expectedDirection` is always sent, from the balance the user saw when they
 * confirmed: a negative displayed balance means the caller pays.
 *
 * @param {{ target: 'group' | 'individual', groupId?: string | null,
 *   individualBalanceId?: string | null, individualCounterpartContactId?: string | null,
 *   counterpartUserId?: string | null, counterpartContactId?: string | null,
 *   amount: number, method: string, displayedBalance: number, label: string,
 *   counterpartName?: string }} values
 * @returns {object} op
 */
export function buildSettlementCreateOp(values) {
  const id = newId();
  const usesContactTarget =
    values.target === 'individual' && !values.individualBalanceId && values.individualCounterpartContactId;

  const base = usesContactTarget
    ? {
        target: 'individual',
        individualCounterpartContactId: values.individualCounterpartContactId,
        amount: values.amount,
        method: values.method,
      }
    : buildSettlementRequest(values);

  const body = {
    ...base,
    id,
    expectedDirection: values.displayedBalance < 0 ? 'caller_pays' : 'caller_receives',
  };

  // `pair:{id}` (ADR 0028 §7.7): a settlement on an existing pair also waits
  // for every earlier queued edit or delete of a split that moved that pair.
  const ledgerTargets =
    values.target === 'group'
      ? [`group:${values.groupId}`]
      : [
          values.individualCounterpartContactId ? `contact:${values.individualCounterpartContactId}` : null,
          values.individualBalanceId ? `pair:${values.individualBalanceId}` : null,
        ].filter(Boolean);

  return buildOp({
    type: 'settlement.create',
    entityType: 'settlement',
    entityId: id,
    method: 'POST',
    path: SPLIT_PATHS.settle,
    body,
    referencedIds: [values.groupId, values.individualCounterpartContactId, values.counterpartContactId],
    ledgerTargets,
    // `splitFeed`: the overlay inserts the settlement into its group's or
    // pair's feed (ADR 0028 §7.7).
    affects: values.target === 'group' ? ['groups', 'splitFeed'] : ['individualBalances', 'splitFeed'],
    preview: {
      label: values.label,
      target: values.target,
      groupId: values.groupId ?? null,
      individualBalanceId: values.individualBalanceId ?? null,
      counterpartContactId: values.individualCounterpartContactId ?? null,
      amount: values.amount,
      // The other party, for the feed item's payer/payee (ADR 0028 §7.7).
      counterpart: {
        userId: values.counterpartUserId ?? null,
        contactId: values.counterpartContactId ?? values.individualCounterpartContactId ?? null,
        name: values.counterpartName ?? '',
      },
      occurredOn: getTodayIsoDate(),
    },
  });
}
