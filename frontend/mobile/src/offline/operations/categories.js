import { CATEGORY_PATHS } from '../../api/config';
import { buildOp } from './buildOp';
import { newId } from '../ids';

/**
 * Category op builders — ADR 0027 §3.2/§8.5. An update or delete also changes
 * how cached transactions render (rename / reassignment to Misc, ADR
 * 0021/0024), so both list `transactions` in `affects`.
 */

/**
 * @param {{ name: string, iconName: string, glyph: string,
 *   parentCategoryId?: string | null }} values
 * @returns {object} op
 */
export function buildCategoryCreateOp({ name, iconName, glyph, parentCategoryId = null }) {
  const id = newId();
  const body = { id, name, iconName, glyph, parentCategoryId };
  return buildOp({
    type: 'category.create',
    entityType: 'category',
    entityId: id,
    method: 'POST',
    path: CATEGORY_PATHS.create,
    body,
    referencedIds: [parentCategoryId],
    affects: ['categories'],
    preview: { label: name, category: body },
  });
}

/**
 * @param {{ categoryId: string, changes: object, label: string }} input
 * @returns {object} op
 */
export function buildCategoryUpdateOp({ categoryId, changes, label }) {
  return buildOp({
    type: 'category.update',
    entityType: 'category',
    entityId: categoryId,
    method: 'PATCH',
    path: CATEGORY_PATHS.byId(categoryId),
    body: changes,
    affects: ['categories', 'transactions'],
    preview: { label: changes.name ?? label, patch: changes },
  });
}

/**
 * @param {{ categoryId: string, label: string, miscCategory: object | null }} input
 *   `miscCategory`: the cached protected category transactions move to.
 * @returns {object} op
 */
export function buildCategoryDeleteOp({ categoryId, label, miscCategory }) {
  return buildOp({
    type: 'category.delete',
    entityType: 'category',
    entityId: categoryId,
    method: 'DELETE',
    path: CATEGORY_PATHS.byId(categoryId),
    affects: ['categories', 'transactions'],
    preview: { label, miscCategory },
  });
}
