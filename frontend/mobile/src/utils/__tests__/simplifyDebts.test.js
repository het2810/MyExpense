/**
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §8.2's
 * required vectors.
 */
import { simplifyDebts, toMemberKey } from '../simplifyDebts';

const A = 'u:aaaaaaaa-0000-0000-0000-000000000001';
const B = 'u:bbbbbbbb-0000-0000-0000-000000000002';
const C = 'u:cccccccc-0000-0000-0000-000000000003';
const D = 'u:dddddddd-0000-0000-0000-000000000004';

function summarize(result) {
  return result.debts.map((debt) => [debt.fromKey, debt.toKey, debt.amount]);
}

test('A +600, B -300, C -300: B->A then C->A (tie broken by smaller key)', () => {
  const result = simplifyDebts([
    { key: A, balance: 600 },
    { key: C, balance: -300 },
    { key: B, balance: -300 },
  ]);
  expect(result.error).toBeNull();
  expect(summarize(result)).toEqual([
    [B, A, 300],
    [C, A, 300],
  ]);
});

test('A +500, B -100, C -400: C->A 400, B->A 100', () => {
  expect(
    summarize(
      simplifyDebts([
        { key: A, balance: 500 },
        { key: B, balance: -100 },
        { key: C, balance: -400 },
      ]),
    ),
  ).toEqual([
    [C, A, 400],
    [B, A, 100],
  ]);
});

test('A +250, B +80, C -120, D -210: D->A 210, C->A 40, C->B 80', () => {
  const result = simplifyDebts([
    { key: A, balance: 250 },
    { key: B, balance: 80 },
    { key: C, balance: -120 },
    { key: D, balance: -210 },
  ]);
  // The ADR's vector lists these three transfers. Its own step 4 (largest
  // creditor first) emits C->B 80 before C->A 40, because after D->A the
  // creditors are A 40 and B 80; the emission order below follows the
  // algorithm, and the set of transfers is the ADR's.
  expect(summarize(result)).toEqual([
    [D, A, 210],
    [C, B, 80],
    [C, A, 40],
  ]);
  expect(summarize(result)).toEqual(
    expect.arrayContaining([
      [D, A, 210],
      [C, A, 40],
      [C, B, 80],
    ]),
  );
});

test('A +0.01, B -0.01: B->A 0.01, paise-exact', () => {
  const result = simplifyDebts([
    { key: A, balance: 0.01 },
    { key: B, balance: -0.01 },
  ]);
  expect(summarize(result)).toEqual([[B, A, 0.01]]);
  expect(result.debts[0].amountPaise).toBe(1);
});

test('all zero: no debts', () => {
  expect(
    simplifyDebts([
      { key: A, balance: 0 },
      { key: B, balance: 0 },
    ]),
  ).toEqual({ debts: [], error: null });
});

test('A +1, B -2: unbalanced, never guesses', () => {
  expect(
    simplifyDebts([
      { key: A, balance: 1 },
      { key: B, balance: -2 },
    ]),
  ).toEqual({ debts: [], error: 'unbalanced' });
});

test('float inputs that are exact in paise do not drift', () => {
  const result = simplifyDebts([
    { key: A, balance: 0.1 + 0.2 },
    { key: B, balance: -0.3 },
  ]);
  expect(result.error).toBeNull();
  expect(result.debts[0].amountPaise).toBe(30);
});

test('member keys are lowercase and typed', () => {
  expect(toMemberKey({ userId: 'ABC' })).toBe('u:abc');
  expect(toMemberKey({ invitedContactId: 'DEF' })).toBe('c:def');
  expect(toMemberKey({})).toBeNull();
});
