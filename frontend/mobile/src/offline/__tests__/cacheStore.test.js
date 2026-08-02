/**
 * Cache envelopes, versioning, per-account keys and the sign-out wipe rules —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.3/§8.10.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  unwrapEnvelope,
  wrapEnvelope,
  readAllCaches,
  writeCache,
  readCache,
  wipeAccount,
} from '../cacheStore';
import { CACHE_SCHEMA_VERSIONS, storageKeys } from '../config';
import { newId, isSecureRandomAvailable } from '../ids';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('envelopes and versioning', () => {
  it('round-trips data and fetchStartedAt', () => {
    const envelope = wrapEnvelope('groups', { groups: [] }, '2026-11-11T10:00:00.000Z', 'now');
    expect(envelope.v).toBe(CACHE_SCHEMA_VERSIONS.groups);
    expect(unwrapEnvelope('groups', envelope)).toEqual({
      data: { groups: [] },
      fetchStartedAt: '2026-11-11T10:00:00.000Z',
    });
  });

  it('discards a mismatched version, an unknown store and junk', () => {
    expect(unwrapEnvelope('groups', { v: 999, data: {} })).toBeNull();
    expect(unwrapEnvelope('nope', { v: 1, data: {} })).toBeNull();
    expect(unwrapEnvelope('groups', 'garbage')).toBeNull();
  });

  it('readAllCaches returns valid envelopes and deletes stale-version keys', async () => {
    await writeCache('u1', 'groups', { groups: [] }, null);
    await AsyncStorage.setItem(
      storageKeys.cache('u1', 'contacts'),
      JSON.stringify({ v: 999, data: { contacts: [] } }),
    );
    await AsyncStorage.setItem(storageKeys.cache('u1', 'budget'), '{not json');

    const caches = await readAllCaches('u1');
    expect(Object.keys(caches)).toEqual(['groups']);
    expect(await AsyncStorage.getItem(storageKeys.cache('u1', 'contacts'))).toBeNull();
  });

  it('isolates accounts by key prefix', async () => {
    await writeCache('u1', 'groups', { groups: [{ id: 'g' }] }, null);
    expect(await readCache('u2', 'groups')).toBeNull();
  });
});

describe('wipeAccount', () => {
  async function seed() {
    await writeCache('u1', 'groups', { groups: [] }, null);
    await AsyncStorage.setItem(storageKeys.outboxIndex('u1'), JSON.stringify(['o1']));
    await AsyncStorage.setItem(storageKeys.outboxOp('u1', 'o1'), JSON.stringify({ opId: 'o1' }));
    await AsyncStorage.setItem(storageKeys.notices('u1'), JSON.stringify([]));
    await AsyncStorage.setItem(storageKeys.deviceId(), JSON.stringify('device'));
    await writeCache('u2', 'groups', { groups: [] }, null);
  }

  it('forced logout: caches only — the outbox and notices survive', async () => {
    await seed();
    await wipeAccount('u1', { keepOutbox: true });
    expect(await readCache('u1', 'groups')).toBeNull();
    expect(await AsyncStorage.getItem(storageKeys.outboxIndex('u1'))).not.toBeNull();
    expect(await AsyncStorage.getItem(storageKeys.notices('u1'))).not.toBeNull();
  });

  it('deliberate logout: the whole namespace, never another account or the device id', async () => {
    await seed();
    await wipeAccount('u1', { keepOutbox: false });
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.some((key) => key.includes('/u/u1/'))).toBe(false);
    expect(await readCache('u2', 'groups')).not.toBeNull();
    expect(await AsyncStorage.getItem(storageKeys.deviceId())).not.toBeNull();
  });
});

describe('ids', () => {
  it('builds RFC 4122 v4 UUIDs from a CSPRNG', () => {
    expect(isSecureRandomAvailable()).toBe(true);
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(id);
  });
});
