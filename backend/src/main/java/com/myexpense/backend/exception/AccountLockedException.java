package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 401 on {@code POST /auth/login} once the account-lockout threshold has
 * been reached (security-architecture.md §5). The message deliberately
 * omits the exact unlock time or attempt count, to avoid handing an
 * attacker a timing oracle (docs/architecture/authentication.md §3).
 */
public class AccountLockedException extends ApiException {

    public AccountLockedException() {
        super(HttpStatus.UNAUTHORIZED, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.");
    }
}
