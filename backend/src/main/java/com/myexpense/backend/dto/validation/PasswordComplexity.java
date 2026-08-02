package com.myexpense.backend.dto.validation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

/**
 * The password complexity rule shared by registration and password reset
 * (docs/api/authentication-api.md §1/§6): minimum 8 characters, at least one
 * uppercase letter, one lowercase letter, and one digit. Blank/null values
 * are considered valid here — pair with {@code @NotBlank} for presence.
 *
 * <p>{@code @Target} deliberately includes {@code FIELD}, {@code METHOD}
 * and {@code PARAMETER} so this also works when applied directly to a Java
 * record component, per Bean Validation's record support.
 */
@Documented
@Constraint(validatedBy = PasswordComplexityValidator.class)
@Target({ ElementType.FIELD, ElementType.METHOD, ElementType.PARAMETER, ElementType.ANNOTATION_TYPE })
@Retention(RetentionPolicy.RUNTIME)
public @interface PasswordComplexity {

    String message() default "must be at least 8 characters and include at least one uppercase letter, "
            + "one lowercase letter, and one digit";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
