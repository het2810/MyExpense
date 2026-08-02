import { create } from 'zustand';
import * as authApi from '../api/authApi';
import * as authSession from '../api/authSession';
import { toFormErrors } from '../api/errorMessages';
import {
  validateSignIn,
  validateSignUp,
  validateEmailOnly,
  hasErrors,
} from '../utils/authValidation';

/**
 * Authentication store — docs/decisions/0016-frontend-api-integration.md §7.
 *
 * As of ADR 0016 this is wired to the real backend (`/api/v1/auth`), replacing
 * the previous local `isAuthenticated` flip. `user` is now the server's
 * `UserResponse` verbatim — `{ id, email, firstName, lastName, emailVerified,
 * roles, createdAt }` — with no client-side reshaping or field invention
 * (constitution §15/§30).
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1). All
 * orchestration (validation -> request -> session -> state) lives here, never
 * in a screen (constitution §8).
 *
 * `isAuthenticated` deliberately stays a boolean and stays the thing
 * RootNavigator keys on — ADR 0011's one-shot post-auth effect,
 * getPostAuthDestination, and the three-branch root render are all built on
 * it. Every action that authenticates sets `isAuthenticated` and `user` in a
 * SINGLE set() call so that effect (keyed on `[isAuthenticated, user]`) runs
 * exactly once with both values correct.
 *
 * Per-operation state blocks (signIn/signUp/forgotPassword) rather than one
 * global isLoading/error: three independent operations across three screens,
 * so a shared flag would leave a failed sign-up's error on the sign-in screen
 * and a shared spinner would disable unrelated buttons (ADR 0016 §7).
 */

const IDLE_OPERATION = {
  isSubmitting: false,
  formError: null,
  fieldErrors: {},
};

const IDLE_FORGOT_PASSWORD = {
  ...IDLE_OPERATION,
  confirmationMessage: null,
};

// Fields each screen actually renders, so a server `fieldErrors[]` entry for
// anything else falls through to the form-level slot instead of vanishing
// (ADR 0016 §4.2).
const SIGN_IN_FIELDS = ['email', 'password'];
const SIGN_UP_FIELDS = ['firstName', 'lastName', 'email', 'password'];
const FORGOT_PASSWORD_FIELDS = ['email'];

// ADR 0016 §9.2 — register succeeded but the follow-up login failed. The
// account EXISTS, so "sign up failed" would be false and a retry would return
// 409 EMAIL_ALREADY_EXISTS, which is worse.
const ACCOUNT_CREATED_MESSAGE = 'Your account was created. Please sign in.';

export const useAuthStore = create((set, get) => ({
  // --- session ---
  isAuthenticated: false,
  user: null,
  isRestoringSession: true,
  /** @type {null | 'expired' | 'reuse-detected'} */
  sessionEndedReason: null,

  // --- per-operation state ---
  signIn: { ...IDLE_OPERATION },
  signUp: { ...IDLE_OPERATION },
  forgotPassword: { ...IDLE_FORGOT_PASSWORD },
  isLoggingOut: false,

  /**
   * Cold-start session restore — ADR 0016 §8.2.
   *
   * A local keychain read only: no network call is required to consider the
   * user signed in, which is what makes a restored session work offline
   * (constitution §14).
   *
   * @returns {Promise<void>}
   */
  restoreSession: async () => {
    let stored = null;
    try {
      stored = await authSession.restoreSessionFromStorage();
    } catch (error) {
      // loadSession already swallows and wipes a corrupt entry; this is a
      // belt-and-braces guard so restore can never leave the splash gate
      // waiting forever.
      stored = null;
    }

    if (!stored || !stored.user) {
      // A session with no stored UserResponse cannot identify who is signed
      // in (there is no GET /users/me until Domain 2), so it is unusable —
      // wipe it rather than leave a half-session on the device.
      if (stored) {
        await authSession.clearLocalSession();
      }
      set({ isAuthenticated: false, user: null, isRestoringSession: false });
      return;
    }

    set({
      isAuthenticated: true,
      user: stored.user,
      isRestoringSession: false,
      sessionEndedReason: null,
    });

    // ADR 0016 §8.2 step 4 — one opportunistic, non-blocking, offline-safe
    // refresh when the stored access token has already expired. Deliberately
    // not awaited: if it fails terminally, authSession's forced logout
    // returns the user to SignIn; if it fails on the network, nothing happens
    // and the session stands.
    if (authSession.isAccessTokenExpired()) {
      authSession.refreshAccessToken().catch(() => {});
    }
  },

  /**
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{ success: boolean, fieldErrors: Object, formError: string | null }>}
   */
  submitSignIn: async (email, password) => {
    const localErrors = validateSignIn({ email, password });
    if (hasErrors(localErrors)) {
      set({ signIn: { isSubmitting: false, formError: null, fieldErrors: localErrors } });
      return { success: false, fieldErrors: localErrors, formError: null };
    }

    set({
      signIn: { isSubmitting: true, formError: null, fieldErrors: {} },
      sessionEndedReason: null,
    });

    try {
      const authResponse = await authApi.login({ email, password });
      await authSession.startSession(authResponse);
      set({
        isAuthenticated: true,
        user: authSession.getUser(),
        signIn: { ...IDLE_OPERATION },
      });
      return { success: true, fieldErrors: {}, formError: null };
    } catch (error) {
      const { fieldErrors, formError } = toFormErrors(error, SIGN_IN_FIELDS);
      set({ signIn: { isSubmitting: false, formError, fieldErrors } });
      return { success: false, fieldErrors, formError };
    }
  },

  /**
   * Register, then log in — ADR 0016 §9.2.
   *
   * `POST /register` returns `201 UserResponse` and no tokens, so this
   * performs two sequential calls as one user-visible operation to preserve
   * ADR 0011 §6's approved behavior (sign-up always proceeds into the
   * mandatory budget gate). The credentials are held in memory for the
   * duration of the call and never stored.
   *
   * @param {{ firstName: string, lastName: string, email: string, password: string }} fields
   * @returns {Promise<{ success: boolean, fieldErrors: Object, formError: string | null,
   *                     accountCreated?: boolean }>}
   */
  submitSignUp: async ({ firstName, lastName, email, password }) => {
    const localErrors = validateSignUp({ firstName, lastName, email, password });
    if (hasErrors(localErrors)) {
      set({ signUp: { isSubmitting: false, formError: null, fieldErrors: localErrors } });
      return { success: false, fieldErrors: localErrors, formError: null };
    }

    set({
      signUp: { isSubmitting: true, formError: null, fieldErrors: {} },
      sessionEndedReason: null,
    });

    try {
      await authApi.register({ firstName, lastName, email, password });
    } catch (error) {
      const { fieldErrors, formError } = toFormErrors(error, SIGN_UP_FIELDS);
      set({ signUp: { isSubmitting: false, formError, fieldErrors } });
      return { success: false, fieldErrors, formError };
    }

    // The account now exists. Anything that fails past this point must not be
    // reported as "sign up failed".
    try {
      const authResponse = await authApi.login({ email, password });
      await authSession.startSession(authResponse);
      set({
        isAuthenticated: true,
        user: authSession.getUser(),
        signUp: { ...IDLE_OPERATION },
      });
      return { success: true, fieldErrors: {}, formError: null };
    } catch (error) {
      // e.g. RATE_LIMIT_EXCEEDED — register just touched this account and
      // login has its own per-account limit (backend/README.md §6). The
      // screen routes to Sign In with this message rather than leaving the
      // user on a form that cannot succeed.
      set({ signUp: { ...IDLE_OPERATION } });
      return {
        success: false,
        accountCreated: true,
        fieldErrors: {},
        formError: ACCOUNT_CREATED_MESSAGE,
      };
    }
  },

  /**
   * Requests a password reset. Completing the reset is deferred until email
   * delivery exists (ADR 0016 §13) — this is only the request half.
   *
   * @param {string} email
   * @returns {Promise<{ success: boolean, fieldErrors: Object, formError: string | null }>}
   */
  submitPasswordResetRequest: async (email) => {
    const localErrors = validateEmailOnly(email);
    if (hasErrors(localErrors)) {
      set({
        forgotPassword: {
          ...IDLE_FORGOT_PASSWORD,
          fieldErrors: localErrors,
        },
      });
      return { success: false, fieldErrors: localErrors, formError: null };
    }

    set({
      forgotPassword: {
        isSubmitting: true,
        formError: null,
        fieldErrors: {},
        confirmationMessage: null,
      },
    });

    try {
      const response = await authApi.requestPasswordReset(email);
      set({
        forgotPassword: {
          ...IDLE_FORGOT_PASSWORD,
          // The server owns this wording for anti-enumeration reasons
          // (authentication-api.md §5), so echo it and keep one source of
          // truth. The screen supplies its own copy when it is absent.
          confirmationMessage:
            response && typeof response.message === 'string' ? response.message : null,
        },
      });
      return { success: true, fieldErrors: {}, formError: null };
    } catch (error) {
      const { fieldErrors, formError } = toFormErrors(error, FORGOT_PASSWORD_FIELDS);
      set({
        forgotPassword: {
          isSubmitting: false,
          formError,
          fieldErrors,
          confirmationMessage: null,
        },
      });
      return { success: false, fieldErrors, formError };
    }
  },

  /**
   * Deliberate, user-initiated logout — ADR 0016 §6.4.
   *
   * Local logout is never blocked by the network and never by a failed server
   * call: the `finally` is the entire point. A user who taps Log Out on a
   * plane, or against a backend that is down, still ends up signed out
   * locally with credentials wiped.
   *
   * Accepted trade-off (recorded, not glossed over): an offline logout leaves
   * the server-side refresh token alive until it expires. The device no
   * longer holds it, so the practical exposure is small. Queuing the logout
   * for later delivery is Domain 8 (offline write queue) work.
   *
   * @returns {Promise<void>}
   */
  logout: async () => {
    if (get().isLoggingOut) {
      return;
    }
    set({ isLoggingOut: true });

    const session = authSession.getSession();
    try {
      if (session && session.accessToken && session.refreshToken) {
        await authApi.logout({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        });
      }
    } catch (error) {
      // Swallowed on purpose. Dev builds log the code only — never the body,
      // never a token (constitution §23 / ADR 0016 §14).
      if (__DEV__) {
        console.log(`[auth] logout request failed: ${error && error.code}`);
      }
    } finally {
      await authSession.clearLocalSession();
      set({
        isAuthenticated: false,
        user: null,
        isLoggingOut: false,
        sessionEndedReason: null,
        signIn: { ...IDLE_OPERATION },
        signUp: { ...IDLE_OPERATION },
        forgotPassword: { ...IDLE_FORGOT_PASSWORD },
      });
    }
  },

  /**
   * Called by authSession when the session dies server-side (ADR 0016 §6.5).
   * Credentials have already been wiped by the time this runs.
   *
   * No navigation happens here — RootNavigator renders AuthStack off
   * `isAuthenticated`, which is both correct layering and the same
   * callback-not-navigate pattern ADR 0011 §3 established.
   *
   * @param {'expired' | 'reuse-detected'} reason
   */
  handleSessionExpired: (reason) => {
    set({
      isAuthenticated: false,
      user: null,
      sessionEndedReason: reason,
      isRestoringSession: false,
      isLoggingOut: false,
      signIn: { ...IDLE_OPERATION },
      signUp: { ...IDLE_OPERATION },
      forgotPassword: { ...IDLE_FORGOT_PASSWORD },
    });
  },

  clearSignInErrors: () => set({ signIn: { ...IDLE_OPERATION } }),
  clearSignUpErrors: () => set({ signUp: { ...IDLE_OPERATION } }),
  clearForgotPasswordErrors: () =>
    set((state) => ({
      forgotPassword: {
        ...IDLE_FORGOT_PASSWORD,
        confirmationMessage: state.forgotPassword.confirmationMessage,
      },
    })),
}));

/**
 * Dependency inversion, registered once at module initialization (ADR 0016
 * §6.5): `src/api/*` never imports a store, so authSession is handed a
 * callback instead. The arrow still points store -> api.
 */
authSession.setSessionExpiredHandler((reason) => {
  useAuthStore.getState().handleSessionExpired(reason);
});
