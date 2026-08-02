/**
 * Outbox durability and crash recovery —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.5.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  recoverOutbox,
  loadOutbox,
  appendOp,
  updateOp,
  removeOps,
  getOps,
  clearOutboxMemory,
  OP_STATUS,
} from '../outbox';
import { storageKeys, OUTBOX_SCHEMA_VERSION } from '../config';

const USER = 'user-1';

function op(opId, overrides = {}) {
  return {
    v: OUTBOX_SCHEMA_VERSION,
    opId,
    type: 'transaction.create',
    entityType: 'transaction',
    entityId: `entity-${opId}`,
    status: OP_STATUS.pending,
    attempts: 0,
    createdAt: `2026-11-11T10:00:0${opId.slice(-1)}.000Z`,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  clearOutboxMemory();
});

describe('recoverOutbox (pure)', () => {
  it('keeps index order and drops index entries with no op record', () => {
    const result = recoverOutbox(['a1', 'missing', 'b2'], { a1: op('a1'), b2: op('b2') });
    expect(result.index).toEqual(['a1', 'b2']);
    expect(result.indexChanged).toBe(true);
  });

  it('re-inserts an op missing from the index (crash between the two append writes), in createdAt order', () => {
    const result = recoverOutbox(['a1'], {
      a1: op('a1'),
      c3: op('c3'),
      b2: op('b2'),
    });
    expect(result.index).toEqual(['a1', 'b2', 'c3']);
    expect(result.indexChanged).toBe(true);
  });

  it('turns inflight back into pending (app killed mid-flush) and keeps the same opId', () => {
    const result = recoverOutbox(['a1'], { a1: op('a1', { status: OP_STATUS.inflight }) });
    expect(result.opsById.a1.status).toBe(OP_STATUS.pending);
    expect(result.opsById.a1.opId).toBe('a1');
    expect(result.resetOpIds).toEqual(['a1']);
  });

  it('never resurrects a terminal orphan (half-finished removal or discard)', () => {
    const result = recoverOutbox([], {
      a1: op('a1', { status: OP_STATUS.acked }),
      b2: op('b2', { status: OP_STATUS.discarded }),
    });
    expect(result.index).toEqual([]);
    expect(result.orphanKeysToRemove.sort()).toEqual(['a1', 'b2']);
  });

  it('leaves an op from a newer app version untouched and reports it', () => {
    const future = op('a1', { v: OUTBOX_SCHEMA_VERSION + 1, status: OP_STATUS.inflight });
    const result = recoverOutbox(['a1'], { a1: future });
    expect(result.opsById.a1).toBe(future);
    expect(result.hasFutureVersion).toBe(true);
  });
});

describe('durable outbox', () => {
  it('appends op then index, and survives a reload in order', async () => {
    await loadOutbox(USER);
    await appendOp(op('a1'));
    await appendOp(op('b2'));
    expect(JSON.parse(await AsyncStorage.getItem(storageKeys.outboxIndex(USER)))).toEqual([
      'a1',
      'b2',
    ]);

    clearOutboxMemory();
    await loadOutbox(USER);
    expect(getOps().map((entry) => entry.opId)).toEqual(['a1', 'b2']);
  });

  it('recovers from a crash between the op write and the index write', async () => {
    await loadOutbox(USER);
    await appendOp(op('a1'));
    // Simulate the crash: the op key landed, the index write did not.
    await AsyncStorage.setItem(storageKeys.outboxOp(USER, 'b2'), JSON.stringify(op('b2')));

    clearOutboxMemory();
    await loadOutbox(USER);
    expect(getOps().map((entry) => entry.opId)).toEqual(['a1', 'b2']);
    expect(JSON.parse(await AsyncStorage.getItem(storageKeys.outboxIndex(USER)))).toEqual([
      'a1',
      'b2',
    ]);
  });

  it('persists inflight before sending, and a reload resets it to pending', async () => {
    await loadOutbox(USER);
    await appendOp(op('a1'));
    await updateOp('a1', { status: OP_STATUS.inflight, attempts: 1 });

    clearOutboxMemory();
    await loadOutbox(USER);
    const [recovered] = getOps();
    expect(recovered.status).toBe(OP_STATUS.pending);
    expect(recovered.attempts).toBe(1);
    expect(JSON.parse(await AsyncStorage.getItem(storageKeys.outboxOp(USER, 'a1'))).status).toBe(
      OP_STATUS.pending,
    );
  });

  it('removes index entry first and the op key after; a discarded op never comes back', async () => {
    await loadOutbox(USER);
    await appendOp(op('a1'));
    await appendOp(op('b2'));
    await removeOps(['a1']);
    expect(getOps().map((entry) => entry.opId)).toEqual(['b2']);
    expect(await AsyncStorage.getItem(storageKeys.outboxOp(USER, 'a1'))).toBeNull();

    clearOutboxMemory();
    await loadOutbox(USER);
    expect(getOps().map((entry) => entry.opId)).toEqual(['b2']);
  });

  it('keeps accounts apart by key prefix', async () => {
    await loadOutbox(USER);
    await appendOp(op('a1'));
    clearOutboxMemory();
    await loadOutbox('user-2');
    expect(getOps()).toEqual([]);
  });
});
