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
 * @param {unknown} error
 * @returns {string} Copy safe to display to the user. Never a stack trace,
 *   never a raw server message (constitution §22).
 */
export function getErrorMessage(error) {
  if (!isApiError(error)) {
    return GENERIC_MESSAGE;
  }
  const mapped = MESSAGES[error.code];
  if (mapped) {
    return mapped;
  }
  // Unmapped codes get the generic fallback and are logged in dev builds
  // only, so a missing mapping surfaces during development rather than as a
  // mystery message in front of a user (ADR 0016 §4.3).
  if (__DEV__) {
    console.log(`[api] unmapped error code: ${error.code}`);
  }
  return GENERIC_MESSAGE;
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
