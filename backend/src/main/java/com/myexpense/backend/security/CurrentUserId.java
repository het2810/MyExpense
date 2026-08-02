package com.myexpense.backend.security;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import org.springframework.security.core.annotation.AuthenticationPrincipal;

/**
 * Injects the authenticated caller's {@code user_id} into a controller
 * method parameter:
 *
 * <pre>
 * &#64;GetMapping("/me")
 * public UserProfileResponse getCurrentUser(&#64;CurrentUserId UUID userId) { ... }
 * </pre>
 *
 * <p><strong>This is the only sanctioned way for a controller in this
 * backend to learn who is asking</strong>, and every domain after this one
 * should use it (security-architecture.md §2). It is a meta-annotation over
 * Spring Security's {@link AuthenticationPrincipal}, so the value is resolved
 * from the {@code SecurityContext} that {@link JwtAuthenticationFilter}
 * populated from the verified, signed access token — it cannot come from a
 * path variable, a query parameter, or a request body, because there is
 * nothing here for a client to supply.
 *
 * <p>That is the whole point of the indirection. A client-supplied id in a
 * request body or a {@code /users/{id}} path is an IDOR waiting to happen;
 * this API deliberately has no {@code /users/{id}} endpoint at all, only
 * {@code /users/me}. A thin named annotation makes the safe path the obvious,
 * shortest one to write, and makes any future controller that reaches for a
 * client-supplied id stand out in review.
 *
 * <p>Services still take the resolved {@code UUID} as an ordinary parameter
 * rather than reading {@code SecurityContextHolder} themselves — they stay
 * plain, testable business logic with no dependency on the web/security
 * layer, and every service method's authorization input is visible in its
 * signature.
 *
 * <p>The resolved value is never null in practice: the filter chain answers
 * {@code 401 UNAUTHORIZED} for any unauthenticated request to a protected
 * path long before the controller is invoked. Services nonetheless treat
 * null as "unauthenticated" and throw {@code UnauthorizedException} rather
 * than assuming.
 */
@Documented
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
@AuthenticationPrincipal
public @interface CurrentUserId {
}
