package com.myexpense.backend.web;

import java.io.IOException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import tools.jackson.databind.ObjectMapper;
import com.myexpense.backend.dto.response.ApiErrorResponse;

import jakarta.servlet.http.HttpServletResponse;

/**
 * Writes the same {@code ApiErrorResponse} shape {@link
 * com.myexpense.backend.exception.GlobalExceptionHandler} produces, for the
 * handful of rejection paths that happen outside normal controller dispatch
 * (Spring Security's authentication entry point / access-denied handler, and
 * the rate-limit filter) and therefore never reach
 * {@code @RestControllerAdvice}
 * (security-architecture.md §10 — "not a servlet-container default error
 * page").
 */
@Component
public class ApiErrorResponseWriter {

    private final ObjectMapper objectMapper;

    public ApiErrorResponseWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void write(HttpServletResponse response, HttpStatus status, String errorCode, String message, String path)
            throws IOException {
        ApiErrorResponse body = new ApiErrorResponse(
                OffsetDateTime.now(ZoneOffset.UTC), status.value(), errorCode, message, path, null);
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(body));
    }
}
