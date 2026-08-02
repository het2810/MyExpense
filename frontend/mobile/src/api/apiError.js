/**
 * The single error type every API failure is normalized into —
 * docs/decisions/0016-frontend-api-integration.md §4.1.
 *
 * An `ApiErrorResponse` body, a network failure, a timeout, and an
 * unparseable response all arrive at the caller as one shape, so no caller
 * has to branch on "was this a fetch rejection or an HTTP error?".
 *
 * Layer rule (ADR 0016 §1): this file imports nothing.
 */

/** `fetch` rejected — offline, DNS failure, connection refused. */
export const NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE';

/** The request exceeded its timeout. */
export const TIMEOUT = 'TIMEOUT';

/** The caller aborted the request deliberately; not a user-facing failure. */
export const REQUEST_CANCELLED = 'REQUEST_CANCELLED';

/** A 2xx/error body that could not be parsed as the documented JSON contract. */
export const INVALID_RESPONSE = 'INVALID_RESPONSE';

/**
 * Status used for every failure where the server was never reached.
 * Making both transport codes share `status: 0` turns "did we ever reach the
 * server?" into one unambiguous check — which ADR 0016 §6.5's
 * never-wipe-credentials-on-a-transport-failure invariant depends on.
 */
export const TRANSPORT_STATUS = 0;

export class ApiError extends Error {
  /**
   * @param {{ status: number, code: string, message: string,
   *           fieldErrors?: Array<{ field: string, message: string }>,
   *           path?: string }} details
   */
  constructor({ status, code, message, fieldErrors, path }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = Array.isArray(fieldErrors) ? fieldErrors : [];
    this.path = path ?? null;
  }

  /** True when the server was never reached (offline, timeout, cancelled). */
  get isTransportFailure() {
    return this.status === TRANSPORT_STATUS;
  }
}

/**
 * Builds an ApiError from a parsed `ApiErrorResponse` body.
 * Falls back safely when the body is absent or does not match the contract —
 * an HTML error page from a proxy must not become a bare SyntaxError in a
 * screen (constitution §22).
 *
 * @param {number} status
 * @param {object | null} body Parsed `ApiErrorResponse`, if there was one.
 * @param {string} path
 * @returns {ApiError}
 */
export function fromErrorResponse(status, body, path) {
  const hasContractShape = body && typeof body === 'object' && typeof body.error === 'string';
  return new ApiError({
    status,
    code: hasContractShape ? body.error : INVALID_RESPONSE,
    // The `message` here is the server's own copy. It is carried for dev
    // logging and as a last-resort fallback only — user-facing copy comes
    // from errorMessages.js (ADR 0016 §4.3), never from this field.
    message:
      hasContractShape && typeof body.message === 'string'
        ? body.message
        : `Request failed with status ${status}.`,
    fieldErrors: hasContractShape ? body.fieldErrors : [],
    path: hasContractShape && body.path ? body.path : path,
  });
}

/**
 * @param {string} path
 * @returns {ApiError}
 */
export function networkError(path) {
  return new ApiError({
    status: TRANSPORT_STATUS,
    code: NETWORK_UNAVAILABLE,
    message: 'The network request could not be completed.',
    path,
  });
}

/**
 * @param {string} path
 * @returns {ApiError}
 */
export function timeoutError(path) {
  return new ApiError({
    status: TRANSPORT_STATUS,
    code: TIMEOUT,
    message: 'The network request timed out.',
    path,
  });
}

/**
 * @param {string} path
 * @returns {ApiError}
 */
export function cancelledError(path) {
  return new ApiError({
    status: TRANSPORT_STATUS,
    code: REQUEST_CANCELLED,
    message: 'The request was cancelled.',
    path,
  });
}

/**
 * @param {string} path
 * @returns {ApiError}
 */
export function invalidResponseError(path) {
  return new ApiError({
    status: TRANSPORT_STATUS,
    code: INVALID_RESPONSE,
    message: 'The server response could not be read.',
    path,
  });
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isApiError(error) {
  return error instanceof ApiError;
}
