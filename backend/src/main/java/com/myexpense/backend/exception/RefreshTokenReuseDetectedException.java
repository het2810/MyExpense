package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 401 on {@code POST /auth/refresh} when an already-rotated/revoked refresh
 * token is replayed. The entire token family has already been revoked by
 * the time this is thrown (docs/architecture/authentication.md §2) — the
 * client must force a full re-login.
 */
public class RefreshTokenReuseDetectedException extends ApiException {

    public RefreshTokenReuseDetectedException() {
        super(HttpStatus.UNAUTHORIZED, "REFRESH_TOKEN_REUSE_DETECTED",
                "This session has been revoked for security reasons. Please log in again.");
    }
}
