package com.myexpense.backend.dto.validation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

/**
 * "ISO 4217 3-letter code" (docs/api/api-overview.md §2.2), enforced as a real
 * constraint rather than a shape-only regex: a 3-letter string that isn't an
 * actual currency (e.g. {@code "ZZZ"}) is rejected too. Case-insensitive —
 * the service uppercases before comparing/storing.
 *
 * <p>Null is considered valid here, since {@code defaultCurrencyCode} is
 * optional on a partial update — presence is the DTO's concern, not this
 * validator's (same convention {@link PasswordComplexity} already uses).
 *
 * <p>{@code @Target} includes {@code FIELD}/{@code METHOD}/{@code PARAMETER}
 * so it works on a record component as well as a plain field.
 */
@Documented
@Constraint(validatedBy = CurrencyCodeValidator.class)
@Target({ ElementType.FIELD, ElementType.METHOD, ElementType.PARAMETER, ElementType.ANNOTATION_TYPE })
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrencyCode {

    String message() default "must be a valid ISO 4217 3-letter currency code";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
