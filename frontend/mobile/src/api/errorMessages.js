import { isApiError } from './apiError';

/**
 * Error code -> user-facing copy, and `fieldErrors[]` -> the per-field map the
 * auth screens already render — docs/decisions/0016-frontend-api-integration.md
 * §4.2/§4.3.
 *
 * The backend's own `message` is deliberately NOT rendered for unmapped
 * codes. security-architecture.md §8 guarantees it is safe to show, but
 * "safe" is not "written for this screen", and depending on server copy for
 * client UX makes it untestable and unlocalizable.
 *
 * Layer rule (ADR 0016 §1): may import `apiError` only.
 */

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';

const MESSAGES = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  // Matches security-architecture.md §5's generic-messaging requirement
  // deliberately: no remaining time, no attempt count, no timing oracle. Do
  // not "helpfully" add a countdown here.
  ACCOUNT_LOCKED: 'Too many failed attempts. Please try again later.',
  EMAIL_ALREADY_EXISTS: 'An account already exists for this email address.',
  VALIDATION_ERROR: 'Please check the highlighted fields.',
  RATE_LIMIT_EXCEEDED: 'Too many attempts. Please wait a moment and try again.',
  INVALID_REFRESH_TOKEN: SESSION_EXPIRED_MESSAGE,
  REFRESH_TOKEN_REUSE_DETECTED: SESSION_EXPIRED_MESSAGE,
  UNAUTHORIZED: SESSION_EXPIRED_MESSAGE,
  INVALID_OR_EXPIRED_TOKEN: 'This link is no longer valid. Please request a new one.',
  // Categories (api-overview.md §3.2–§3.5). The duplicate-name code is
  // unchanged by docs/decisions/0019-subcategories-one-optional-level.md §3 —
  // only its meaning widened, from "unique for this user" to "unique for this
  // user among these siblings" — so this one entry covers both levels and no
  // mapping had to change. The copy stays level-neutral for that reason.
  CATEGORY_NAME_ALREADY_EXISTS: 'A category with that name already exists here.',
  // The two codes added with subcategories (ADR 0019 §7). Both are reachable
  // only on a create-subcategory request, and both say the *parent* is
  // unusable rather than anything about the name the user typed — which is why
  // they read differently from the duplicate-name copy above. Reloading the
  // list is the recovery action for the first; the second cannot be retried at
  // all, because the app offers no third level to put the row in.
  PARENT_CATEGORY_NOT_FOUND:
    'That parent category is no longer available. Reload your categories and try again.',
  SUBCATEGORY_DEPTH_EXCEEDED: 'Subcategories can only go one level deep.',
  // `400`, from both §3.3 (a `name` change) and §3.4 (a delete) on the one
  // protected row per account — deliberately one code for one condition
  // (docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md
  // §2.1). **A backstop, not the mechanism:** Manage Categories reads
  // `isProtected` and renders neither affordance, so a user should never see
  // this. It is mapped anyway because a stale tree held across a reload could
  // still produce the request, and "something went wrong" would be a lie about
  // a rule the app knows.
  //
  // The copy says what the row is FOR rather than naming it. Nothing in this
  // app resolves a category by the name `Misc` (§3.1 — a user may own a
  // separate category called `misc`), and copy that named it would invite the
  // next reader to match on it.
  CATEGORY_PROTECTED:
    'This category holds transactions from categories you delete, so it cannot be renamed or deleted.',
  // Transactions (api-overview.md §4.2–§4.5).
  //
  // `TRANSACTION_NOT_FOUND` is a 404 on a §4.5 soft-deleted row as much as on
  // one that never existed — the two are deliberately indistinguishable
  // (§2's owner-scoped convention), so the copy names the likely cause without
  // claiming it as fact. The recovery action is structural rather than textual:
  // the store drops the row and the screen holding it goes back.
  TRANSACTION_NOT_FOUND: 'That transaction no longer exists — it may have been deleted.',
  // The one error in this domain whose whole point is that it IS retryable
  // (§4.4, security-architecture.md §9): the version sent was stale. The store
  // re-reads the row before this copy is shown, so "review and save again" is
  // an instruction the user can actually follow — and the message says what
  // happened rather than just that something did. Kept distinct from
  // RECEIPT_ALREADY_ATTACHED, the other 409 on that endpoint, precisely
  // because that one must NOT be retried.
  VERSION_CONFLICT:
    'This transaction changed somewhere else. We reloaded it — check your changes and save again.',
  // A 403, and **expected behaviour this phase rather than a defect**: every
  // `scope: 'group'` write answers this until Domain 6 (Groups) exists, since
  // there is no membership to establish (§4.2's error table). The copy is
  // therefore written to be true in both worlds — now, and later when a real
  // non-member hits it — and it names the one action that works today.
  NOT_GROUP_MEMBER:
    'You can only add expenses to groups you belong to. Save this as a personal expense instead.',
  // §4.2/§4.4: `categoryId` did not resolve to a category owned by the caller
  // — including one that exists but belongs to someone else (a 404, never a
  // 403). Genuinely reachable now that `DELETE /categories/{id}` exists
  // (docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md):
  // a category can be gone between the picker reading it and Save sending it.
  //
  // **One entry, now four endpoints**: §3.3 (rename), §3.4 (delete) and §3.5
  // (the delete pre-flight) answer the same code for the same condition, so it
  // is reused rather than duplicated. The copy stays true in all of them
  // because the condition is identical — the row is gone — and the recovery is
  // the same: the store drops it from the tree, so the list the user is looking
  // at no longer offers it. **On §3.4 this code is never shown at all:** a
  // second delete of an id the user already confirmed is success, not an error
  // (§3.4, and useCategoriesStore.deleteCategory applies it).
  CATEGORY_NOT_FOUND: 'That category is no longer available. Pick another one and try again.',
  // --- The shared ledger: contacts, groups, balances, splits, settlements ---
  // (api-overview.md §6–§10, as corrected by
  // docs/decisions/0023-shared-ledger-contract-corrections.md.)
  //
  // **`404` HERE IS NEVER A PERMISSIONS PROBLEM, AND NO COPY MAY IMPLY ONE.**
  // §6 is owner-scoped and §7–§10 are membership-gated, and both conventions
  // answer "it does not exist", "it is not yours" and "you are not a member"
  // with the *same* `404` on purpose — a `403` would confirm the resource exists
  // to someone who should not know (§2's convention,
  // security-architecture.md §2). Copy that said "you don't have access to that
  // group" would leak exactly what the status code is protecting, and would be
  // wrong half the time it appeared. Every message below therefore names the
  // *consequence* ("no longer available") and a recovery, never a cause.
  //
  // `404 CONTACT_NOT_FOUND` — a contact id that is not one of the caller's own,
  // from §7.2's `memberContactIds` and from §9.1's
  // `individualCounterpartContactId`. One entry for one condition, reused rather
  // than duplicated, which also covers the `400` the same code carries on §7.4
  // (the contract's own asymmetry, `V10`'s mapping table). §9.1's error table
  // omits it although the endpoint resolves a contact — the Backend Engineer
  // flagged that rather than inventing a code (`backend/README.md` §16.6
  // assumption 3), and it is mapped here because the condition is real
  // regardless of which table lists it.
  CONTACT_NOT_FOUND: 'That contact is no longer available. Reload your contacts and try again.',
  // `404 GROUP_NOT_FOUND` — §7.3, §9.1, §9.3 and §10.1. It covers three
  // conditions that are deliberately indistinguishable: the group is gone, the
  // caller is not a member, or — on a group settlement — **the counterpart they
  // picked is not a member** (ADR 0023 item 6: `404`, never `403`, and never a
  // message that tells them which). The copy has to be true for all three, so it
  // points at the one recovery that works for all three: reload the Split tab,
  // where the group and its member list are both re-read.
  GROUP_NOT_FOUND:
    'That group is no longer available. Reload the Split tab and try again.',
  // `409 ALREADY_A_MEMBER` — §7.4 only. **Mapped ahead of its one producer:**
  // this app sets membership exclusively at creation time (§7.2's
  // `memberContactIds`), which de-duplicates rather than erroring, so there is
  // no screen that can currently raise this. It is one affordance away (an "add
  // member" row on a group's Members tab), the condition is unambiguous, and the
  // generic fallback would otherwise hide a rule the app already understands.
  // Contrast the two receipt codes above, which stay unmapped because their copy
  // cannot be written honestly until the flow that produces them exists.
  ALREADY_A_MEMBER: 'They are already in this group.',
  // Offline write contract — api-overview.md §15.5, copy from
  // docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.9.
  // Shown on the Sync Status screen against a failed or superseded queued op.
  WRITE_SUPERSEDED: 'A newer change was kept instead of this one.',
  ID_CONFLICT: "This item couldn't be saved. Discard it and try again.",
  IDEMPOTENCY_KEY_REUSED: "This change couldn't be synced. Discard it and try again.",
  SETTLEMENT_DIRECTION_CHANGED:
    'The balance changed direction since you recorded this. Check the balance and settle again.',
  CHANGE_LOG_ENTRY_NOT_FOUND: 'This change could not be found.',
  // `400 NO_PHONE_ON_CONTACT` — §6.3 (resend invite) only, and mapped on the
  // same terms as `ALREADY_A_MEMBER`: there is no resend affordance yet, so
  // nothing can reach it. Note it is a `400` and not a `404` on purpose — the
  // contact exists and belongs to the caller; it simply has no number to send
  // to (`backend/README.md` §15.2).
  NO_PHONE_ON_CONTACT: 'This contact has no phone number saved, so there is nobody to invite.',
  // `404 INDIVIDUAL_BALANCE_NOT_FOUND` — §9.1, §9.3 and §10.1. A pairwise
  // balance row that does not exist, or that the caller is not a party to.
  // **Genuinely reachable even from a correct screen**, because a pair balance
  // is shared: the row this device is holding is one the other party can act on
  // too (ADR 0023 §1.1).
  INDIVIDUAL_BALANCE_NOT_FOUND:
    'That shared balance is no longer available. Reload the Split tab and try again.',
  // `404 SPLIT_EXPENSE_NOT_FOUND` — §9.2 (Split Expense Detail's refresh) and
  // the edit/delete endpoints of docs/decisions/
  // 0028-split-expense-edit-delete-feeds-and-balance-copy.md §6.3. On a queued
  // DELETE it never reaches a screen: the engine treats it as already gone.
  SPLIT_EXPENSE_NOT_FOUND: 'That split expense no longer exists.',
  // `403 SPLIT_EXPENSE_CREATOR_ONLY` — ADR 0028 §2.1/§11.7: an individual
  // split edited or deleted by a counterpart rather than its creator.
  SPLIT_EXPENSE_CREATOR_ONLY: 'Only the person who added this expense can edit or delete it.',
  // `400 AMOUNT_EXCEEDS_BALANCE` (§10.1, docs/decisions/
  // 0017-per-currency-balances-and-partial-settlement.md §4) — **a normal,
  // reachable outcome, not a client bug.** Partial settlement is legal; an
  // over-amount is rejected, never clamped and never allowed to flip a balance
  // into a reverse debt.
  //
  // The copy states the real bound rather than just refusing, and the real bound
  // is **two-sided for a group**: `min(|what you owe|, |what they are owed|)`
  // (ADR 0023 §4.3). This client cannot compute it — §7.1 deliberately exposes
  // no per-member breakdown, so the counterpart's position is unknown here —
  // which is precisely why the limit has to be *described* instead of shown as a
  // number. The second sentence is the other half: because the balance is
  // shared, a perfectly correct amount can be refused simply because the other
  // party acted first, and the store re-reads the balance before this message is
  // shown so that "check the amount" is an instruction the user can act on.
  AMOUNT_EXCEEDS_BALANCE:
    'A settlement can only go up to the smaller of the two sides — what you owe and what they are owed. We reloaded the balance; check the amount and try again.',
  // --- Notifications (api-overview.md §12.2) ---
  //
  // `404 NOTIFICATION_NOT_FOUND` — the only error code §11 or §12 defines at
  // all. It is the answer for an id that never existed **and** for a
  // notification that is not the caller's, byte-identical in both cases on
  // purpose: a `403` would confirm the row exists to someone who should not
  // know (`backend/README.md` §17.4(c), §2's owner-scoped convention). So this
  // copy names the *consequence* and **never implies a permissions problem** —
  // "you don't have access to that notification" would leak exactly what the
  // status code is protecting, and would be wrong half the time it appeared.
  //
  // It is genuinely reachable from a correct screen: a held list is a snapshot,
  // and the row behind a tap can be gone by the time the `PATCH` lands. The
  // recovery is structural rather than textual — the store drops the row, so
  // the list stops offering it — which is why the copy only has to explain why
  // a row vanished under the user's finger.
  //
  // **There is no error code here for §11.1 or §12.1**, and none is missing:
  // an unknown, other-user or deleted id in any of §11.1's four `related_*`
  // filters is an **empty page, never a 404** (`backend/README.md` §17.2), and
  // §12.3 has no failure of its own at all — marking all read on an account
  // with nothing unread is the identical `200` (§17.4(f)).
  NOTIFICATION_NOT_FOUND: 'That notification is no longer available.',
  // `RECEIPT_UPLOAD_UNAVAILABLE` (503) and `RECEIPT_ALREADY_ATTACHED` (409)
  // are deliberately NOT mapped. Both exist in the contract (§4.2 rules 1/4),
  // and both are unreachable from this app: there is no signing-endpoint
  // wrapper, and the client can only ever CLEAR `receiptPublicId`, never send
  // one — so no request it can build can produce either code. They land with
  // the receipt-upload pass that makes them possible, where the copy can be
  // written against real behaviour instead of guessed at; until then they get
  // the generic fallback and a dev-only log, which is exactly what that
  // fallback is for (ADR 0016 §4.3). See transactionsApi.js's module note.
  INTERNAL_ERROR: 'Something went wrong on our end. Please try again.',
  NETWORK_UNAVAILABLE: 'You appear to be offline. Check your connection and try again.',
  TIMEOUT: 'That took longer than expected. Please try again.',
  // Synthetic, from httpClient: an empty/HTML/truncated body where JSON was
  // expected. The user gets the generic copy; the code exists so this is
  // distinguishable in a dev log.
  INVALID_RESPONSE: GENERIC_MESSAGE,
  REQUEST_CANCELLED: GENERIC_MESSAGE,
};

/**
 * `400 VALIDATION_ERROR` refinements, keyed by the server's **exact** message
 * (docs/decisions/0026-multi-contact-individual-splits.md §5.1 C1/C4/C6 —
 * the ADR fixes the message text, which is what makes it a contract to match
 * on). The server's text is never rendered: each one maps to copy written for
 * the Split Expense screen. Any other `VALIDATION_ERROR` keeps the generic
 * `MESSAGES.VALIDATION_ERROR` copy.
 *
 * C1 and C4 can only come from a request this client built wrongly (the
 * builder never sends both counterpart forms, nor the array in group mode), so
 * their copy is a review-and-retry. C6 is the one a user can reach: two
 * address-book entries linked to the same account.
 */
const SPLIT_COUNTERPART_RETRY_MESSAGE =
  'Something went wrong with the people in this split. Review them and try again.';

const VALIDATION_MESSAGES = {
  'Provide either individualCounterpartContactId or individualCounterpartContactIds, not both.':
    SPLIT_COUNTERPART_RETRY_MESSAGE,
  "individualCounterpartContactIds must be omitted when splitMode is 'group'.":
    SPLIT_COUNTERPART_RETRY_MESSAGE,
  'The same person is listed more than once in individualCounterpartContactIds.':
    'The same person is in this split twice — they may be saved as two contacts. Remove one and try again.',
  // ADR 0028 §6.2 U2 / §11.7.
  'Only the person who added this expense can change its category.':
    'Only the person who added this expense can change its category.',
};

/**
 * ADR 0028 §6.2 U1's message is templated (`{fieldName} can't be changed after
 * a split expense is created. Delete it and add it again.`), so it is matched
 * by its fixed suffix rather than by the whole string (§11.7).
 */
const FIELD_NOT_EDITABLE_SUFFIX =
  "can't be changed after a split expense is created. Delete it and add it again.";
const FIELD_NOT_EDITABLE_MESSAGE = "This can't be changed. Delete the expense and add it again.";

/**
 * @param {unknown} error
 * @returns {string} Copy safe to display to the user. Never a stack trace,
 *   never a raw server message (constitution §22).
 */
export function getErrorMessage(error) {
  if (!isApiError(error)) {
    return GENERIC_MESSAGE;
  }
  if (
    error.code === 'VALIDATION_ERROR' &&
    Object.prototype.hasOwnProperty.call(VALIDATION_MESSAGES, error.message)
  ) {
    return VALIDATION_MESSAGES[error.message];
  }
  if (
    error.code === 'VALIDATION_ERROR' &&
    typeof error.message === 'string' &&
    error.message.endsWith(FIELD_NOT_EDITABLE_SUFFIX)
  ) {
    return FIELD_NOT_EDITABLE_MESSAGE;
  }
  return getErrorMessageForCode(error.code);
}

/**
 * The same copy, for the one case where a store knows the *condition* without
 * holding an `ApiError` for it: a client-side pre-check that reaches the
 * identical conclusion the server would have, so re-sending the request would
 * only buy the same answer a round trip later (`useCategories`'s
 * "that parent category is no longer available" check set the precedent).
 *
 * Mapped codes only — this is not a channel for inventing new copy, and an
 * unknown code falls through to the same generic fallback and the same
 * dev-only log as above.
 *
 * @param {string} code A documented `ApiErrorResponse.error` value.
 * @returns {string}
 */
export function getErrorMessageForCode(code) {
  const mapped = MESSAGES[code];
  if (mapped) {
    return mapped;
  }
  // Unmapped codes get the generic fallback and are logged in dev builds
  // only, so a missing mapping surfaces during development rather than as a
  // mystery message in front of a user (ADR 0016 §4.3).
  if (__DEV__) {
    console.log(`[api] unmapped error code: ${code}`);
  }
  return GENERIC_MESSAGE;
}

/**
 * True when a failure means the session is already gone, so the caller should
 * NOT show a message of its own.
 *
 * By the time a 401 escapes `apiClient.authorizedRequest`, `authSession` has
 * already wiped credentials and notified the auth store (ADR 0016 §6.3/§6.5):
 * the refresh was attempted, the one retry was spent, and `isAuthenticated`
 * is false — RootNavigator is on its way to AuthStack. Rendering "your
 * session has expired" on a screen that is being torn down adds nothing, and
 * writing it into a per-account store leaves a stale message that can flash
 * on the next sign-in before the store's own loader clears it.
 *
 * Deliberately `status === 401` and not a code list: any 401 reaching a
 * caller through `authorizedRequest` is terminal by construction, including
 * the synthetic "no refresh token available" one.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isSessionTerminalError(error) {
  return isApiError(error) && error.status === 401;
}

/**
 * Splits an ApiError into the two slots the screens render: per-field errors
 * and one form-level error.
 *
 * `fieldErrors` maps onto the screens' existing `errors` object directly —
 * `[{field, message}]` -> `{ [field]: message }` — because design-system.md §4
 * pinned the form field names to authentication-api.md's DTO field names for
 * exactly this eventuality. First error per field wins if a field repeats.
 *
 * A `fieldErrors` entry for a field with no input on this screen (e.g.
 * `refreshToken`, or a field added to a DTO later) falls through into the
 * form-level slot rather than being silently dropped: a validation error the
 * user can neither see nor act on is worse than an ugly one (ADR 0016 §4.2).
 *
 * @param {unknown} error
 * @param {string[]} renderedFields Field names this screen actually renders.
 * @returns {{ fieldErrors: Object<string, string>, formError: string | null }}
 */
export function toFormErrors(error, renderedFields = []) {
  if (!isApiError(error)) {
    return { fieldErrors: {}, formError: GENERIC_MESSAGE };
  }

  const fieldErrors = {};
  const unmatchedMessages = [];

  error.fieldErrors.forEach((entry) => {
    if (!entry || typeof entry.field !== 'string') {
      return;
    }
    const message = typeof entry.message === 'string' ? entry.message : null;
    if (!message) {
      return;
    }
    if (renderedFields.includes(entry.field) && !fieldErrors[entry.field]) {
      fieldErrors[entry.field] = message;
    } else if (!renderedFields.includes(entry.field)) {
      unmatchedMessages.push(message);
    }
  });

  if (unmatchedMessages.length > 0) {
    return { fieldErrors, formError: unmatchedMessages.join('\n') };
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, formError: null };
  }

  return { fieldErrors, formError: getErrorMessage(error) };
}
