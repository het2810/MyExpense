package com.myexpense.backend.service;

import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.UpdatePremiumRequest;
import com.myexpense.backend.dto.request.UpdateUserRequest;
import com.myexpense.backend.dto.response.UserProfileResponse;
import com.myexpense.backend.entity.User;
import com.myexpense.backend.exception.PhoneAlreadyExistsException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.UserRepository;

/**
 * Business rules for the caller's own profile (api-overview.md §2.1, §2.2,
 * §2.5).
 *
 * <p>Every method takes the authenticated {@code userId} as its first
 * parameter and scopes every read and write to it. There is no method here
 * that can address another user's row — the id is resolved from the JWT by
 * {@code @CurrentUserId} in the controller and passed straight through
 * (security-architecture.md §2).
 *
 * <p><strong>No {@code noRollbackFor} anywhere in this class, deliberately.</strong>
 * backend/README.md §3 records how that trap silently broke account lockout
 * and token-family revocation in Domain 1: a method that writes and
 * <em>then</em> throws needs the rollback suppressed on every transactional
 * boundary. Nothing in this domain does that — every rejection
 * ({@code PHONE_ALREADY_EXISTS}, {@code UNAUTHORIZED}) is decided
 * <em>before</em> any field is mutated, and a rollback is exactly the
 * behaviour wanted if one is thrown. The update method is written in two
 * explicit phases — resolve/authorize everything first, apply afterwards —
 * so that stays true as fields are added.
 *
 * <p><strong>There is no premium gate in this class as of 2026-10-02.</strong>
 * {@code defaultCurrencyCode} used to be gated on {@code users.is_premium}
 * with a {@code 403 PREMIUM_REQUIRED}; the Project Owner reversed that — the
 * currency selector is free (api-overview.md §2.2,
 * docs/decisions/0017-per-currency-balances-and-partial-settlement.md §1).
 * {@code PATCH /users/me} now has no 403 response at all. The
 * never-trust-a-client-supplied-premium-flag rule
 * (security-architecture.md §2) is unchanged and still governs
 * {@link #updatePremium}: premium is read from, and written to, the stored
 * column only.
 */
@Service
public class UserService {

    private static final Logger log = LoggerFactory.getLogger(UserService.class);

    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    /** {@code GET /api/v1/users/me}. */
    @Transactional(readOnly = true)
    public UserProfileResponse getCurrentUser(UUID userId) {
        return toProfileResponse(requireUser(userId));
    }

    /** {@code PATCH /api/v1/users/me} — partial update. */
    @Transactional
    public UserProfileResponse updateCurrentUser(UUID userId, UpdateUserRequest request) {
        User user = requireUser(userId);

        // ---------------------------------------------------------------
        // Phase 1 — resolve each requested change and reject anything not
        // allowed. Nothing is mutated in this phase.
        // ---------------------------------------------------------------
        String newFirstName = null;
        if (request.hasFirstName() && request.getFirstName() != null) {
            newFirstName = request.getFirstName().trim();
        }

        String newLastName = null;
        if (request.hasLastName() && request.getLastName() != null) {
            newLastName = request.getLastName().trim();
        }

        // No premium gate — removed 2026-10-02 (api-overview.md §2.2,
        // docs/decisions/0017-per-currency-balances-and-partial-settlement.md
        // §1): the currency selector is FREE, so any authenticated user may
        // change their own account currency. ISO 4217 validation is unchanged
        // and still rejects a non-currency with 400 VALIDATION_ERROR
        // (@CurrencyCode on the DTO). The stored code is a DISPLAY-SYMBOL
        // PREFERENCE ONLY: changing it converts nothing, recalculates nothing
        // and re-denominates nothing — no stored amount is touched here, and
        // deliberately so.
        String newCurrencyCode = null;
        if (request.hasDefaultCurrencyCode() && request.getDefaultCurrencyCode() != null) {
            String requestedCurrencyCode = request.getDefaultCurrencyCode().toUpperCase(Locale.ROOT);
            // Submitting the value the account already has is simply not a
            // change, so no write is issued for it.
            if (!requestedCurrencyCode.equals(user.getDefaultCurrencyCode())) {
                newCurrencyCode = requestedCurrencyCode;
            }
        }

        // hasPhone() is true even for an explicit "phone": null, which is how
        // the contract expresses "clear it" (api-overview.md §2.2).
        boolean phoneChanging = false;
        String newPhone = null;
        if (request.hasPhone()) {
            newPhone = request.getPhone();
            phoneChanging = !Objects.equals(newPhone, user.getPhone());
            if (phoneChanging && newPhone != null && userRepository.existsByPhoneAndIdNot(newPhone, user.getId())) {
                throw new PhoneAlreadyExistsException();
            }
        }

        // ---------------------------------------------------------------
        // Phase 2 — apply.
        // ---------------------------------------------------------------
        if (newFirstName != null) {
            user.setFirstName(newFirstName);
        }
        if (newLastName != null) {
            user.setLastName(newLastName);
        }
        if (newCurrencyCode != null) {
            user.setDefaultCurrencyCode(newCurrencyCode);
        }
        if (phoneChanging) {
            user.setPhone(newPhone);
        }

        User saved = persist(user, phoneChanging && newPhone != null);
        // Field names only — never the values (a phone number is personal
        // data, constitution §23).
        log.info("Profile updated for user {} (firstName={}, lastName={}, phone={}, defaultCurrencyCode={})",
                saved.getId(), newFirstName != null, newLastName != null, phoneChanging, newCurrencyCode != null);
        return toProfileResponse(saved);
    }

    /** {@code PATCH /api/v1/users/me/premium} — boolean stub, no billing (api-overview.md §2.5). */
    @Transactional
    public UserProfileResponse updatePremium(UUID userId, UpdatePremiumRequest request) {
        User user = requireUser(userId);
        user.setPremium(request.isPremium());

        User saved = userRepository.saveAndFlush(user);
        log.info("Premium flag set to {} for user {}", saved.isPremium(), saved.getId());
        return toProfileResponse(saved);
    }

    /**
     * Flushes inside the transaction so a unique-constraint violation
     * surfaces here rather than at commit, where it could no longer be
     * mapped onto a meaningful status code.
     *
     * <p>{@code uq_users_phone} is the actual guarantee; the
     * {@code existsByPhoneAndIdNot} pre-check above is only the friendly
     * path. Two requests claiming the same number at the same moment can
     * both pass that check, and the loser must still get the contract's 409
     * rather than a 500.
     */
    private User persist(User user, boolean phoneAssigned) {
        try {
            return userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException ex) {
            if (phoneAssigned) {
                throw new PhoneAlreadyExistsException();
            }
            throw ex;
        }
    }

    private User requireUser(UUID userId) {
        if (userId == null) {
            throw new UnauthorizedException();
        }
        return userRepository.findById(userId).orElseThrow(UnauthorizedException::new);
    }

    private UserProfileResponse toProfileResponse(User user) {
        return new UserProfileResponse(
                user.getId(),
                user.getEmail(),
                user.getPhone(),
                user.getFirstName(),
                user.getLastName(),
                user.isEmailVerified(),
                user.isPremium(),
                user.getDefaultCurrencyCode(),
                user.getCreatedAt());
    }
}
