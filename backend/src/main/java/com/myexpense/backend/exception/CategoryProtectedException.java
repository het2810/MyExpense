package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * {@code 400 CATEGORY_PROTECTED} — the caller addressed their one protected
 * category (the seeded {@code Misc} row, {@code categories.is_protected}) with
 * a write it does not accept (api-overview.md §3.3 and §3.4, ADR 0021 §2.1).
 *
 * <p>Exactly two conditions, and <strong>one error code for both,
 * deliberately</strong> (§3.4's error table: "one condition, one code"):
 * <ul>
 *   <li>{@code DELETE /api/v1/categories/{id}} on the protected row — it is
 *       the reassignment target every <em>other</em> delete depends on, so it
 *       cannot be deleted at any time;</li>
 *   <li>{@code PATCH /api/v1/categories/{id}} sending a {@code name} for the
 *       protected row.</li>
 * </ul>
 *
 * <p><strong>The refusal is per-FIELD, not per-row.</strong> {@code iconName},
 * {@code glyph} and {@code monthlyCap} <em>are</em> accepted on the protected
 * row, and an icon change on it propagates to its transactions exactly like any
 * other category's (ADR 0021 §1.3/§2.1). Only its name and its existence are
 * fixed.
 *
 * <p><strong>{@code 400}, not {@code 403}.</strong> The row exists and belongs
 * to the caller, so this is <em>ineligibility</em>, not an authorization
 * failure — the same test {@link SubcategoryDepthExceededException} applied. And
 * a dedicated code rather than {@code VALIDATION_ERROR} because the client has
 * a specific UI consequence (do not render the affordance at all) and the user
 * needs telling something specific (constitution §22).
 *
 * <p><strong>Decided service-side, BEFORE the write.</strong>
 * {@code V8__categories_misc_fallback.sql}'s
 * {@code trg_categories_enforce_protection} is a backstop against a service bug
 * or a direct SQL write, not the error path: a plpgsql {@code RAISE} carries
 * <strong>no constraint name</strong>, so it cannot be mapped onto this code
 * even in principle, and it correctly surfaces as a logged {@code 500}
 * (that migration's CONTRACT item 3/4). If you ever see a {@code 500} where
 * this {@code 400} belongs, the service check was skipped.
 */
public class CategoryProtectedException extends ApiException {

    private CategoryProtectedException(String message) {
        super(HttpStatus.BAD_REQUEST, "CATEGORY_PROTECTED", message);
    }

    /** {@code DELETE} aimed at the protected row. */
    public static CategoryProtectedException forDelete() {
        return new CategoryProtectedException(
                "This category cannot be deleted. It is the category that other deleted "
                        + "categories' transactions are moved to.");
    }

    /** {@code PATCH} carrying a {@code name} for the protected row. */
    public static CategoryProtectedException forRename() {
        return new CategoryProtectedException(
                "This category cannot be renamed. Its icon, glyph and monthly cap can still "
                        + "be changed.");
    }
}
