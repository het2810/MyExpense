package com.myexpense.backend.sync;

import java.io.IOException;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.filter.OncePerRequestFilter;

import com.myexpense.backend.dto.response.ApiErrorResponse;
import com.myexpense.backend.web.ApiErrorResponseWriter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * BE-1 (ADR 0027 §4.1): parses the four optional write headers into a
 * {@link WriteContext} stored as a request attribute, read back by
 * {@link WriteContextArgumentResolver}.
 *
 * <p>Applies to non-GET {@code /api/v1/**} requests outside {@code /auth/**}.
 * {@code /api/v1/notifications/**} is skipped entirely: its two mark-read writes
 * accept the headers and ignore them (§4.2), so a header there is never parsed
 * and never rejected.
 *
 * <p>A malformed value is {@code 400 VALIDATION_ERROR} with one
 * {@code fieldErrors} entry per bad header, naming the header. The rejected value
 * is never echoed and never logged.
 *
 * <p>Not a {@code @Component}: constructed and added to the security chain by
 * {@code SecurityConfig}, like the other filters there, so it runs once.
 */
public class WriteContextFilter extends OncePerRequestFilter {

    public static final String IDEMPOTENCY_KEY = "Idempotency-Key";
    public static final String CLIENT_UPDATED_AT = "X-Client-Updated-At";
    public static final String CLIENT_ORIGIN = "X-Client-Origin";
    public static final String DEVICE_ID = "X-Device-Id";

    private static final String API_PATH_PREFIX = "/api/v1/";
    private static final String AUTH_PATH_PREFIX = "/api/v1/auth/";
    private static final String NOTIFICATIONS_PATH_PREFIX = "/api/v1/notifications";
    private static final Set<String> WRITE_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");
    private static final UUID NIL_UUID = new UUID(0L, 0L);

    private final ApiErrorResponseWriter errorResponseWriter;

    public WriteContextFilter(ApiErrorResponseWriter errorResponseWriter) {
        this.errorResponseWriter = errorResponseWriter;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return !WRITE_METHODS.contains(request.getMethod())
                || !path.startsWith(API_PATH_PREFIX)
                || path.startsWith(AUTH_PATH_PREFIX)
                || path.startsWith(NOTIFICATIONS_PATH_PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        List<ApiErrorResponse.FieldErrorDetail> errors = new ArrayList<>();

        UUID idempotencyKey = parseUuid(request.getHeader(IDEMPOTENCY_KEY), IDEMPOTENCY_KEY, errors);
        UUID deviceId = parseUuid(request.getHeader(DEVICE_ID), DEVICE_ID, errors);
        OffsetDateTime clientUpdatedAt = parseInstant(request.getHeader(CLIENT_UPDATED_AT), errors);
        String origin = parseOrigin(request.getHeader(CLIENT_ORIGIN), errors);

        if (!errors.isEmpty()) {
            errorResponseWriter.write(response, HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
                    "One or more write headers are invalid.", request.getRequestURI(), errors);
            return;
        }

        request.setAttribute(WriteContext.REQUEST_ATTRIBUTE,
                new WriteContext(idempotencyKey, clientUpdatedAt, origin, deviceId));
        filterChain.doFilter(request, response);
    }

    /** Package-visible for unit tests. {@code null}/blank = absent. */
    static UUID parseUuid(String raw, String header, List<ApiErrorResponse.FieldErrorDetail> errors) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            String trimmed = raw.trim();
            UUID value = UUID.fromString(trimmed);
            // UUID.fromString accepts non-canonical forms ("1-1-1-1-1"); require the
            // canonical 36-character text so a key is one value, not several.
            if (trimmed.length() != 36 || NIL_UUID.equals(value)) {
                errors.add(new ApiErrorResponse.FieldErrorDetail(header, "must be a non-nil UUID"));
                return null;
            }
            return value;
        } catch (IllegalArgumentException ex) {
            errors.add(new ApiErrorResponse.FieldErrorDetail(header, "must be a non-nil UUID"));
            return null;
        }
    }

    static OffsetDateTime parseInstant(String raw, List<ApiErrorResponse.FieldErrorDetail> errors) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(raw.trim());
        } catch (DateTimeParseException ex) {
            errors.add(new ApiErrorResponse.FieldErrorDetail(CLIENT_UPDATED_AT,
                    "must be an ISO-8601 instant with Z or an offset"));
            return null;
        }
    }

    static String parseOrigin(String raw, List<ApiErrorResponse.FieldErrorDetail> errors) {
        if (raw == null || raw.isBlank()) {
            return WriteContext.ORIGIN_LIVE;
        }
        String value = raw.trim();
        if (WriteContext.ORIGIN_LIVE.equals(value) || WriteContext.ORIGIN_REPLAY.equals(value)) {
            return value;
        }
        errors.add(new ApiErrorResponse.FieldErrorDetail(CLIENT_ORIGIN, "must be 'live' or 'replay'"));
        return WriteContext.ORIGIN_LIVE;
    }
}
