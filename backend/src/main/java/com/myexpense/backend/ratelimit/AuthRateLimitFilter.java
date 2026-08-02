package com.myexpense.backend.ratelimit;

import java.io.IOException;
import java.time.Duration;

import org.springframework.http.HttpStatus;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import com.myexpense.backend.web.ApiErrorResponseWriter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Per-IP rate limiting applied to every {@code /api/v1/auth/**} endpoint —
 * the strict tier (security-architecture.md §1/§11). Per-account limiting
 * (keyed by email) is enforced separately, inside {@code AuthService}, for
 * the endpoints that actually carry an email in the request body.
 *
 * <p>Deliberately <strong>not</strong> a {@code @Component} — it is
 * constructed directly by {@code SecurityConfig} and wired into the
 * {@code SecurityFilterChain} via {@code addFilterBefore}. If this were a
 * component-scanned {@link jakarta.servlet.Filter} bean, Spring Boot's
 * default servlet filter auto-registration would also register it as a
 * generic, all-paths filter in addition to its place in the security chain
 * — running it twice per request.
 */
public class AuthRateLimitFilter extends OncePerRequestFilter {

    private static final String AUTH_PATH_PREFIX = "/api/v1/auth/";

    private final RateLimiter rateLimiter;
    private final AuthRateLimitProperties properties;
    private final ApiErrorResponseWriter errorResponseWriter;

    public AuthRateLimitFilter(RateLimiter rateLimiter, AuthRateLimitProperties properties,
            ApiErrorResponseWriter errorResponseWriter) {
        this.rateLimiter = rateLimiter;
        this.properties = properties;
        this.errorResponseWriter = errorResponseWriter;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String path = request.getRequestURI();
        if (!path.startsWith(AUTH_PATH_PREFIX) && !path.startsWith(request.getContextPath() + AUTH_PATH_PREFIX)) {
            filterChain.doFilter(request, response);
            return;
        }

        AuthRateLimitProperties.Tier tier = properties.getIp();
        String key = "ip:" + resolveClientIp(request) + ":" + path;
        boolean allowed = rateLimiter.tryConsume(key, tier.getCapacity(), Duration.ofSeconds(tier.getWindowSeconds()));
        if (!allowed) {
            errorResponseWriter.write(response, HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMIT_EXCEEDED",
                    "Too many requests. Please try again later.", path);
            return;
        }

        filterChain.doFilter(request, response);
    }

    private String resolveClientIp(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (StringUtils.hasText(forwardedFor)) {
            return forwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
