/**
 * The flush loop — docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.6.
 * Strict queue order, dependency blocking, "a permanent failure never blocks
 * the queue", transient stop, and the four write headers.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authorizedRequest } from '../../api/apiClient';
import { loadOutbox, appendOp, getOps, clearOutboxMemory, OP_STATUS } from '../outbox';
import { loadNotices, getNotices, clearNoticesMemory } from '../notices';
import { startSyncEngine, stopSyncEngine, requestFlush } from '../syncEngine';
import { OUTBOX_SCHEMA_VERSION } from '../config';

jest.mock('../../api/apiClient', () => ({ authorizedRequest: jest.fn() }));

const USER = 'user-1';

function op(opId, fields = {}) {
  return {
    v: OUTBOX_SCHEMA_VERSION,
    opId,
    type: 'transaction.create',
    entityType: 'transaction',
    entityId: `e-${opId}`,
    method: 'POST',
    path: `/p/${opId}`,
    body: {},
    clientUpdatedAt: '2026-11-11T10:00:00.000Z',
    enqueuedOnline: true,
    referencedIds: [],
    ledgerTargets: [],
    dependsOn: [],
    affects: ['transactions'],
    preview: { label: opId },
    status: OP_STATUS.pending,
    attempts: 0,
    lastError: null,
    ackedAt: null,
    createdAt: '2026-11-11T10:00:00.000Z',
    ...fields,
  };
}

async function runFlush() {
  startSyncEngine({ userId: USER, getSessionEpoch: () => 1 });
  await requestFlush('test');
}

beforeEach(async () => {
  await AsyncStorage.clear();
  clearOutboxMemory();
  clearNoticesMemory();
  authorizedRequest.mockReset();
  await loadOutbox(USER);
  await loadNotices(USER);
});

afterEach(() => {
  stopSyncEngine();
});

it('sends in queue order, blocks only the dependents of a permanent failure, and continues', async () => {
  await appendOp(op('o1', { entityId: 't1' }));
  await appendOp(op('o2', { entityId: 't1', type: 'transaction.update', method: 'PATCH', dependsOn: ['o1'] }));
  await appendOp(op('o3', { entityId: 'c9', type: 'category.create' }));
  await appendOp(op('o4', { entityId: 't4', dependsOn: ['o3'] }));
  await appendOp(op('o5', { entityId: 't5' }));

  authorizedRequest.mockImplementation((path) => {
    if (path === '/p/o3') {
      return Promise.reject({ status: 400, code: 'VALIDATION_ERROR', message: 'bad' });
    }
    return Promise.resolve({});
  });

  await runFlush();

  expect(authorizedRequest.mock.calls.map(([path]) => path)).toEqual([
    '/p/o1',
    '/p/o2',
    '/p/o3',
    '/p/o5',
  ]);
  // Acked ops are pruned once no store snapshot needs them; the failure and
  // its blocked dependent remain for the user.
  const remaining = Object.fromEntries(getOps().map((entry) => [entry.opId, entry.status]));
  expect(remaining).toEqual({ o3: OP_STATUS.failed, o4: OP_STATUS.blocked });
  expect(getNotices().map((notice) => notice.id)).toEqual(['failed:o3']);
});

it('sends the four write headers, with the opId as Idempotency-Key', async () => {
  await appendOp(op('o1'));
  authorizedRequest.mockResolvedValue({});

  await runFlush();

  const [, options] = authorizedRequest.mock.calls[0];
  expect(options.method).toBe('POST');
  expect(options.headers['Idempotency-Key']).toBe('o1');
  expect(options.headers['X-Client-Updated-At']).toBe('2026-11-11T10:00:00.000Z');
  expect(options.headers['X-Client-Origin']).toBe('live');
  expect(options.headers['X-Device-Id']).toMatch(/^[0-9a-f-]{36}$/);
});

it('stops on a transient failure, keeps the op pending with the same opId, sends nothing after it', async () => {
  await appendOp(op('o1'));
  await appendOp(op('o2'));
  authorizedRequest.mockRejectedValue({ status: 0, code: 'NETWORK_UNAVAILABLE' });

  await runFlush();

  expect(authorizedRequest).toHaveBeenCalledTimes(1);
  const [first, second] = getOps();
  expect(first).toMatchObject({ opId: 'o1', status: OP_STATUS.pending, attempts: 1 });
  expect(second).toMatchObject({ opId: 'o2', status: OP_STATUS.pending, attempts: 0 });
});

it('marks a superseded write without blocking anything after it', async () => {
  await appendOp(op('o1', { type: 'transaction.update', method: 'PATCH' }));
  await appendOp(op('o2', { entityId: 'e-o1', dependsOn: ['o1'], type: 'transaction.delete', method: 'DELETE' }));
  authorizedRequest
    .mockRejectedValueOnce({ status: 409, code: 'WRITE_SUPERSEDED' })
    .mockResolvedValueOnce(null);

  await runFlush();

  expect(authorizedRequest).toHaveBeenCalledTimes(2);
  expect(getOps()).toEqual([]);
  expect(getNotices().map((notice) => notice.kind)).toEqual(['superseded']);
});
