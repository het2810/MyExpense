package com.myexpense.backend.ratelimit;

import java.io.IOException;
import java.time.Duration;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import com.myexpense.backend.web.ApiErrorResponseWriter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * The default per-authenticated-user rate limit (security-architecture.md
 * §11), applied to every {@code /api/v1/**} request except
 * {@code /api/v1/auth/**}, which {@link AuthRateLimitFilter} already covers
 * with its stricter per-IP/per-account tier.
 *
 * <p>Introduced with Domain 2 (User &amp; Settings), the first authenticated
 * domain, but written for the whole non-auth API on purpose: the build order
 * requires every domain to ship with its own rate limiting, and the default
 * tier is identical for all of them. Domains 3+ inherit this automatically —
 * a domain needing a <em>stricter</em> tier (the SMS invite endpoints, file
 * uploads) layers that on top inside its own service, exactly as
 * {@code AuthService} layers per-account limits over the per-IP filter. It
 * must not be re-implemented per domain.
 *
 * <p>Ordered after {@link com.myexpense.backend.security.JwtAuthenticationFilter}
 * so the principal is already resolved and can be used as the bucket key.
 * Unauthenticated requests to a protected path fall back to an IP key: they
 * are about to be rejected with a 401 anyway, but an unauthenticated flood
 * should not be free just because it has no principal to key on.
 *
 * <p>Deliberately <strong>not</strong> a {@code @Component}, for the same
 * reason as the other two filters in the security chain — see
 * {@link AuthRateLimitFilter}'s Javadoc.
 */
public class ApiRateLimitFilter extends OncePerRequestFilter {

    private static final String API_PATH_PREFIX = "/api/v1/";
    private static final String AUTH_PATH_PREFIX = "/api/v1/auth/";

    private final RateLimiter rateLimiter;
    private final ApiRateLimitProperties properties;
    private final ApiErrorResponseWriter errorResponseWriter;

    public ApiRateLimitFilter(RateLimiter rateLimiter, ApiRateLimitProperties properties,
            ApiErrorResponseWriter errorResponseWriter) {
        this.rateLimiter = rateLimiter;
        this.properties = properties;
        this.errorResponseWriter = errorResponseWriter;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String path = request.getRequestURI();
        String relativePath = stripContextPath(path, request.getContextPath());
        if (!relativePath.startsWith(API_PATH_PREFIX) || relativePath.startsWith(AUTH_PATH_PREFIX)) {
            filterChain.doFilter(request, response);
            return;
        }

        ApiRateLimitProperties.Tier tier = properties.getUser();
        boolean allowed = rateLimiter.tryConsume(
                resolveBucketKey(request), tier.getCapacity(), Duration.ofSeconds(tier.getWindowSeconds()));
        if (!allowed) {
            errorResponseWriter.write(response, HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMIT_EXCEEDED",
                    "Too many requests. Please try again later.", path);
            return;
        }

        filterChain.doFilter(request, response);
    }

    /**
     * The principal's id when authenticated, the client IP otherwise.
     *
     * <p>For the authenticated case — the only one that matters here — the
     * key comes from the verified token and is not something a caller can
     * vary to mint itself a fresh bucket. The IP fallback trusts
     * {@code X-Forwarded-For} (same as {@link AuthRateLimitFilter}), which a
     * direct client can spoof; that is acceptable because it only applies to
     * requests that are about to be rejected with a 401 anyway, and it is
     * required for the limit to work at all behind a reverse proxy.
     */
    private String resolveBucketKey(HttpServletRequest request) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        // Matching on UUID specifically, not just "is there an Authentication":
        // an anonymous token's principal is the shared string "anonymousUser",
        // which would put every unauthenticated caller in one bucket.
        if (authentication != null && authentication.getPrincipal() instanceof UUID userId) {
            return "user:" + userId;
        }
        return "anon-ip:" + resolveClientIp(request);
    }

    private String resolveClientIp(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (StringUtils.hasText(forwardedFor)) {
            return forwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    private String stripContextPath(String path, String contextPath) {
        if (StringUtils.hasText(contextPath) && path.startsWith(contextPath)) {
            return path.substring(contextPath.length());
        }
        return path;
    }
}
