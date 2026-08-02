/**
 * Client-side auth form validation — pure functions, no store, no network.
 *
 * These stay even though the server re-validates everything
 * (security-architecture.md §3): client validation is purely UX, but it is
 * *good* UX — instant feedback, no wasted round trip, and it avoids spending
 * the per-account rate-limit budget on a request that was never going to
 * succeed (docs/decisions/0016-frontend-api-integration.md §9.1).
 *
 * Returned keys are the DTO field names from docs/api/authentication-api.md,
 * so a server `fieldErrors[]` entry merges onto the same key the client
 * produced (ADR 0016 §4.2). Do not rename them to something friendlier.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the password rule in docs/api/authentication-api.md §1
// ("min 8, at least 1 uppercase, 1 lowercase, 1 digit").
const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * @param {string} email
 * @returns {string | null} An error message, or null when valid.
 */
function checkEmail(email) {
  if (!email || !EMAIL_REGEX.test(email)) {
    return 'Enter a valid email address.';
  }
  return null;
}

/**
 * @param {{ email: string, password: string }} fields
 * @returns {Object<string, string>} Empty when valid.
 */
export function validateSignIn({ email, password }) {
  const errors = {};
  const emailError = checkEmail(email);
  if (emailError) {
    errors.email = emailError;
  }
  if (!password) {
    errors.password = 'Password is required.';
  }
  return errors;
}

/**
 * @param {{ firstName: string, lastName: string, email: string, password: string }} fields
 * @returns {Object<string, string>} Empty when valid.
 */
export function validateSignUp({ firstName, lastName, email, password }) {
  const errors = {};
  if (!firstName || !firstName.trim()) {
    errors.firstName = 'First name is required.';
  }
  if (!lastName || !lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }
  const emailError = checkEmail(email);
  if (emailError) {
    errors.email = emailError;
  }
  if (!password || !PASSWORD_COMPLEXITY_REGEX.test(password)) {
    errors.password = 'Min 8 characters, with uppercase, lowercase, and a number.';
  }
  return errors;
}

/**
 * @param {string} email
 * @returns {Object<string, string>} Empty when valid.
 */
export function validateEmailOnly(email) {
  const errors = {};
  const emailError = checkEmail(email);
  if (emailError) {
    errors.email = emailError;
  }
  return errors;
}

/**
 * @param {Object<string, string>} errors
 * @returns {boolean}
 */
export function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}
