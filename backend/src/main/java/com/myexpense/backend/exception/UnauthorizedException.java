package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 401 for an authenticated-endpoint request whose principal cannot be
 * resolved to a real account (security-architecture.md §4).
 *
 * <p>Two cases reach this, both rare and both genuinely "your credentials
 * don't identify anyone":
 * <ul>
 *   <li>a structurally valid, unexpired access token whose {@code user_id} no
 *       longer exists — 401 is the honest answer, not 404 (the missing
 *       resource <em>is</em> the principal) and not 500;</li>
 *   <li>a null principal reaching a service method — defence in depth only:
 *       the filter chain already rejects unauthenticated requests to
 *       {@code /api/v1/users/**} before any controller runs.</li>
 * </ul>
 *
 * <p>The message matches {@code RestAuthenticationEntryPoint}'s wording so a
 * client sees one consistent 401 regardless of which layer produced it.
 */
public class UnauthorizedException extends ApiException {

    public UnauthorizedException() {
        super(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Authentication is required to access this resource.");
    }
}
