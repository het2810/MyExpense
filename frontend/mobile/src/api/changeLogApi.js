import { authorizedRequest } from './apiClient';
import { CHANGE_LOG_PATHS } from './config';

/**
 * Change log — docs/api/api-overview.md §15.6/§15.7,
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §6.5.
 *
 * Owner-scoped and read-only. Entries are newest first (`created_at DESC,
 * id DESC`) and are never re-sorted on the client.
 *
 * Layer rule (ADR 0016 §1): imports `apiClient` and `config` only.
 */

/** §15.6: default 20, max 100. The per-entity log asks for the cache cap (50). */
export const CHANGE_LOG_ENTITY_PAGE_SIZE = 50;

/**
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
function buildQuery(params) {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/**
 * `GET /api/v1/change-log` -> `200 PageResponse<ChangeLogEntryResponse>`.
 * `entityType` and `entityId` are both-or-neither (`400` otherwise).
 *
 * @param {{ entityType?: string, entityId?: string, page?: number, size?: number }} [filters]
 * @returns {Promise<object>}
 */
export function listChangeLog({ entityType, entityId, page = 0, size = 20 } = {}) {
  return authorizedRequest(
    `${CHANGE_LOG_PATHS.list}${buildQuery({ entityType, entityId, page, size })}`,
  );
}

/**
 * `GET /api/v1/change-log/{id}` -> `200 ChangeLogEntryResponse`;
 * `404 CHANGE_LOG_ENTRY_NOT_FOUND`.
 *
 * @param {string} id
 * @returns {Promise<object>}
 */
export function getChangeLogEntry(id) {
  return authorizedRequest(CHANGE_LOG_PATHS.byId(id));
}
