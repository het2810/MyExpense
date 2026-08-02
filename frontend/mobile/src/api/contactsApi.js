import { authorizedRequest } from './apiClient';
import { CONTACT_PATHS } from './config';

/**
 * Contacts (Domain 6, sub-step 1) — one thin function per wired endpoint, the
 * shape authApi.js established and usersApi.js/categoriesApi.js/
 * transactionsApi.js already follow (docs/decisions/
 * 0016-frontend-api-integration.md §3.4). Contract:
 * docs/api/api-overview.md §6.1/§6.2.
 *
 * Both calls go through `apiClient.authorizedRequest`: §6 is owner-scoped on
 * `contacts.owner_user_id` and requires `Authorization: Bearer <accessToken>`,
 * so `sendRequest` is never used directly and raw `fetch` never appears —
 * going through `authorizedRequest` is what attaches the bearer and gets the
 * single-flight refresh-on-401 (ADR 0016 §6.2/§6.3).
 *
 * These functions return the parsed response and throw `ApiError` on any
 * failure. They hold no state and touch no store.
 *
 * Layer rule (ADR 0016 §1): may import `apiClient` and `config`. Never React,
 * never a store.
 *
 * ---
 * **THE SMS INVITE IS A LOGGING STUB, AND NOTHING HERE MAY IMPLY OTHERWISE.**
 *
 * `POST /contacts` fires an invite as a side effect when `phone` is present and
 * matches no account (§6.2, docs/decisions/0015-sms-phone-invite.md). The
 * backend's gateway is `LoggingSmsInviteGateway` — it writes a line to the
 * server log and reports success so the cooldown it starts is real and testable
 * (`backend/README.md` §15.1/§15.5). **No message is delivered to anybody.**
 * `inviteStatus` therefore says what the server *recorded*, never what a
 * recipient received, and the copy for each value lives in
 * `utils/contactInviteStatus.js` where it is written to stay true either way.
 */

/**
 * `GET /api/v1/contacts` -> `200 ContactResponse[]` (api-overview.md §6.1):
 * `{ id, name, initials, phone, email, linkedUserId, createdAt, updatedAt }`.
 *
 * **Not paginated** — §6.1 defines no `PageResponse` wrapper, the same
 * departure `GET /categories` and `GET /groups` already make. The whole list
 * arrives, which is what makes a client-side substring search over it honest
 * (unlike a filter over one page of a paginated list).
 *
 * `initials` is **server-derived** and must not be recomputed from `name` here
 * (`backend/README.md` §15.1): first letter of the first word plus first letter
 * of the last word. `phone` and `email` are independently optional — a contact
 * may carry either, both or neither (§6.1, ADR 0015 §2's split of what was once
 * one `phoneOrEmail` field).
 *
 * `linkedUserId` non-null means this contact is a registered account. That is
 * the one field with real consequences downstream: a linked contact resolves to
 * the **shared, canonical** pairwise balance row rather than a private one
 * (docs/decisions/0023-shared-ledger-contract-corrections.md §1.3), which is
 * why a pair balance can move without this device doing anything.
 *
 * **`inviteStatus` is absent from this response** and present on §6.2's — it
 * describes one creation attempt, not a property of the contact.
 *
 * @returns {Promise<object[]>} ContactResponse[]
 */
export function listContacts() {
  return authorizedRequest(CONTACT_PATHS.list);
}

/**
 * `POST /api/v1/contacts` -> `201 ContactResponse` + `inviteStatus`
 * (api-overview.md §6.2).
 *
 * Only `name` is required. `phone`/`email` are both optional and are matched
 * independently against `users.phone`/`users.email`; a match sets
 * `linkedUserId` at creation time. An unmatched **phone** additionally triggers
 * the invite described in this module's note; an unmatched email triggers
 * nothing (email invites are out of scope for ADR 0015).
 *
 * `inviteStatus` is `'sent' | 'failed' | 'cooldown_active' | null`, and `null`
 * whenever no invite was applicable — no phone submitted, or the phone already
 * belongs to an account. **An invite never fails its parent request**: the
 * contact is created either way, including when the invite is refused by a
 * cooldown or a cap (`backend/README.md` §15.2).
 *
 * `phone` must be E.164 (`+919876500001`); a local-format number is a
 * `400 VALIDATION_ERROR` (`backend/README.md` §15.1(e), §15.6 assumption 1). An
 * empty string is treated as absent server-side, but callers send `null`
 * instead so the request says what it means.
 *
 * There is **no duplicate rule**: two contacts may share a name, and §6.2
 * defines no `409` (`backend/README.md` §15.1).
 *
 * Errors: `400 VALIDATION_ERROR`.
 *
 * @param {{ name: string, phone?: string | null, email?: string | null }} contact
 * @returns {Promise<object>} ContactResponse with `inviteStatus`
 */
export function createContact({ name, phone = null, email = null }) {
  return authorizedRequest(CONTACT_PATHS.create, {
    method: 'POST',
    body: { name, phone, email },
  });
}
