import { useMemo } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';

/**
 * Who is signed in, for display: name, email and avatar initials.
 *
 * Replaces `src/mocks/profileMocks.js`'s static `profileUser` (`name`,
 * `email`, `initials`), which was a non-reactive placeholder object every
 * self-identity surface imported directly.
 *
 * **Two sources, in priority order, and deliberately not one:**
 *
 * 1. `useProfileStore().profile` — the `UserProfileResponse` from
 *    `GET /api/v1/users/me` (docs/api/api-overview.md §2.1), authoritative
 *    and freshest, present once something has asked for it.
 * 2. `useAuthStore().user` — the `UserResponse` stored with the session
 *    (ADR 0016 §5.1), which already carries `firstName`, `lastName` and
 *    `email` for the signed-in account.
 *
 * Both are real server data for the same account, and both carry the three
 * fields this hook reads, so one derivation covers either. The fallback is
 * what lets the header avatar on Dashboard and Split render correct initials
 * **without any screen on the startup path issuing a request** — the profile
 * fetch stays lazy (`useCurrentUserProfile`) while identity is never blank
 * and never a placeholder name. If the two ever disagree it is because a name
 * was changed on the server since sign-in; preferring the profile resolves
 * that in favour of the newer value.
 *
 * Signed out, every field is an empty string — callers render a blank avatar
 * rather than crashing or showing someone else's details.
 *
 * ---
 * **`userId` IS NOT A DISPLAY FIELD, AND IT IS LOAD-BEARING.**
 *
 * Added with the shared-ledger wiring. Both sources already carry it —
 * `UserProfileResponse.id` (api-overview.md §2.1) and the session's own
 * `UserResponse.id` (authentication-api.md's Common types) — so this is one
 * more field off a shape this hook already reads, not a new source of truth.
 *
 * It is the one fact the split flow cannot work without: a split expense
 * identifies each participant by **`participantUserId` or
 * `participantContactId`** (§9.1), and the caller is always the former, so
 * "which of these amounts is mine" and "did I pay this" are both answered by
 * comparing against it (§9.3, `utils/splitParticipants.js`). A session with no
 * stored `UserResponse` is wiped as unusable (`useAuthStore.restoreSession`), so
 * whenever the app is authenticated this is a real id — but it is still
 * `null`-checked at the call sites, because an identity that cannot be resolved
 * must block a write rather than send `null` and have the server reject it as an
 * opaque `400`.
 *
 * @returns {{ userId: string | null, firstName: string, lastName: string,
 *             fullName: string, email: string, initials: string }}
 */
export function useUserIdentity() {
  const profile = useProfileStore((state) => state.profile);
  const sessionUser = useAuthStore((state) => state.user);

  return useMemo(() => buildIdentity(profile || sessionUser), [profile, sessionUser]);
}

const EMPTY_IDENTITY = {
  userId: null,
  firstName: '',
  lastName: '',
  fullName: '',
  email: '',
  initials: '',
};

/**
 * @param {object | null | undefined} source `UserProfileResponse` or `UserResponse`.
 * @returns {{ userId: string | null, firstName: string, lastName: string,
 *             fullName: string, email: string, initials: string }}
 */
function buildIdentity(source) {
  if (!source) {
    return EMPTY_IDENTITY;
  }

  const firstName = typeof source.firstName === 'string' ? source.firstName.trim() : '';
  const lastName = typeof source.lastName === 'string' ? source.lastName.trim() : '';
  const email = typeof source.email === 'string' ? source.email : '';

  return {
    // `null` rather than '' when absent: an empty string is a value that could
    // be sent and silently fail a uuid comparison, while null fails the
    // caller's own guard loudly.
    userId: typeof source.id === 'string' && source.id.length > 0 ? source.id : null,
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(' '),
    email,
    initials: deriveInitials(firstName, lastName),
  };
}

/**
 * First initial + last initial, uppercased — the app's existing rule, applied
 * to the structured `firstName`/`lastName` the API returns instead of to a
 * single display-name string (SplitAddExpenseScreen's `getInitialsFromName`
 * does the same thing for a contact typed into one field, ADR 0006 §3).
 * Either part missing yields just the other, which is what `Avatar` already
 * handles (it slices to two characters).
 *
 * @param {string} firstName
 * @param {string} lastName
 * @returns {string}
 */
function deriveInitials(firstName, lastName) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}
