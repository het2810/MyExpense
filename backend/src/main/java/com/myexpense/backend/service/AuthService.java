package com.myexpense.backend.service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.config.AccountLockoutProperties;
import com.myexpense.backend.config.VerificationTokenProperties;
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
import com.myexpense.backend.entity.User;
import com.myexpense.backend.entity.UserRole;
import com.myexpense.backend.entity.VerificationToken;
import com.myexpense.backend.entity.VerificationTokenType;
import com.myexpense.backend.exception.AccountLockedException;
import com.myexpense.backend.exception.EmailAlreadyExistsException;
import com.myexpense.backend.exception.InvalidCredentialsException;
import com.myexpense.backend.exception.InvalidRefreshTokenException;
import com.myexpense.backend.exception.RefreshTokenReuseDetectedException;
import com.myexpense.backend.exception.InvalidOrExpiredTokenException;
import com.myexpense.backend.exception.RateLimitExceededException;
import com.myexpense.backend.ratelimit.AuthRateLimitProperties;
import com.myexpense.backend.ratelimit.RateLimiter;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.repository.UserRoleRepository;
import com.myexpense.backend.security.JwtTokenProvider;

/**
 * Orchestrates the 8 auth use cases (docs/api/authentication-api.md).
 * Delegates token issuance/rotation to {@link RefreshTokenService}, reset
 * /verification token handling to {@link VerificationTokenService}, and
 * outbound email to {@link EmailService} — this class owns the business
 * rules that tie those together (lockout, anti-enumeration, rate limiting),
 * not persistence details.
 */
@Service
public class AuthService {

    private static final String USER_ROLE = "USER";
    private static final String DEFAULT_CURRENCY_CODE = "INR";

    // A precomputed BCrypt hash of an arbitrary, unrelated value — not a
    // real credential for any account. Used only so an unknown-email login
    // attempt still pays the cost of a BCrypt comparison, keeping its
    // timing closer to a known-email/wrong-password attempt (defense in
    // depth for the anti-enumeration goal already required elsewhere,
    // docs/architecture/authentication.md §5).
    private static final String DECOY_PASSWORD_HASH =
            "$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5jXHOtF7cqUozWDlOMhFR3f9dRw2K";

    private final UserRepository userRepository;
    private final UserRoleRepository userRoleRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final RefreshTokenService refreshTokenService;
    private final VerificationTokenService verificationTokenService;
    private final EmailService emailService;
    private final RateLimiter rateLimiter;
    private final AuthRateLimitProperties rateLimitProperties;
    private final AccountLockoutProperties lockoutProperties;
    private final VerificationTokenProperties verificationTokenProperties;

    public AuthService(
            UserRepository userRepository,
            UserRoleRepository userRoleRepository,
            PasswordEncoder passwordEncoder,
            JwtTokenProvider jwtTokenProvider,
            RefreshTokenService refreshTokenService,
            VerificationTokenService verificationTokenService,
            EmailService emailService,
            RateLimiter rateLimiter,
            AuthRateLimitProperties rateLimitProperties,
            AccountLockoutProperties lockoutProperties,
            VerificationTokenProperties verificationTokenProperties) {
        this.userRepository = userRepository;
        this.userRoleRepository = userRoleRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenProvider = jwtTokenProvider;
        this.refreshTokenService = refreshTokenService;
        this.verificationTokenService = verificationTokenService;
        this.emailService = emailService;
        this.rateLimiter = rateLimiter;
        this.rateLimitProperties = rateLimitProperties;
        this.lockoutProperties = lockoutProperties;
        this.verificationTokenProperties = verificationTokenProperties;
    }

    @Transactional
    public UserResponse register(RegisterRequest request) {
        String email = normalizeEmail(request.email());
        enforceAccountLimit("register", email, rateLimitProperties.getRegister());

        if (userRepository.existsByEmail(email)) {
            throw new EmailAlreadyExistsException();
        }

        User user = User.builder()
                .id(UUID.randomUUID())
                .email(email)
                .passwordHash(passwordEncoder.encode(request.password()))
                .firstName(request.firstName())
                .lastName(request.lastName())
                .emailVerified(false)
                .premium(false)
                .defaultCurrencyCode(DEFAULT_CURRENCY_CODE)
                .failedLoginAttempts(0)
                .build();
        // Use the instance save() returns, not the one passed in: the id is
        // assigned rather than generated, so Spring Data treats the entity as
        // non-new and merges, returning a *different* managed instance. Only
        // that one carries the @CreationTimestamp-populated createdAt, which
        // the contract requires in the response (authentication-api.md §1).
        // saveAndFlush, not save: the INSERT would otherwise be deferred to
        // commit — i.e. after this method builds its response — leaving the
        // @CreationTimestamp-populated createdAt still null in the returned
        // DTO, which the contract requires (authentication-api.md §1).
        User saved = userRepository.saveAndFlush(user);

        userRoleRepository.save(UserRole.builder().userId(saved.getId()).role(USER_ROLE).build());

        // Category seeding (docs/architecture/data-model.md §2.1) is
        // deliberately NOT done here — the `categories` table doesn't exist
        // yet in this phase (Auth is the only domain being built this
        // round). Flagged explicitly in the handoff report for whoever
        // implements the Categories domain next.

        String verificationToken = verificationTokenService.issue(
                saved.getId(), VerificationTokenType.EMAIL_VERIFICATION,
                verificationTokenProperties.getEmailVerificationTtl());
        emailService.sendVerificationEmail(saved.getEmail(), saved.getFirstName(), verificationToken);

        return toUserResponse(saved, List.of(USER_ROLE));
    }

    // noRollbackFor InvalidCredentialsException: registerFailedAttempt() writes
    // failed_login_attempts (and locked_until once the threshold is hit)
    // immediately before this exception is thrown. Without this, Spring's
    // default rollback-on-RuntimeException undoes that write and the lockout
    // counter never advances past zero — i.e. account lockout silently never
    // triggers (security-architecture.md §5).
    @Transactional(noRollbackFor = InvalidCredentialsException.class)
    public AuthResponse login(LoginRequest request) {
        String email = normalizeEmail(request.email());
        enforceAccountLimit("login", email, rateLimitProperties.getLogin());

        Optional<User> maybeUser = userRepository.findByEmail(email);
        if (maybeUser.isEmpty()) {
            passwordEncoder.matches(request.password(), DECOY_PASSWORD_HASH);
            throw new InvalidCredentialsException();
        }
        User user = maybeUser.get();

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
            throw new AccountLockedException();
        }

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            registerFailedAttempt(user, now);
            throw new InvalidCredentialsException();
        }

        user.setFailedLoginAttempts(0);
        user.setLockedUntil(null);
        userRepository.save(user);

        List<String> roles = userRoleRepository.findRolesByUserId(user.getId());
        String accessToken = jwtTokenProvider.generateAccessToken(user.getId(), roles);
        RefreshTokenService.IssuedToken refreshToken = refreshTokenService.issueNewFamily(user.getId());

        return new AuthResponse(accessToken, refreshToken.rawToken(), "Bearer",
                jwtTokenProvider.getAccessTokenTtlSeconds(), toUserResponse(user, roles));
    }

    // noRollbackFor: rotate() revokes the whole token family before throwing on
    // reuse (and revokes an expired token before throwing). This outer
    // transaction is the one that actually commits, so it needs the same rule —
    // otherwise the revocation is rolled back and a replayed token leaves the
    // rest of its family still usable (docs/architecture/authentication.md §2).
    @Transactional(noRollbackFor = { RefreshTokenReuseDetectedException.class, InvalidRefreshTokenException.class })
    public AuthResponse refresh(RefreshTokenRequest request) {
        RefreshTokenService.RotationResult result = refreshTokenService.rotate(request.refreshToken());
        List<String> roles = userRoleRepository.findRolesByUserId(result.userId());
        String accessToken = jwtTokenProvider.generateAccessToken(result.userId(), roles);

        return new AuthResponse(accessToken, result.issuedToken().rawToken(), "Bearer",
                jwtTokenProvider.getAccessTokenTtlSeconds(), null);
    }

    @Transactional
    public void logout(UUID authenticatedUserId, LogoutRequest request) {
        refreshTokenService.revokeForUserIfOwned(authenticatedUserId, request.refreshToken());
    }

    @Transactional
    public MessageResponse forgotPassword(ForgotPasswordRequest request) {
        String email = normalizeEmail(request.email());
        enforceAccountLimit("forgot-password", email, rateLimitProperties.getForgotPassword());

        userRepository.findByEmail(email).ifPresent(user -> {
            String token = verificationTokenService.issue(
                    user.getId(), VerificationTokenType.PASSWORD_RESET,
                    verificationTokenProperties.getPasswordResetTtl());
            emailService.sendPasswordResetEmail(user.getEmail(), user.getFirstName(), token);
        });

        // Identical response regardless of whether the account exists
        // (docs/architecture/authentication.md §5.1).
        return new MessageResponse("If an account exists for this email, a password reset link has been sent.");
    }

    @Transactional
    public MessageResponse resetPassword(ResetPasswordRequest request) {
        VerificationToken token =
                verificationTokenService.consume(request.token(), VerificationTokenType.PASSWORD_RESET);
        User user = userRepository.findById(token.getUserId()).orElseThrow(InvalidOrExpiredTokenException::new);

        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        userRepository.save(user);

        // Required side effect: every existing refresh token is revoked
        // (docs/architecture/authentication.md §5.2).
        refreshTokenService.revokeAllForUser(user.getId());

        return new MessageResponse("Password has been reset successfully.");
    }

    @Transactional
    public MessageResponse verifyEmail(VerifyEmailRequest request) {
        VerificationToken token =
                verificationTokenService.consume(request.token(), VerificationTokenType.EMAIL_VERIFICATION);
        User user = userRepository.findById(token.getUserId()).orElseThrow(InvalidOrExpiredTokenException::new);

        user.setEmailVerified(true);
        userRepository.save(user);

        return new MessageResponse("Email verified successfully.");
    }

    @Transactional
    public MessageResponse resendVerification(ResendVerificationRequest request) {
        String email = normalizeEmail(request.email());
        enforceAccountLimit("resend-verification", email, rateLimitProperties.getResendVerification());

        userRepository.findByEmail(email)
                .filter(user -> !user.isEmailVerified())
                .ifPresent(user -> {
                    String token = verificationTokenService.issue(
                            user.getId(), VerificationTokenType.EMAIL_VERIFICATION,
                            verificationTokenProperties.getEmailVerificationTtl());
                    emailService.sendVerificationEmail(user.getEmail(), user.getFirstName(), token);
                });

        // Identical response regardless of whether the account exists or is
        // already verified (docs/architecture/authentication.md §5.1).
        return new MessageResponse("If an account exists and is unverified, a verification link has been sent.");
    }

    private void registerFailedAttempt(User user, OffsetDateTime now) {
        int attempts = user.getFailedLoginAttempts() + 1;
        user.setFailedLoginAttempts(attempts);
        if (attempts >= lockoutProperties.getMaxAttempts()) {
            user.setLockedUntil(now.plusMinutes(lockoutProperties.getDurationMinutes()));
        }
        userRepository.save(user);
    }

    private void enforceAccountLimit(String scope, String email, AuthRateLimitProperties.Tier tier) {
        String key = "account:" + scope + ":" + email;
        boolean allowed = rateLimiter.tryConsume(key, tier.getCapacity(), Duration.ofSeconds(tier.getWindowSeconds()));
        if (!allowed) {
            throw new RateLimitExceededException();
        }
    }

    private String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    private UserResponse toUserResponse(User user, List<String> roles) {
        return new UserResponse(user.getId(), user.getEmail(), user.getFirstName(), user.getLastName(),
                user.isEmailVerified(), roles, user.getCreatedAt());
    }
}
