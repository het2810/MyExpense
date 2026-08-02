import { BUDGET_PATHS } from '../../api/config';
import { buildOp } from './buildOp';
import { newId } from '../ids';

/**
 * `budget.save` — `PUT /budget/periods` (ADR 0027 §3.4). The id is always
 * sent: an existing period's id edits in place under LWW, a new client id
 * creates.
 *
 * @param {{ id?: string | null, periodType: string, startDate: string,
 *   endDate: string, amount: number,
 *   categoryCaps: Array<{ categoryId: string, monthlyCap: number }>,
 *   categoryNamesById?: Record<string, string> }} values
 * @returns {object} op
 */
export function buildBudgetSaveOp(values) {
  const id = values.id || newId();
  const body = {
    id,
    periodType: values.periodType,
    startDate: values.startDate,
    endDate: values.endDate,
    amount: values.amount,
    categoryCaps: values.categoryCaps,
  };
  const names = values.categoryNamesById || {};
  return buildOp({
    type: 'budget.save',
    entityType: 'budget_period',
    entityId: id,
    method: 'PUT',
    path: BUDGET_PATHS.upsertPeriod,
    body,
    referencedIds: values.categoryCaps.map((cap) => cap.categoryId),
    affects: ['budget'],
    preview: {
      label: 'your budget',
      period: {
        ...body,
        categoryCaps: values.categoryCaps.map((cap) => ({
          categoryId: cap.categoryId,
          categoryName: names[cap.categoryId] ?? '',
          monthlyCap: Number(cap.monthlyCap),
        })),
      },
    },
  });
}
