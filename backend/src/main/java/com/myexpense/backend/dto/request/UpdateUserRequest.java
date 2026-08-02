package com.myexpense.backend.dto.request;

import com.myexpense.backend.dto.validation.CurrencyCode;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code PATCH /api/v1/users/me} (api-overview.md §2.2) —
 * a partial update: every field is optional and an omitted field leaves the
 * stored value unchanged.
 *
 * <p><strong>Why this one DTO is a class and not a record, unlike every
 * other request DTO in this project.</strong> {@code phone} has three
 * distinct client intents, not two:
 *
 * <ul>
 *   <li>field omitted → leave the stored phone number alone;</li>
 *   <li>{@code "phone": null} → explicitly clear the stored phone number;</li>
 *   <li>{@code "phone": "+919876543210"} → set it.</li>
 * </ul>
 *
 * <p>A record component collapses the first two into a single {@code null}
 * and cannot tell them apart. The options considered were {@code
 * Optional<String>} components (rejected: Jackson resolves both a missing
 * creator property and an explicit JSON null to {@code Optional.empty()},
 * so it does not actually distinguish them), a custom generic wrapper plus a
 * Jackson deserializer (rejected: meaningful custom-deserializer machinery
 * for one field, constitution §3.2), and this — a plain mutable bean whose
 * setters record that they were called. Jackson invokes a setter only for a
 * property that is physically present in the JSON, so {@code hasPhone()} is
 * exactly "the client sent a {@code phone} key", independent of its value.
 * No framework extension points, nothing to keep in sync with a Jackson
 * version.
 *
 * <p>The presence flags are deliberately exposed as {@code hasXxx()} rather
 * than {@code isXxxProvided()}: {@code has} is not a JavaBean accessor
 * prefix, so Jackson never sees these as bindable properties and a client
 * cannot try to set them.
 *
 * <p>Semantics per field, applied by {@code UserService}:
 * <ul>
 *   <li>{@code phone} — nullable; {@code null} clears it (contract, §2.2).</li>
 *   <li>{@code firstName}/{@code lastName}/{@code defaultCurrencyCode} — back
 *       {@code NOT NULL} columns, so there is no "clear" intent to express;
 *       an explicit {@code null} is treated exactly like omission.</li>
 * </ul>
 *
 * <p>Fields this API does not support (notably {@code email} — explicitly
 * not changeable in this phase, §2.2) are simply ignored if sent; they are
 * never read, so they can never be applied.
 */
public class UpdateUserRequest {

    /** At least one non-whitespace character. Applied only when the field is present. */
    private static final String NOT_BLANK_PATTERN = ".*\\S.*";

    /** E.164: '+' then a non-zero country-code digit then 6–14 more digits (7–15 digits total, max 16 chars). */
    private static final String E164_PATTERN = "^\\+[1-9]\\d{6,14}$";

    @Size(max = 100)
    @Pattern(regexp = NOT_BLANK_PATTERN, message = "must not be blank")
    private String firstName;

    @Size(max = 100)
    @Pattern(regexp = NOT_BLANK_PATTERN, message = "must not be blank")
    private String lastName;

    @Pattern(regexp = E164_PATTERN, message = "must be in E.164 format, e.g. +919876543210")
    private String phone;

    @CurrencyCode
    private String defaultCurrencyCode;

    private boolean firstNamePresent;
    private boolean lastNamePresent;
    private boolean phonePresent;
    private boolean defaultCurrencyCodePresent;

    public String getFirstName() {
        return firstName;
    }

    public void setFirstName(String firstName) {
        this.firstName = firstName;
        this.firstNamePresent = true;
    }

    public String getLastName() {
        return lastName;
    }

    public void setLastName(String lastName) {
        this.lastName = lastName;
        this.lastNamePresent = true;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
        this.phonePresent = true;
    }

    public String getDefaultCurrencyCode() {
        return defaultCurrencyCode;
    }

    public void setDefaultCurrencyCode(String defaultCurrencyCode) {
        this.defaultCurrencyCode = defaultCurrencyCode;
        this.defaultCurrencyCodePresent = true;
    }

    public boolean hasFirstName() {
        return firstNamePresent;
    }

    public boolean hasLastName() {
        return lastNamePresent;
    }

    /** {@code true} when the client sent a {@code phone} key at all — including {@code "phone": null}. */
    public boolean hasPhone() {
        return phonePresent;
    }

    public boolean hasDefaultCurrencyCode() {
        return defaultCurrencyCodePresent;
    }
}
