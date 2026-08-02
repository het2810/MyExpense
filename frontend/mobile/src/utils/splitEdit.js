import { buildSplitExpenseCreateRequest } from './splitRequests';
import {
  SELF_PARTICIPANT_ID,
  buildGroupParticipants,
  findPairEffect,
  resolveSplitExpenseCounterparts,
  resolveSplitExpensePayers,
} from './splitParticipants';
import { getInitialsFromName } from './initials';
import { toMemberKey } from './simplifyDebts';

/**
 * Editing and deleting a saved split expense on the client —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §2,
 * §5.2, §7.7, §11.4/§11.5.
 *
 * Kept out of `SplitAddExpenseScreen.jsx` (already far past constitution §26)
 * and out of the store: every function here is pure, and the store, the op
 * builder and the offline overlays share them so a queued edit is previewed by
 * exactly the rules the server applies.
 */

/** Methods that reopen on their own Adjust Split tab (§11.5). */
const REOPENABLE_METHODS = new Set(['equally', 'unequally']);

/** §6.2's editable fields — everything else on the create body is immutable (U1). */
const EDITABLE_REQUEST_FIELDS = [
  'title',
  'categoryId',
  'splitDate',
  'amount',
  'splitMethod',
  'paidByUserId',
  'paidByContactId',
  'payers',
  'participants',
];

/**
 * @param {number} value
 * @returns {number}
 */
function roundToPaise(value) {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/**
 * §11.4 — a UX check only; the server re-checks.
 *
 * @param {object} splitExpense
 * @param {string | null} currentUserId
 * @returns {boolean}
 */
export function canEditSplitExpense(splitExpense, currentUserId) {
  if (!splitExpense || splitExpense.deletedAt) {
    return false;
  }
  return (
    splitExpense.splitMode === 'group' ||
    (Boolean(currentUserId) && splitExpense.createdByUserId === currentUserId)
  );
}

/**
 * The local participant key (`self`, `user:{id}`, `contact:{id}`) for a
 * stored two-column identity — the same keys the roster builders produce.
 *
 * @param {string | null | undefined} userId
 * @param {string | null | undefined} contactId
 * @param {string | null} currentUserId
 * @returns {string | null}
 */
export function toParticipantKey(userId, contactId, currentUserId) {
  if (userId && userId === currentUserId) {
    return SELF_PARTICIPANT_ID;
  }
  if (userId) {
    return `user:${userId}`;
  }
  if (contactId) {
    return `contact:${contactId}`;
  }
  return null;
}

/**
 * The fixed roster an edit works over (§2.2: the audience is immutable).
 *
 * - **Group:** the group's current members (`buildGroupParticipants`) when the
 *   group is held; otherwise everyone the split names.
 * - **Individual:** the creator (the viewer — only they may edit) and each
 *   counterpart exactly as `counterparts[]` names them, which is §4.3's rule 2
 *   for a valid identity.
 *
 * @param {{ splitExpense: object, group?: object | null,
 *   identity: { userId: string, fullName: string, initials: string } }} args
 * @returns {object[]}
 */
export function buildEditRoster({ splitExpense, group = null, identity }) {
  const self = {
    participantId: SELF_PARTICIPANT_ID,
    participantUserId: identity.userId || null,
    participantContactId: null,
    name: identity.fullName,
    initials: identity.initials,
  };

  if (splitExpense.splitMode === 'group' && group) {
    return buildGroupParticipants({
      currentUserId: identity.userId,
      fullName: identity.fullName,
      initials: identity.initials,
      group,
    });
  }

  const others = [];
  const addOther = (userId, contactId, name) => {
    const participantId = toParticipantKey(userId, contactId, identity.userId);
    if (!participantId || participantId === SELF_PARTICIPANT_ID) {
      return;
    }
    if (others.some((entry) => entry.participantId === participantId)) {
      return;
    }
    others.push({
      participantId,
      participantUserId: userId ?? null,
      participantContactId: userId ? null : contactId ?? null,
      name: name || 'Someone',
      initials: getInitialsFromName(name || 'Someone'),
    });
  };

  if (splitExpense.splitMode === 'individual') {
    resolveSplitExpenseCounterparts(splitExpense).forEach((counterpart) =>
      addOther(counterpart.counterpartUserId, counterpart.counterpartContactId, counterpart.name),
    );
  } else {
    (splitExpense.participants ?? []).forEach((participant) =>
      addOther(participant.participantUserId, participant.participantContactId, participant.name),
    );
    resolveSplitExpensePayers(splitExpense).forEach((payer) =>
      addOther(payer.payerUserId, payer.payerContactId, payer.name),
    );
  }
  return [self, ...others];
}

/**
 * Prefills Split Add Expense's `splitConfig` from a saved split (§11.5):
 * `equally`/`unequally` reopen on their own tab; `percentage`, `shares` and
 * `adjustment` reopen on **Unequally** with the stored amounts, because the
 * original percentages or shares are not stored. Every roster member gets an
 * entry (zero when the split gave them no share).
 *
 * @param {object} splitExpense
 * @param {string} currentUserId
 * @param {object[]} roster From `buildEditRoster`.
 * @returns {{ method: string, paidById: string | null,
 *   payers: Array<{ participantId: string, amount: number }> | null,
 *   participantAmounts: Array<{ participantId: string, name: string, amount: number }> }}
 */
export function buildSplitConfigFromSplitExpense(splitExpense, currentUserId, roster) {
  const shareByKey = new Map();
  (splitExpense.participants ?? []).forEach((participant) => {
    const key = toParticipantKey(
      participant.participantUserId,
      participant.participantContactId,
      currentUserId,
    );
    if (key) {
      shareByKey.set(key, (shareByKey.get(key) ?? 0) + Number(participant.amount || 0));
    }
  });

  const payers = resolveSplitExpensePayers(splitExpense)
    .map((payer) => ({
      participantId: toParticipantKey(payer.payerUserId, payer.payerContactId, currentUserId),
      amount: Number(payer.amount || 0),
    }))
    .filter((payer) => payer.participantId);

  const isMultiPayer = payers.length >= 2;
  return {
    method: REOPENABLE_METHODS.has(splitExpense.splitMethod) ? splitExpense.splitMethod : 'unequally',
    paidById: isMultiPayer ? null : payers[0]?.participantId ?? SELF_PARTICIPANT_ID,
    payers: isMultiPayer ? payers : null,
    participantAmounts: roster.map((participant) => ({
      participantId: participant.participantId,
      name: participant.name,
      amount: roundToPaise(shareByKey.get(participant.participantId) ?? 0),
    })),
  };
}

/**
 * The `PUT /split-expenses/{id}` body (§6.2), reusing the create builder's
 * payer and participant mapping so one-contact and single-payer edits send
 * exactly the create shapes. The immutable fields (U1) are never sent, and
 * `categoryId` is omitted when unchanged (absent = unchanged), which also keeps
 * a non-creator clear of U2.
 *
 * @param {{ title: string, categoryId: string | null, splitDate: string,
 *   amount: number, splitConfig: object, participants: object[] }} values
 * @param {object} originalSplit The split being edited.
 * @returns {object}
 */
export function buildSplitExpenseUpdateRequest(values, originalSplit) {
  const createBody = buildSplitExpenseCreateRequest({
    ...values,
    splitMode: 'group',
    groupId: null,
    individualCounterpartContactId: null,
    individualCounterpartContactIds: null,
    addToPersonalExpenses: false,
  });
  const body = {};
  EDITABLE_REQUEST_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(createBody, field)) {
      body[field] = createBody[field];
    }
  });
  if (!body.categoryId || body.categoryId === originalSplit?.categoryId) {
    delete body.categoryId;
  }
  return body;
}

/**
 * @param {object[]} roster
 * @param {string | null} userId
 * @param {string | null} contactId
 * @returns {string}
 */
function nameFromRoster(roster, userId, contactId) {
  const match = (roster ?? []).find(
    (entry) =>
      (userId && entry.participantUserId === userId) ||
      (contactId && entry.participantContactId === contactId),
  );
  return match?.name ?? 'Someone';
}

/**
 * The split as it will read once a queued edit applies — what the feed overlay
 * shows in place of the cached one (§7.7). Names come from the roster;
 * `counterparts[].netAmount` is recomputed as `paid(c) − share(c)` (ADR 0026
 * §5.2: positive = the creator owes that counterpart).
 *
 * @param {object} splitExpense The cached split.
 * @param {object} body An update request body.
 * @param {object[]} roster
 * @param {object | null} categorySnapshot The new category's snapshot, when it changed.
 * @returns {object}
 */
export function projectSplitExpenseEdit(splitExpense, body, roster, categorySnapshot = null) {
  const payers = Array.isArray(body.payers)
    ? body.payers.map((payer) => ({
        ...payer,
        name: nameFromRoster(roster, payer.payerUserId, payer.payerContactId),
      }))
    : [
        {
          payerUserId: body.paidByUserId ?? null,
          payerContactId: body.paidByContactId ?? null,
          name: nameFromRoster(roster, body.paidByUserId, body.paidByContactId),
          amount: body.amount,
        },
      ];
  const participants = body.participants.map((participant) => ({
    ...participant,
    name: nameFromRoster(roster, participant.participantUserId, participant.participantContactId),
  }));

  const sumFor = (entries, userField, contactField, userId, contactId) =>
    entries
      .filter(
        (entry) =>
          (userId && entry[userField] === userId) || (contactId && entry[contactField] === contactId),
      )
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const counterparts = (splitExpense.counterparts ?? []).map((counterpart) => {
    const paid = sumFor(
      payers,
      'payerUserId',
      'payerContactId',
      counterpart.counterpartUserId,
      counterpart.counterpartContactId,
    );
    const share = sumFor(
      participants,
      'participantUserId',
      'participantContactId',
      counterpart.counterpartUserId,
      counterpart.counterpartContactId,
    );
    return { ...counterpart, netAmount: roundToPaise(paid - share) };
  });

  return {
    ...splitExpense,
    title: body.title,
    splitDate: body.splitDate,
    amount: body.amount,
    splitMethod: body.splitMethod,
    ...(categorySnapshot
      ? {
          categoryId: categorySnapshot.categoryId ?? splitExpense.categoryId,
          categoryName: categorySnapshot.categoryName,
          parentCategoryName: categorySnapshot.parentCategoryName ?? null,
          categoryIconName: categorySnapshot.categoryIconName ?? null,
          categoryGlyph: categorySnapshot.categoryGlyph,
        }
      : {}),
    paidByUserId: payers[0]?.payerUserId ?? null,
    paidByContactId: payers[0]?.payerContactId ?? null,
    paidByName: payers[0]?.name ?? '',
    payers,
    participants,
    counterparts,
  };
}

/**
 * Every identity's `paid − share` in a group split, keyed by §8.2 member key.
 *
 * @param {object | null} splitExpense
 * @returns {Map<string, number>}
 */
function groupNetsByMemberKey(splitExpense) {
  const nets = new Map();
  if (!splitExpense) {
    return nets;
  }
  const add = (userId, contactId, value) => {
    const key = toMemberKey({ userId, invitedContactId: contactId });
    if (key) {
      nets.set(key, (nets.get(key) ?? 0) + value);
    }
  };
  resolveSplitExpensePayers(splitExpense).forEach((payer) =>
    add(payer.payerUserId, payer.payerContactId, Number(payer.amount || 0)),
  );
  (splitExpense.participants ?? []).forEach((participant) =>
    add(participant.participantUserId, participant.participantContactId, -Number(participant.amount || 0)),
  );
  return nets;
}

/**
 * How a queued edit (`newSplit`) or delete (`newSplit = null`) moves the
 * balances this device shows (§4.2/§4.3, as estimates — §7.7):
 *
 * - `memberDeltas`: group mode, `Δ(i) = net_new(i) − net_old(i)` per member key;
 * - `groupDelta`: the viewer's own `Δ`;
 * - `pairDeltas`: individual mode, per pair row the viewer is party to, the
 *   change in `findPairEffect` (caller-oriented, the sign `balance` uses).
 *
 * @param {object} oldSplit
 * @param {object | null} newSplit
 * @param {string} currentUserId
 * @returns {{ groupDelta: number, memberDeltas: Record<string, number>,
 *   pairDeltas: Array<{ individualBalanceId: string, delta: number }> }}
 */
export function computeSplitBalanceDeltas(oldSplit, newSplit, currentUserId) {
  if (oldSplit.splitMode === 'group') {
    const oldNets = groupNetsByMemberKey(oldSplit);
    const newNets = groupNetsByMemberKey(newSplit);
    const memberDeltas = {};
    new Set([...oldNets.keys(), ...newNets.keys()]).forEach((key) => {
      const delta = roundToPaise((newNets.get(key) ?? 0) - (oldNets.get(key) ?? 0));
      if (delta !== 0) {
        memberDeltas[key] = delta;
      }
    });
    const viewerKey = toMemberKey({ userId: currentUserId });
    return { groupDelta: memberDeltas[viewerKey] ?? 0, memberDeltas, pairDeltas: [] };
  }

  const pairDeltas = resolveSplitExpenseCounterparts(oldSplit)
    .filter((counterpart) => counterpart.individualBalanceId)
    .filter(
      (counterpart) =>
        oldSplit.createdByUserId === currentUserId ||
        counterpart.counterpartUserId === currentUserId ||
        !oldSplit.createdByUserId,
    )
    .map((counterpart) => {
      const before = findPairEffect(oldSplit, counterpart.individualBalanceId, currentUserId);
      const after = newSplit
        ? findPairEffect(newSplit, counterpart.individualBalanceId, currentUserId)
        : 0;
      return { individualBalanceId: counterpart.individualBalanceId, delta: roundToPaise(after - before) };
    })
    .filter((entry) => entry.delta !== 0);
  return { groupDelta: 0, memberDeltas: {}, pairDeltas };
}

/**
 * §5.2's field-level follow, for the creator's linked personal transaction —
 * shared by the overlay and anything else that previews an edit. Each field
 * follows the split only while it still equals the split's old value; a share
 * that drops to zero removes the row; a `'both'` payment mode never follows
 * the amount. `newSplit = null` is a delete (§5.3): a live row is removed.
 *
 * @param {object} transaction The cached TransactionResponse.
 * @param {object} oldSplit
 * @param {object | null} newSplit
 * @returns {{ transaction: object, isRemoved: boolean }}
 */
export function applySplitEditToPersonalTransaction(transaction, oldSplit, newSplit) {
  if (!newSplit) {
    return { transaction, isRemoved: true };
  }
  const creatorUserId = oldSplit.createdByUserId;
  const shareOf = (split) =>
    (split.participants ?? [])
      .filter((participant) => creatorUserId && participant.participantUserId === creatorUserId)
      .reduce((sum, participant) => sum + Number(participant.amount || 0), 0);

  const next = { ...transaction };
  if (transaction.title === oldSplit.title) {
    next.title = newSplit.title;
  }
  if (transaction.txnDate === oldSplit.splitDate) {
    next.txnDate = newSplit.splitDate;
  }
  if (transaction.categoryId === oldSplit.categoryId) {
    next.categoryId = newSplit.categoryId;
    next.categoryName = newSplit.categoryName;
    next.parentCategoryName = newSplit.parentCategoryName ?? null;
    next.categoryIconName = newSplit.categoryIconName ?? null;
    next.categoryGlyph = newSplit.categoryGlyph;
    next.categoryTone = newSplit.categoryTone ?? transaction.categoryTone;
    next.reassignedFromCategoryId = null;
  }
  const amountFollows =
    Math.round(Number(transaction.amount) * 100) === Math.round(shareOf(oldSplit) * 100) &&
    transaction.paymentMode !== 'both';
  if (amountFollows) {
    const newShare = roundToPaise(shareOf(newSplit));
    if (newShare === 0) {
      return { transaction: next, isRemoved: true };
    }
    next.amount = newShare;
  }
  return { transaction: next, isRemoved: false };
}
