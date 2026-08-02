package com.myexpense.backend.controller;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.myexpense.backend.dto.request.ForgotPasswordRequest;
import com.myexpense.backend.dto.request.LoginRequest;
import com.myexpense.backend.dto.request.LogoutRequest;
import com.myexpense.backend.dto.request.RefreshTokenRequest;
import com.myexpense.backend.dto.request.RegisterRequest;
import com.myexpense.backend.dto.request.ResendVerificationRequest;
import com.myexpense.backend.dto.request.ResetPasswordRequest;
import com.myexpense.backend.dto.request.VerifyEmailRequest;
import com.myexpense.backend.dto.response.AuthResponse;
import com.myexpense.backend.dto.response.MessageResponse;
import com.myexpense.backend.dto.response.UserResponse;
import com.myexpense.backend.service.AuthService;

import jakarta.validation.Valid;

/**
 * HTTP layer only — request/response shapes, status codes, routing. Every
 * business rule (lockout, token rotation, anti-enumeration, rate limiting)
 * lives in {@link AuthService}. Implements the 8 endpoints exactly as
 * contracted in docs/api/authentication-api.md.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public ResponseEntity<UserResponse> register(@Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(authService.register(request));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok(authService.login(request));
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(@Valid @RequestBody RefreshTokenRequest request) {
        return ResponseEntity.ok(authService.refresh(request));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
            @AuthenticationPrincipal UUID userId, @Valid @RequestBody LogoutRequest request) {
        authService.logout(userId, request);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<MessageResponse> forgotPassword(@Valid @RequestBody ForgotPasswordRequest request) {
        return ResponseEntity.ok(authService.forgotPassword(request));
    }

    @PostMapping("/reset-password")
    public ResponseEntity<MessageResponse> resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        return ResponseEntity.ok(authService.resetPassword(request));
    }

    @PostMapping("/verify-email")
    public ResponseEntity<MessageResponse> verifyEmail(@Valid @RequestBody VerifyEmailRequest request) {
        return ResponseEntity.ok(authService.verifyEmail(request));
    }

    @PostMapping("/resend-verification")
    public ResponseEntity<MessageResponse> resendVerification(
            @Valid @RequestBody ResendVerificationRequest request) {
        return ResponseEntity.ok(authService.resendVerification(request));
    }
}
