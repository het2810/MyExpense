package com.myexpense.backend.exception;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import com.myexpense.backend.dto.response.ApiErrorResponse;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Centralized exception handling (constitution §22, security-architecture.md
 * §4/§8) — every error response in this API, auth or otherwise, is produced
 * here rather than via per-controller try/catch. Client-facing messages are
 * always safe, generic summaries; stack traces and internal details never
 * leave the server (constitution §22).
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiErrorResponse> handleApiException(ApiException ex, HttpServletRequest request) {
        ApiErrorResponse body = new ApiErrorResponse(
                now(), ex.getStatus().value(), ex.getErrorCode(), ex.getMessage(), request.getRequestURI(), null);
        return ResponseEntity.status(ex.getStatus()).body(body);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleValidation(
            MethodArgumentNotValidException ex, HttpServletRequest request) {
        List<ApiErrorResponse.FieldErrorDetail> fieldErrors = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> new ApiErrorResponse.FieldErrorDetail(fe.getField(), fe.getDefaultMessage()))
                .toList();
        ApiErrorResponse body = new ApiErrorResponse(
                now(), HttpStatus.BAD_REQUEST.value(), "VALIDATION_ERROR",
                "One or more fields failed validation.", request.getRequestURI(), fieldErrors);
        return ResponseEntity.badRequest().body(body);
    }

    /**
     * A path variable or query parameter that cannot be converted to its
     * declared type — e.g. {@code PATCH /api/v1/categories/not-a-uuid}.
     *
     * <p>Added with Domain 3, the first domain with a typed path variable.
     * Without it this falls through to the {@code Exception} catch-all below
     * and answers {@code 500 INTERNAL_ERROR} with a logged stack trace for
     * what is plainly a malformed client request. It is reported as the same
     * {@code 400 VALIDATION_ERROR} shape as a bad body field, naming the
     * offending parameter in {@code fieldErrors}
     * (security-architecture.md §4's 400 row). Deliberately generic: the
     * declared target type is never echoed back, so the response leaks
     * nothing about the implementation (constitution §22).
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiErrorResponse> handleTypeMismatch(
            MethodArgumentTypeMismatchException ex, HttpServletRequest request) {
        List<ApiErrorResponse.FieldErrorDetail> fieldErrors =
                List.of(new ApiErrorResponse.FieldErrorDetail(ex.getName(), "is not a valid value"));
        ApiErrorResponse body = new ApiErrorResponse(
                now(), HttpStatus.BAD_REQUEST.value(), "VALIDATION_ERROR",
                "One or more fields failed validation.", request.getRequestURI(), fieldErrors);
        return ResponseEntity.badRequest().body(body);
    }

    /**
     * Query-parameter binding or validation failure on a {@code @ModelAttribute}
     * -bound request object — {@code GET /api/v1/transactions}'s
     * {@code ListTransactionsQuery} is the first of these.
     *
     * <p>Added with Domain 4, the first domain with validated query parameters.
     * Without it, {@code size=0} or {@code dateFrom=not-a-date} falls through to
     * the {@code Exception} catch-all below and answers
     * {@code 500 INTERNAL_ERROR} with a logged stack trace for what is plainly a
     * malformed client request.
     *
     * <p>Reported as the same {@code 400 VALIDATION_ERROR} shape as a bad body
     * field, naming each offending parameter in {@code fieldErrors}
     * (security-architecture.md §4's 400 row).
     *
     * <p><strong>This handler is API-wide, and deliberately placed where
     * {@code MethodArgumentNotValidException} still wins for request bodies.</strong>
     * {@code MethodArgumentNotValidException} is a subclass of
     * {@link BindException}, and Spring resolves the <em>most specific</em>
     * matching handler, so the body handler above keeps its own (identical, but
     * independently documented) path. Covering the supertype here means every
     * later domain's query/form binding inherits a correct {@code 400} rather
     * than discovering this as a {@code 500}.
     */
    @ExceptionHandler(BindException.class)
    public ResponseEntity<ApiErrorResponse> handleBinding(BindException ex, HttpServletRequest request) {
        List<ApiErrorResponse.FieldErrorDetail> fieldErrors = ex.getFieldErrors().stream()
                .map(fe -> new ApiErrorResponse.FieldErrorDetail(fe.getField(), fe.getDefaultMessage()))
                .toList();
        ApiErrorResponse body = new ApiErrorResponse(
                now(), HttpStatus.BAD_REQUEST.value(), "VALIDATION_ERROR",
                "One or more fields failed validation.", request.getRequestURI(), fieldErrors);
        return ResponseEntity.badRequest().body(body);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleUnreadable(
            HttpMessageNotReadableException ex, HttpServletRequest request) {
        ApiErrorResponse body = new ApiErrorResponse(
                now(), HttpStatus.BAD_REQUEST.value(), "VALIDATION_ERROR",
                "The request body is missing or malformed.", request.getRequestURI(), null);
        return ResponseEntity.badRequest().body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(Exception ex, HttpServletRequest request) {
        log.error("Unexpected error handling {} {}", request.getMethod(), request.getRequestURI(), ex);
        ApiErrorResponse body = new ApiErrorResponse(
                now(), HttpStatus.INTERNAL_SERVER_ERROR.value(), "INTERNAL_ERROR",
                "An unexpected error occurred. Please try again later.", request.getRequestURI(), null);
        return ResponseEntity.internalServerError().body(body);
    }

    private static OffsetDateTime now() {
        return OffsetDateTime.now(ZoneOffset.UTC);
    }
}
