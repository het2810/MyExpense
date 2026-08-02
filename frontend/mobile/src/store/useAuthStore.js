import { create } from 'zustand';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mirrors the password rule already documented in docs/api/authentication-api.md
// ("min 8, at least 1 uppercase, 1 lowercase, 1 digit").
const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * Mock authentication store.
 *
 * IMPORTANT — this is intentionally NOT wired to the real backend. There is
 * no network call here: docs/architecture/frontend-navigation.md Section 2.2
 * explicitly scopes auth to a local Zustand boolean flip for this phase.
 * `signIn` / `signUp` only perform basic client-side validation and then
 * flip `isAuthenticated`, which causes RootNavigator to swap from AuthStack
 * to MainTabs. Do not add fetch/axios calls here without the Backend
 * Engineer publishing (and the System Architect approving) real endpoint
 * wiring for docs/api/authentication-api.md.
 */
export const useAuthStore = create((set) => ({
  isAuthenticated: false,
  user: null,

  /**
   * @param {string} email
   * @param {string} password
   * @returns {{ success: boolean, errors: Object }}
   */
  signIn: (email, password) => {
    const errors = {};
    if (!email || !EMAIL_REGEX.test(email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (!password) {
      errors.password = 'Password is required.';
    }

    if (Object.keys(errors).length > 0) {
      return { success: false, errors };
    }

    set({ isAuthenticated: true, user: { email } });
    return { success: true, errors: {} };
  },

  /**
   * @param {{ firstName: string, lastName: string, email: string, password: string }} fields
   * @returns {{ success: boolean, errors: Object }}
   */
  signUp: ({ firstName, lastName, email, password }) => {
    const errors = {};
    if (!firstName || !firstName.trim()) {
      errors.firstName = 'First name is required.';
    }
    if (!lastName || !lastName.trim()) {
      errors.lastName = 'Last name is required.';
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (!password || !PASSWORD_COMPLEXITY_REGEX.test(password)) {
      errors.password =
        'Min 8 characters, with uppercase, lowercase, and a number.';
    }

    if (Object.keys(errors).length > 0) {
      return { success: false, errors };
    }

    set({ isAuthenticated: true, user: { firstName, lastName, email } });
    return { success: true, errors: {} };
  },

  logout: () => set({ isAuthenticated: false, user: null }),
}));
