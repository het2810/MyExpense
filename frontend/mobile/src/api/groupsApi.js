import { authorizedRequest } from './apiClient';
import { GROUP_PATHS } from './config';

/**
 * Groups (Domain 6, sub-step 2) — one thin function per wired endpoint, the
 * same shape every other module in this folder follows (docs/decisions/
 * 0016-frontend-api-integration.md §3.4). Contract:
 * docs/api/api-overview.md §7.1–§7.3.
 *
 * Every call goes through `apiClient.authorizedRequest` (ADR 0016 §6.2/§6.3).
 * These functions return the parsed response and throw `ApiError` on failure;
 * they hold no state and touch no store.
 *
 * Layer rule (ADR 0016 §1): may import `apiClient` and `config`. Never React,
 * never a store.
 *
 * ---
 * **MEMBERSHIP-GATED, NOT OWNER-SCOPED — AND THAT MEANS `404`, NEVER `403`.**
 *
 * A group is legitimately shared, so authorization is "is the caller a member
 * of this group" rather than "does `created_by_user_id` match" (§7's note,
 * security-architecture.md §2). A non-member gets `404 GROUP_NOT_FOUND`, byte
 * identical to a group that never existed, and `GET /groups` returns `[]` for
 * them rather than an error (`backend/README.md` §15.3(b)). **No copy anywhere
 * above this layer may present that `404` as a permissions problem** — the
 * whole point of the convention is that it does not confirm the group exists.
 *
 * ---
 * **`lastActivity` IS NEVER POPULATED. DO NOT BUILD ON IT.**
 *
 * `GroupResponse.lastActivity` is in the contract (§7.1) and **nothing on the
 * backend ever writes `groups.last_activity`** — it is explicitly the one item
 * of `V10`'s expectation that the shared-ledger sub-step does not discharge,
 * because the frontend's own format (`'Settled up • Today'`, ADR 0009 §6) is a
 * client-side relative date frozen into a column shared by readers in different
 * timezones on different days (`backend/README.md` §16.6 assumption 20). It
 * arrives `null` on every row, so every consumer treats it as optional and
 * composes its subtitle from something real.
 */

/**
 * `GET /api/v1/groups` -> `200 GroupResponse[]` (api-overview.md §7.1):
 * `{ id, name, createdByUserId, lastActivity, members[], yourBalance,
 *    createdAt, updatedAt }`.
 *
 * Returns only the groups the caller is a member of, not every group.
 * **Not paginated** — §7.1 defines no `PageResponse` wrapper.
 *
 * Three fields are worth knowing at the call site:
 *
 * - **`members[]` is `{ userId, invitedContactId, name, role }`, exactly one of
 *   the two ids set per entry**, and which one is the *server's* decision, never
 *   the client's: a contact that is linked to a real account joins as that
 *   account (`userId`), an unlinked one joins as a contact placeholder
 *   (`invitedContactId`). That asymmetry is the shared ledger working
 *   (`backend/README.md` §15.3), and it is the identity vocabulary
 *   `POST /split-expenses` and `POST /splits/settle` both require for this
 *   group (§16.6 assumption 6). **The creator is always a member**, so
 *   `members` already includes the caller — a member count is `members.length`,
 *   never `members.length + 1`.
 * - **`members[].name` is resolved at read time**, from the linked user's
 *   `firstName + lastName` or the contact's `name`. Nothing is snapshotted, so a
 *   rename shows up here immediately — deliberately unlike
 *   `SplitExpenseResponse.participants[].name`, which is frozen. There is no
 *   `initials` field on a member (unlike `ContactResponse`), so a caller that
 *   needs one derives it from `name`.
 * - **`yourBalance` is a single number, viewer-relative**, built from the
 *   caller's own `group_member_balances` row (§7.1; the `yourBalances[]` array
 *   that briefly existed on 2026-10-02 was reverted the same day). Positive =
 *   you are owed, negative = you owe. **It is shared state**: another member's
 *   split or settlement moves it with no action on this device, which is why it
 *   is re-read after a write rather than adjusted locally (ADR 0023 §1, its
 *   Frontend follow-up).
 *
 * There is deliberately **no per-member balance breakdown** (§7.1, ADR 0009 §5)
 * even though the backend has the rows. Exposing it is a separate decision that
 * has not been made, so nothing here can show "Rahul owes you ₹200" — and, for
 * a settlement, nothing here can compute the counterpart's side of the
 * two-sided bound either (see splitsApi.js's `settleUp`).
 *
 * @returns {Promise<object[]>} GroupResponse[]
 */
export function listGroups() {
  return authorizedRequest(GROUP_PATHS.list);
}

/**
 * `GET /api/v1/groups/{id}` -> `200 GroupResponse` (api-overview.md §7.3),
 * membership-gated. Same shape as one list entry.
 *
 * **The one caller is the post-write re-read.** A group balance is shared, so
 * after a settlement the held `yourBalance` is not merely stale by this
 * device's own write — it may also have moved because somebody else acted. One
 * group read answers both, and is cheaper than re-listing every group.
 *
 * Errors: `404 GROUP_NOT_FOUND` — the group does not exist **or** the caller is
 * not a member, deliberately indistinguishable (§7.3, §2's convention).
 *
 * @param {string} id
 * @returns {Promise<object>} GroupResponse
 */
export function getGroup(id) {
  return authorizedRequest(GROUP_PATHS.byId(id));
}

/**
 * `POST /api/v1/groups` -> `201 GroupResponse` (api-overview.md §7.2).
 *
 * `memberContactIds` are **the caller's own contact ids** (§6.1), never user
 * ids: the server resolves each one, and a contact that happens to be linked
 * joins as the real account instead. The creator is added automatically and
 * must not be listed.
 *
 * Three server behaviours that shape the copy above this layer:
 *
 * 1. **Duplicates are de-duplicated, not rejected** — §7.2's error table has no
 *    `409`, so the same contact twice, two contacts linked to one account, and a
 *    contact linked to the caller themselves all simply collapse
 *    (`backend/README.md` §15.3(d)).
 * 2. **Each unlinked member with a phone triggers the same invite** §6.2 fires,
 *    subject to the identical limits; a member mid-cooldown is added with no
 *    invite rather than failing the create (§7.2). **The response carries no
 *    `inviteStatus`**, so this screen cannot — and must not — say anything about
 *    whether an invite happened here.
 * 3. **It is one transaction**: a bad `memberContactIds` entry creates no group
 *    at all (`backend/README.md` §15.3(c)).
 *
 * Errors: `400 VALIDATION_ERROR`, `404 CONTACT_NOT_FOUND` (an id that is not one
 * of the caller's own contacts — a `404` here, and a `400` with the same code on
 * §7.4, which is the contract's own asymmetry rather than a mistake).
 *
 * @param {{ name: string, memberContactIds?: string[] }} group
 * @returns {Promise<object>} GroupResponse (`yourBalance: 0.00`)
 */
export function createGroup({ name, memberContactIds = [] }) {
  return authorizedRequest(GROUP_PATHS.create, {
    method: 'POST',
    body: { name, memberContactIds },
  });
}
