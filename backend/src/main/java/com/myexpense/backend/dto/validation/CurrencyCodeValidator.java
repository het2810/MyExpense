package com.myexpense.backend.dto.validation;

import java.util.Currency;
import java.util.Locale;
import java.util.regex.Pattern;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Validates the ISO 4217 code list using the JDK's own {@link Currency}
 * registry — no new dependency, and no hand-maintained list of codes that
 * would drift (constitution §21: the standard library already solves this).
 */
public class CurrencyCodeValidator implements ConstraintValidator<CurrencyCode, String> {

    private static final Pattern THREE_LETTERS = Pattern.compile("^[A-Za-z]{3}$");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            // Optional field on a partial update — absence is not a violation.
            return true;
        }
        if (!THREE_LETTERS.matcher(value).matches()) {
            return false;
        }
        try {
            Currency.getInstance(value.toUpperCase(Locale.ROOT));
            return true;
        } catch (IllegalArgumentException notACurrency) {
            return false;
        }
    }
}
