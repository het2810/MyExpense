import { getInitialsFromName } from './initials';

/**
 * The bridge between **one local participant key** and the API's **two-column
 * participant identity** — docs/api/api-overview.md §7.1/§9.1/§9.3,
 * docs/decisions/0005-split-add-expense-flow.md §3.3.
 *
 * ---
 * **WHY A LOCAL KEY STILL EXISTS AT ALL.**
 *
 * Every screen in the split flow addresses a participant by a single opaque
 * string: `splitConfig.paidById`, `checkedMap[participantId]`,
 * `participantAmounts[].participantId`, and the four `*TextMap`s in
 * `splitCalculations.js` are all keyed by it. The API instead identifies a
 * participant by **exactly one of `participantUserId`/`participantContactId`**,
 * because a group member may be a registered account *or* an unregistered
 * contact placeholder, and which column is filled is the server's decision
 * (api-overview.md §7.1, `backend/README.md` §15.3).
 *
 * Rather than rewrite five screens and every split-method calculation to carry
 * a two-field identity, each participant object carries **both**: the local
 * `participantId` the UI keys by, and the API identity the request needs. The
 * keys are namespaced (`self`, `user:<uuid>`, `contact:<uuid>`) so one string
 * can never be mistaken for the other kind, and `'self'` keeps the exact
 * meaning it already had everywhere (ADR 0005 §6.1's consumption-share rule,
 * the "Add this to my expenses" checkbox, `getSplitSummaryText`'s "You paid").
 *
 * Consequence worth stating: `HowWasThisSplitScreen` and `AdjustSplitScreen`
 * needed **no change at all** — they pass `participants` through, return
 * `{ participantId, name, amount }` triples, and never look at an identity.
 *
 * ---
 * **GROUP MODE IS STRICT; INDIVIDUAL MODE IS FORGIVING.**
 *
 * A group split's participants must be named the way `group_members` stores
 * them, or the server answers `400` — a participant who is not a member of the
 * named group is rejected rather than silently given a balance row
 * (`backend/README.md` §16.6 assumptions 6 and 7). Building them from
 * `GroupResponse.members[]` makes that correct by construction.
 *
 * An individual split's counterparts are named by **contact** id
 * (`individualCounterpartContactId`, or `individualCounterpartContactIds` for
 * 2+ — docs/decisions/0026-multi-contact-individual-splits.md), and the server
 * normalises a linked
 * contact to its account itself, mirroring §7.2's "a linked contact joins as the
 * real account" (§16.6 assumption 6). So this module never resolves
 * `linkedUserId` on its own — doing so would be a second implementation of the
 * pair-resolution rule ADR 0023 §1.3 insists lives in exactly one place, and
 * that place is the server.
 */

/** The local key for the signed-in user, unchanged from ADR 0005 §3.3. */
export const SELF_PARTICIPANT_ID = 'self';

/**
 * @param {string} userId
 * @returns {string} e.g. 'user:8f1c…'
 */
function userParticipantId(userId) {
  return `user:${userId}`;
}

/**
 * @param {string} contactId
 * @returns {string} e.g. 'contact:8f1c…'
 */
function contactParticipantId(contactId) {
  return `contact:${contactId}`;
}

/**
 * The roster for an Individual split: the signed-in user first (ADR 0005
 * §3.3's "always you first"), then one participant per selected contact, in
 * selection order (docs/decisions/0026-multi-contact-individual-splits.md
 * §8.2). One contact gives exactly the two-participant roster this function
 * always built.
 *
 * Each counterpart is identified by `participantContactId` **even when the
 * contact is linked to a real account** — see this module's note on why the
 * normalisation is the server's job.
 *
 * @param {{ currentUserId: string, fullName: string, initials: string,
 *   contacts: object[] }} args `contacts` are `ContactResponse`s (§6.1), in
 *   selection order.
 * @returns {object[] | null} null when no contact is selected yet.
 */
export function buildIndividualParticipants({ currentUserId, fullName, initials, contacts }) {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return null;
  }
  return [
    {
      participantId: SELF_PARTICIPANT_ID,
      participantUserId: currentUserId || null,
      participantContactId: null,
      name: fullName,
      initials,
    },
    ...contacts.map((contact) => ({
      participantId: contactParticipantId(contact.id),
      participantUserId: null,
      participantContactId: contact.id,
      // `ContactResponse.initials` is server-derived and used as-is (§6.1).
      name: contact.name,
      initials: contact.initials ?? getInitialsFromName(contact.name),
    })),
  ];
}

/**
 * The roster for a Group split: the signed-in user first, then every other
 * member of the group in the server's own order.
 *
 * **The caller is already in `members[]`** — the creator is always a member
 * (§7.1) — so their entry is replaced by `'self'` rather than appended
 * alongside, which would put the same person in the split twice and fail the
 * server's duplicate-participant check.
 *
 * A member has a server-resolved `name` and no `initials` field, so initials are
 * derived (see `utils/initials.js`).
 *
 * @param {{ currentUserId: string, fullName: string, initials: string,
 *   group: object }} args `group` is a `GroupResponse` (§7.1).
 * @returns {object[] | null} null when there is no group selected yet.
 */
export function buildGroupParticipants({ currentUserId, fullName, initials, group }) {
  if (!group) {
    return null;
  }

  const members = Array.isArray(group.members) ? group.members : [];
  const others = members
    .filter((member) => !(member.userId && member.userId === currentUserId))
    .map((member) =>
      member.userId
        ? {
            participantId: userParticipantId(member.userId),
            participantUserId: member.userId,
            participantContactId: null,
            name: member.name,
            initials: getInitialsFromName(member.name),
          }
        : {
            participantId: contactParticipantId(member.invitedContactId),
            participantUserId: null,
            participantContactId: member.invitedContactId,
            name: member.name,
            initials: getInitialsFromName(member.name),
          },
    );

  return [
    {
      participantId: SELF_PARTICIPANT_ID,
      participantUserId: currentUserId || null,
      participantContactId: null,
      name: fullName,
      initials,
    },
    ...others,
  ];
}

/**
 * The API identity behind a local participant key, for a request body.
 *
 * Throws rather than guessing: a participant the roster does not know, or one
 * with neither id resolved (the signed-in user's id is still unknown), would
 * otherwise be sent as `{ participantUserId: null, participantContactId: null }`
 * and rejected by `chk_split_expense_participants_user_xor_contact` as an
 * opaque `400`. Failing here names the real cause in a dev log, and the store's
 * own catch turns it into the generic user-facing copy (constitution §22).
 *
 * @param {object[]} participants The roster from one of the builders above.
 * @param {string} participantId
 * @returns {{ participantUserId: string | null, participantContactId: string | null }}
 */
export function resolveParticipantIdentity(participants, participantId) {
  const match = (participants ?? []).find(
    (participant) => participant.participantId === participantId,
  );
  if (!match) {
    throw new Error(`No participant in this split matches "${participantId}".`);
  }
  if (!match.participantUserId && !match.participantContactId) {
    throw new Error('This split has a participant whose account could not be identified.');
  }
  return {
    participantUserId: match.participantUserId ?? null,
    participantContactId: match.participantContactId ?? null,
  };
}

/**
 * The caller's own share of a saved split expense — the entry in §9.3's
 * `participants[]` whose `participantUserId` is the signed-in user's id.
 *
 * **Never `SplitExpenseResponse.amount`.** That is the whole bill; this is what
 * the user consumed, and confusing the two inflates their own spending by the
 * entire group's (ADR 0005 §6.1, `V11` contract item 3, which calls this the
 * single most valuable assertion in the domain).
 *
 * `0` when the caller was not a participant, which is legal: a split can be
 * recorded between two other members of a group the caller belongs to.
 *
 * @param {object} splitExpense A `SplitExpenseResponse` (§9.3).
 * @param {string} currentUserId
 * @returns {number}
 */
export function findCallerShare(splitExpense, currentUserId) {
  if (!currentUserId || !Array.isArray(splitExpense?.participants)) {
    return 0;
  }
  const own = splitExpense.participants.find(
    (participant) => participant.participantUserId === currentUserId,
  );
  return own && Number.isFinite(own.amount) ? own.amount : 0;
}

/**
 * The payer-list joiner — docs/decisions/0025-multiple-payers-per-split-expense.md
 * §6.1, the **one** rule the server's activity sentences and every on-screen
 * payer label share, so a split reads the same in the feed and on screen:
 *
 * - 1 label: `A`
 * - 2 labels: `A and B`
 * - 3 labels: `A, B and C`
 * - 4 or more: `A, B and N others` (N = count − 2)
 *
 * Ordering is the caller's job (ADR 0025 §6.1's "viewer as You first, then
 * response order" for a saved split; roster order for a draft) — this only
 * joins what it is given.
 *
 * @param {string[]} labels
 * @returns {string} '' for an empty list.
 */
export function joinPayerLabels(labels) {
  const list = Array.isArray(labels) ? labels : [];
  if (list.length <= 1) {
    return list[0] ?? '';
  }
  if (list.length === 2) {
    return `${list[0]} and ${list[1]}`;
  }
  if (list.length === 3) {
    return `${list[0]}, ${list[1]} and ${list[2]}`;
  }
  return `${list[0]}, ${list[1]} and ${list.length - 2} others`;
}

/**
 * The payers of a saved split expense, as §9.3's `payers[]` (ADR 0025 §5.2).
 *
 * Defensive fallback for a server that predates ADR 0025 (§8.7): when `payers`
 * is missing or empty, one entry is synthesised from the deprecated
 * `paidByUserId`/`paidByContactId`/`paidByName` and the whole `amount` — which
 * is exactly what a single-payer split means. `useSplitExpensesStore`'s
 * normaliser applies this once at the store boundary; the readers below apply
 * it again so a row that did not come through the store still reads correctly.
 *
 * @param {object} splitExpense A `SplitExpenseResponse` (§9.3).
 * @returns {Array<{ payerUserId: string | null, payerContactId: string | null,
 *   name: string, amount: number }>}
 */
export function resolveSplitExpensePayers(splitExpense) {
  if (Array.isArray(splitExpense?.payers) && splitExpense.payers.length > 0) {
    return splitExpense.payers;
  }
  if (!splitExpense || (!splitExpense.paidByUserId && !splitExpense.paidByContactId)) {
    return [];
  }
  return [
    {
      payerUserId: splitExpense.paidByUserId ?? null,
      payerContactId: splitExpense.paidByContactId ?? null,
      name: splitExpense.paidByName ?? '',
      amount: splitExpense.amount,
    },
  ];
}

/**
 * What the caller actually paid toward a saved split expense — the `amount`
 * of their `payers[]` entry, or `0` (ADR 0025 §4's `paid(i)` for the caller).
 *
 * Never the whole bill unless the caller really was the only payer: crediting
 * the primary payer with everything is the exact bug §8.7 fixes on Split
 * Detail.
 *
 * @param {object} splitExpense A `SplitExpenseResponse` (§9.3).
 * @param {string} currentUserId
 * @returns {number}
 */
export function findCallerPaid(splitExpense, currentUserId) {
  if (!currentUserId) {
    return 0;
  }
  const own = resolveSplitExpensePayers(splitExpense).find(
    (payer) => payer.payerUserId === currentUserId,
  );
  return own && Number.isFinite(own.amount) ? own.amount : 0;
}

/**
 * How a saved split expense's payers read on screen — ADR 0025 §8.7: the
 * caller as `'You'` (first, if they paid), then every other payer in the
 * server's response order, joined by `joinPayerLabels`. One payer gives the
 * same output as before ADR 0025: `'You'` or that payer's name.
 *
 * Names are the server's own (`payers[].name`, resolved server-side for both
 * payer kinds), so nothing is looked up against the contact list here (§9.3,
 * extending ADR 0008 §1.3).
 *
 * @param {object} splitExpense A `SplitExpenseResponse` (§9.3).
 * @param {string} currentUserId
 * @returns {string}
 */
export function describePayer(splitExpense, currentUserId) {
  const payers = resolveSplitExpensePayers(splitExpense);
  if (payers.length === 0) {
    return 'Someone';
  }
  const callerPaid = Boolean(currentUserId) &&
    payers.some((payer) => payer.payerUserId === currentUserId);
  const otherLabels = payers
    .filter((payer) => !(currentUserId && payer.payerUserId === currentUserId))
    .map((payer) => payer.name || 'Someone');
  return joinPayerLabels(callerPaid ? ['You', ...otherLabels] : otherLabels);
}

/**
 * A draft split's multi-payer entries (`splitConfig.payers`, ADR 0025 §8.1)
 * labelled for display, in **roster order** — `'You'` for `'self'`, otherwise
 * the participant's name (§8.6). Used by Split Add Expense's summary chip and
 * Adjust Split's "Paid by" row, so both read the same.
 *
 * @param {Array<{ participantId: string, amount: number }> | null} payers
 * @param {object[]} participants The roster (self first).
 * @returns {Array<{ participantId: string, label: string, amount: number }>}
 */
export function labelDraftPayers(payers, participants) {
  if (!Array.isArray(payers)) {
    return [];
  }
  const roster = participants ?? [];
  const rosterIndex = (participantId) => {
    const index = roster.findIndex((participant) => participant.participantId === participantId);
    return index === -1 ? roster.length : index;
  };
  return [...payers]
    .sort((left, right) => rosterIndex(left.participantId) - rosterIndex(right.participantId))
    .map((payer) => {
      const participant = roster.find((entry) => entry.participantId === payer.participantId);
      return {
        participantId: payer.participantId,
        label:
          payer.participantId === SELF_PARTICIPANT_ID ? 'You' : participant?.name ?? 'Someone',
        amount: payer.amount,
      };
    });
}

/**
 * The pair rows a saved split expense moved, as §9.3's `counterparts[]`
 * (docs/decisions/0026-multi-contact-individual-splits.md §5.2).
 *
 * Defensive fallback for a server that predates ADR 0026 (§8.5): when
 * `counterparts` is missing or empty on an individual split, one entry is
 * synthesised from the deprecated `individualBalanceId`, with
 * `netAmount: null` so readers know to fall back to their pre-ADR arithmetic.
 * A group split has none. Same arrangement as `resolveSplitExpensePayers`:
 * the store's normaliser applies it once, the readers below apply it again.
 *
 * @param {object} splitExpense A `SplitExpenseResponse` (§9.3).
 * @returns {Array<{ individualBalanceId: string, counterpartUserId: string | null,
 *   counterpartContactId: string | null, name: string, netAmount: number | null }>}
 */
export function resolveSplitExpenseCounterparts(splitExpense) {
  if (Array.isArray(splitExpense?.counterparts) && splitExpense.counterparts.length > 0) {
    return splitExpense.counterparts;
  }
  if (splitExpense?.splitMode !== 'individual' || !splitExpense.individualBalanceId) {
    return [];
  }
  return [
    {
      individualBalanceId: splitExpense.individualBalanceId,
      counterpartUserId: null,
      counterpartContactId: null,
      name: '',
      netAmount: null,
    },
  ];
}

/**
 * Whether a saved split expense moved the given pair row — the question
 * `GET /split-expenses?individualBalanceId=` answers server-side (ADR 0026
 * §5.3). Never answered from the deprecated `individualBalanceId` alone, which
 * names only the primary counterpart's pair.
 *
 * @param {object} splitExpense A `SplitExpenseResponse` (§9.3).
 * @param {string | null} individualBalanceId
 * @returns {boolean}
 */
export function splitExpenseMovesPair(splitExpense, individualBalanceId) {
  if (!individualBalanceId) {
    return false;
  }
  return resolveSplitExpenseCounterparts(splitExpense).some(
    (counterpart) => counterpart.individualBalanceId === individualBalanceId,
  );
}

/**
 * The effect of one saved individual split on **one pair row** — what Split
 * Detail shows for an individual-mode row (ADR 0026 §5.2, §8.5). Positive =
 * the viewer is owed; negative = the viewer owes.
 *
 * `counterparts[].netAmount` is relative to the split's creator (positive =
 * the creator owes that counterpart), so:
 * - the viewer IS that counterpart (`counterpartUserId === currentUserId`):
 *   `+netAmount`;
 * - otherwise the viewer is the creator, the only other party to the pair:
 *   `−netAmount`.
 *
 * **Not the viewer's total net.** For the creator of a multi-contact split
 * that total is `−Σ net_c`, spread across several pairs; showing it under one
 * pair is the bug §8.5 fixes. For a one-contact split both readings are equal
 * (ADR 0026 §4.3's proof).
 *
 * Falls back to the pre-ADR formula (`paid − share` for the viewer) when the
 * pair's entry is missing or carries no `netAmount` — a server that predates
 * ADR 0026, where every individual split had exactly one counterpart.
 *
 * @param {object} splitExpense A `SplitExpenseResponse` (§9.3).
 * @param {string} individualBalanceId The pair row being viewed.
 * @param {string} currentUserId
 * @returns {number}
 */
export function findPairEffect(splitExpense, individualBalanceId, currentUserId) {
  const entry = resolveSplitExpenseCounterparts(splitExpense).find(
    (counterpart) => counterpart.individualBalanceId === individualBalanceId,
  );
  if (!entry || !Number.isFinite(entry.netAmount)) {
    return findCallerPaid(splitExpense, currentUserId) - findCallerShare(splitExpense, currentUserId);
  }
  const isViewerTheCounterpart =
    Boolean(currentUserId) && entry.counterpartUserId === currentUserId;
  const effect = isViewerTheCounterpart ? entry.netAmount : -entry.netAmount;
  // Never `-0`: a settled pair reads as plain zero everywhere downstream.
  return effect === 0 ? 0 : effect;
}

/**
 * The "Also with {Q}" line under a multi-contact split's row on one pair's
 * Split Detail (ADR 0026 §8.5): every other counterpart's name, in response
 * order, excluding the pair's own counterpart and the viewer, joined by
 * `joinPayerLabels`.
 *
 * @param {object} splitExpense A `SplitExpenseResponse` (§9.3).
 * @param {string} individualBalanceId The pair row being viewed.
 * @param {string} currentUserId
 * @returns {string | null} null when the split has one counterpart, or nobody
 *   else is left to name.
 */
export function describeOtherCounterparts(splitExpense, individualBalanceId, currentUserId) {
  const counterparts = resolveSplitExpenseCounterparts(splitExpense);
  if (counterparts.length < 2) {
    return null;
  }
  const others = counterparts
    .filter((counterpart) => counterpart.individualBalanceId !== individualBalanceId)
    .filter((counterpart) => !(currentUserId && counterpart.counterpartUserId === currentUserId))
    .map((counterpart) => counterpart.name || 'Someone');
  return others.length > 0 ? `Also with ${joinPayerLabels(others)}` : null;
}
