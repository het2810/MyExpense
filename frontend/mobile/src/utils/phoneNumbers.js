/**
 * Phone-number normalization for device contacts.
 *
 * The backend accepts **E.164 only** (`+919876543210`) on `POST /contacts`
 * (docs/api/api-overview.md §6.2, `backend/README.md` §15.1(e)), while a phone's
 * address book holds whatever the user typed: `98765 43210`, `098765-43210`,
 * `+91 98765 43210`, `0091 9876543210`.
 *
 * **Ruled by the Project Owner (2026-11-12): local numbers are assumed to be
 * Indian (+91).** No parsing library is added — the rules below cover the
 * formats an Indian address book actually holds, and a number they cannot turn
 * into a plausible E.164 string is reported as unusable rather than guessed at.
 *
 * Rules, in order, after stripping everything but digits and a leading `+`:
 * 1. `+<digits>` is kept as-is.
 * 2. `00<digits>` is the international prefix: `00` becomes `+`.
 * 3. A leading trunk `0` is dropped, then `+91` is prefixed.
 * 4. `91` followed by a 10-digit national number gains its missing `+`.
 * 5. Anything else gets `+91` prefixed.
 * The result must be `+` followed by 8–15 digits (E.164's maximum is 15),
 * otherwise `null`.
 */

export const DEFAULT_CALLING_CODE = '91';

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

// An Indian mobile/landline national number, without the trunk '0'.
const NATIONAL_NUMBER_LENGTH = 10;

/**
 * @param {string | null | undefined} raw
 * @returns {string} Digits only, e.g. '+91 98765-43210' -> '919876543210'.
 */
export function digitsOf(raw) {
  return typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
}

/**
 * @param {string | null | undefined} raw A number as stored on the device.
 * @param {string} [callingCode] Applied to numbers without a country code.
 * @returns {string | null} E.164, or null when no plausible number results.
 */
export function toE164(raw, callingCode = DEFAULT_CALLING_CODE) {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  const digits = digitsOf(trimmed);
  if (!digits) {
    return null;
  }

  let candidate;
  // A '+' before the first digit, also inside '(+1)'.
  if (/^\D*\+/.test(trimmed)) {
    candidate = `+${digits}`;
  } else if (digits.startsWith('00')) {
    candidate = `+${digits.slice(2)}`;
  } else if (digits.startsWith('0')) {
    candidate = `+${callingCode}${digits.slice(1)}`;
  } else if (
    digits.length === callingCode.length + NATIONAL_NUMBER_LENGTH &&
    digits.startsWith(callingCode)
  ) {
    // '919876543210' — the country code typed without its '+'.
    candidate = `+${digits}`;
  } else {
    candidate = `+${callingCode}${digits}`;
  }

  return E164_PATTERN.test(candidate) ? candidate : null;
}
