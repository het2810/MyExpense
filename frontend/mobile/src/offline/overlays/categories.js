import { insertCategory, applyCategoryUpdate, removeCategory } from '../../utils/categoryTree';
import { toLocalSyncStatus } from './activeOps';

/**
 * Categories overlay — ADR 0027 §8.8. Applies queued creates, edits and
 * deletes to the cached tree with the same pure tree edits the store uses for
 * a confirmed write (`utils/categoryTree.js`).
 *
 * @param {object[]} categories Snapshot tree.
 * @param {object[]} ops Active ops affecting `categories`, queue order.
 * @returns {object[]}
 */
export function overlayCategories(categories, ops) {
  if (ops.length === 0) {
    return categories;
  }
  return ops.reduce((tree, op) => {
    if (op.type === 'category.create' && op.preview?.category) {
      const exists = tree.some(
        (category) =>
          category.id === op.entityId ||
          (category.subcategories ?? []).some((child) => child.id === op.entityId),
      );
      if (exists) {
        return tree;
      }
      return insertCategory(
        tree,
        { ...op.preview.category, localSyncStatus: toLocalSyncStatus(op) },
        op.preview.category.parentCategoryId ?? null,
      );
    }
    if (op.type === 'category.update') {
      return applyCategoryUpdate(tree, { id: op.entityId, ...op.body });
    }
    if (op.type === 'category.delete') {
      return removeCategory(tree, op.entityId);
    }
    return tree;
  }, categories);
}
