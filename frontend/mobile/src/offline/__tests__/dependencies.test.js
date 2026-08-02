/**
 * Queue ordering and dependency blocking —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §7.4/§8.6.
 */
import {
  computeDependsOn,
  resolveDependencyState,
  collectDependents,
  indexOpsById,
} from '../dependencies';
import { classify, computeBackoffMs } from '../errorClassification';

function op(opId, fields = {}) {
  return { opId, status: 'pending', referencedIds: [], ledgerTargets: [], ...fields };
}

describe('computeDependsOn', () => {
  it('a create precedes its edits (same entityId)', () => {
    const create = op('o1', { type: 'transaction.create', entityId: 't1' });
    const edit = op('o2', { type: 'transaction.update', entityId: 't1' });
    expect(computeDependsOn(edit, [create])).toEqual(['o1']);
  });

  it('a contact create precedes the group and the split that reference it', () => {
    const contact = op('o1', { type: 'contact.create', entityId: 'c1' });
    const group = op('o2', { type: 'group.create', entityId: 'g1', referencedIds: ['c1'] });
    const split = op('o3', {
      type: 'split.create',
      entityId: 's1',
      referencedIds: ['g1'],
      ledgerTargets: ['group:g1'],
    });
    expect(computeDependsOn(group, [contact])).toEqual(['o1']);
    expect(computeDependsOn(split, [contact, group])).toEqual(['o2']);
  });

  it('a settlement waits for every earlier split/settlement on the same ledger target', () => {
    const split = op('o1', { type: 'split.create', entityId: 's1', ledgerTargets: ['contact:c1'] });
    const otherSplit = op('o2', {
      type: 'split.create',
      entityId: 's2',
      ledgerTargets: ['contact:c9'],
    });
    const settle = op('o3', {
      type: 'settlement.create',
      entityId: 'x1',
      ledgerTargets: ['contact:c1'],
    });
    expect(computeDependsOn(settle, [split, otherSplit])).toEqual(['o1']);
  });

  it('ignores acknowledged and superseded ops', () => {
    const acked = op('o1', { entityId: 't1', status: 'acked' });
    const superseded = op('o2', { entityId: 't1', status: 'superseded' });
    expect(computeDependsOn(op('o3', { entityId: 't1' }), [acked, superseded])).toEqual([]);
  });
});

describe('resolveDependencyState', () => {
  it('is ready when dependencies are acked or already pruned', () => {
    const byId = indexOpsById([op('o1', { status: 'acked' })]);
    expect(resolveDependencyState(op('o2', { dependsOn: ['o1', 'gone'] }), byId)).toBe('ready');
  });

  it('waits while a dependency is pending or in flight', () => {
    const byId = indexOpsById([op('o1', { status: 'inflight' })]);
    expect(resolveDependencyState(op('o2', { dependsOn: ['o1'] }), byId)).toBe('wait');
  });

  it('is blocked when a dependency failed or is itself blocked', () => {
    const failed = indexOpsById([op('o1', { status: 'failed' })]);
    const blocked = indexOpsById([op('o1', { status: 'blocked' })]);
    expect(resolveDependencyState(op('o2', { dependsOn: ['o1'] }), failed)).toBe('blocked');
    expect(resolveDependencyState(op('o2', { dependsOn: ['o1'] }), blocked)).toBe('blocked');
  });
});

describe('collectDependents', () => {
  it('collects transitive dependents in queue order, and nothing independent', () => {
    const ops = [
      op('o1'),
      op('o2', { dependsOn: ['o1'] }),
      op('o3'),
      op('o4', { dependsOn: ['o2'] }),
    ];
    expect(collectDependents('o1', ops)).toEqual(['o2', 'o4']);
  });
});

describe('classify', () => {
  const create = op('o1', { method: 'POST', type: 'transaction.create' });
  const del = op('o2', { method: 'DELETE', type: 'transaction.delete' });

  it.each([
    [null, 'acked'],
    [{ status: 0, code: 'NETWORK_UNAVAILABLE' }, 'transient'],
    [{ status: 0, code: 'TIMEOUT' }, 'transient'],
    [{ status: 503, code: 'X' }, 'transient'],
    [{ status: 429, code: 'RATE_LIMIT_EXCEEDED' }, 'transient'],
    [{ status: 401, code: 'UNAUTHORIZED' }, 'auth'],
    [{ status: 409, code: 'WRITE_SUPERSEDED' }, 'superseded'],
    [{ status: 409, code: 'ID_CONFLICT' }, 'failed'],
    [{ status: 400, code: 'VALIDATION_ERROR' }, 'failed'],
    [{ status: 404, code: 'TRANSACTION_NOT_FOUND' }, 'failed'],
  ])('%j on a create -> %s', (error, outcome) => {
    expect(classify(create, error).outcome).toBe(outcome);
  });

  it('treats 404 *_NOT_FOUND on a delete as already done', () => {
    expect(classify(del, { status: 404, code: 'TRANSACTION_NOT_FOUND' }).outcome).toBe('acked');
  });

  it('treats ALREADY_A_MEMBER on group.addMember as done', () => {
    const add = op('o3', { method: 'POST', type: 'group.addMember' });
    expect(classify(add, { status: 409, code: 'ALREADY_A_MEMBER' }).outcome).toBe('acked');
  });

  it('gives 429 a 30 s backoff floor', () => {
    expect(classify(create, { status: 429 }).backoffFloorMs).toBe(30000);
  });
});

describe('computeBackoffMs', () => {
  it('grows 2 s × 2^n, caps at 5 min, applies full jitter and the floor', () => {
    expect(computeBackoffMs(0, { random: () => 0.999999 })).toBe(1999);
    expect(computeBackoffMs(3, { random: () => 0.5 })).toBe(8000);
    expect(computeBackoffMs(20, { random: () => 0.999999 })).toBe(299999);
    expect(computeBackoffMs(0, { random: () => 0, floorMs: 30000 })).toBe(30000);
  });
});
