package com.myexpense.backend.service;

/**
 * Outbound transactional email for the auth flows. No real email provider
 * has been evaluated/approved yet (unlike SMS in ADR 0015, which went
 * through its own design pass) — deliberately kept behind this interface so
 * a real provider can be swapped in later (e.g. an SES/SendGrid-backed
 * implementation) without touching {@code AuthService}. See
 * {@link LoggingEmailService} for the Phase 1 stub implementation actually
 * wired in.
 */
public interface EmailService {

    void sendVerificationEmail(String toEmail, String firstName, String verificationToken);

    void sendPasswordResetEmail(String toEmail, String firstName, String resetToken);
}
