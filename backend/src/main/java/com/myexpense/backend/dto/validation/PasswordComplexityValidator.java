package com.myexpense.backend.dto.validation;

import java.util.regex.Pattern;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class PasswordComplexityValidator implements ConstraintValidator<PasswordComplexity, String> {

    // Min 8 chars, at least one lowercase, one uppercase, one digit.
    // Max length capped at 100 defensively: BCrypt only uses the first 72
    // bytes of its input, so an unbounded password length would silently
    // truncate rather than fail — capping well below that avoids the
    // ambiguity while still comfortably exceeding any reasonable passphrase.
    private static final Pattern PATTERN = Pattern.compile("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,100}$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null || value.isEmpty()) {
            // Presence is @NotBlank's responsibility, not this validator's.
            return true;
        }
        return PATTERN.matcher(value).matches();
    }
}
