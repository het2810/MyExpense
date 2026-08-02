package com.myexpense.backend.dto.request;

import java.math.BigDecimal;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code PATCH /api/v1/categories/{id}} (api-overview.md
 * §3.3) — a partial update: every field is optional and an omitted field
 * leaves the stored value unchanged.
 *
 * <p><strong>This is a class rather than a record for exactly one reason, and
 * it is the same reason {@link UpdateUserRequest} is</strong> — read that
 * DTO's Javadoc first; the mechanism is copied from it verbatim rather than
 * re-invented (constitution §25, and backend/README.md §11.7's explicit
 * instruction to do so). {@code monthlyCap} has three distinct client
 * intents, not two:
 *
 * <ul>
 *   <li>field omitted → leave the stored cap alone;</li>
 *   <li>{@code "monthlyCap": null} → explicitly clear the cap (contract,
 *       §3.3: "null explicitly clears the cap");</li>
 *   <li>{@code "monthlyCap": 3000.00} → set it.</li>
 * </ul>
 *
 * <p>A record component collapses the first two into a single {@code null}
 * and cannot tell them apart; {@code Optional<BigDecimal>} does not help,
 * because Jackson resolves both a missing creator property and an explicit
 * JSON null to {@code Optional.empty()}. So this is a plain mutable bean
 * whose setters record that they were called — Jackson invokes a setter only
 * for a property physically present in the JSON, which makes
 * {@link #hasMonthlyCap()} exactly "the client sent a {@code monthlyCap}
 * key", independent of its value.
 *
 * <p>The presence flags are exposed as {@code hasXxx()} rather than
 * {@code isXxxProvided()} on purpose: {@code has} is not a JavaBean accessor
 * prefix, so Jackson never treats them as bindable properties and a client
 * cannot try to set them.
 *
 * <p>Semantics per field, applied by {@code CategoryService}:
 * <ul>
 *   <li>{@code monthlyCap} — nullable; {@code null} clears it. <strong>A
 *       non-null value on a row that has a parent is a
 *       {@code 400 VALIDATION_ERROR}</strong> (ADR 0019 §4, api-overview.md
 *       §3.3): caps are top-level-only. An explicit {@code null} on a
 *       subcategory stays legal — it clears a cap the row could not have had,
 *       which is a harmless no-op rather than an error worth inventing.</li>
 *   <li>{@code name}/{@code iconName}/{@code glyph} — back {@code NOT NULL}
 *       columns, so there is no "clear" intent to express; an explicit
 *       {@code null} is treated exactly like omission, the same lenient rule
 *       Domain 2 already applies to {@code firstName}/{@code lastName}. All
 *       three work on <em>either</em> level: a subcategory is renamed,
 *       re-iconed and re-glyphed exactly like a top-level category.</li>
 * </ul>
 *
 * <p><strong>{@code parentCategoryId} is deliberately NOT a field here, and
 * must not become one</strong> (ADR 0019 §9, api-overview.md §3.3). A row's
 * level is <strong>fixed at creation</strong>: there is no move, no promote
 * and no demote in this round, because each case drags in a different
 * cross-field rule (a demotion must not create a second level; a demotion must
 * clear a {@code monthly_cap} the schema forbids on a child; either direction
 * can collide with a name in the destination). That is a small design pass,
 * not a field.
 *
 * <p>The refusal is <em>structural</em>, which is stronger than a check: there
 * is no property to bind, so a {@code "parentCategoryId"} key in the body is
 * ignored exactly as any other unknown field is (the API-wide behaviour
 * recorded in backend/README.md §11.8), and no code path in
 * {@code CategoryService} can write that column on update —
 * {@code Category.parentCategoryId} is additionally mapped
 * {@code updatable = false}. A reparent is therefore impossible rather than
 * merely rejected. <strong>Flagged:</strong> api-overview.md §3.3's error
 * table defines no error code for "a parent change was attempted", so this
 * implementation does not invent one; if a loud {@code 400} is wanted instead
 * of a silent no-op, that is a contract addition for the System Architect.
 *
 * <p>{@code isDefault}, {@code id}, {@code userId}, {@code createdAt} and
 * {@code updatedAt} are not fields here and are never client-settable — they
 * are server-owned. Sending them is ignored, because nothing reads them.
 */
public class UpdateCategoryRequest {

    /** At least one non-whitespace character. Applied only when the field is present. */
    private static final String NOT_BLANK_PATTERN = ".*\\S.*";

    @Size(max = 100)
    @Pattern(regexp = NOT_BLANK_PATTERN, message = "must not be blank")
    private String name;

    @Size(max = 100)
    @Pattern(regexp = NOT_BLANK_PATTERN, message = "must not be blank")
    private String iconName;

    @Size(min = 1, max = 2)
    @Pattern(regexp = NOT_BLANK_PATTERN, message = "must not be blank")
    private String glyph;

    /** Same constraints as on create — "> 0 if present", two decimal places, numeric(12,2)-shaped. */
    @DecimalMin(value = "0", inclusive = false)
    @Digits(integer = 10, fraction = 2)
    private BigDecimal monthlyCap;

    private boolean namePresent;
    private boolean iconNamePresent;
    private boolean glyphPresent;
    private boolean monthlyCapPresent;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
        this.namePresent = true;
    }

    public String getIconName() {
        return iconName;
    }

    public void setIconName(String iconName) {
        this.iconName = iconName;
        this.iconNamePresent = true;
    }

    public String getGlyph() {
        return glyph;
    }

    public void setGlyph(String glyph) {
        this.glyph = glyph;
        this.glyphPresent = true;
    }

    public BigDecimal getMonthlyCap() {
        return monthlyCap;
    }

    public void setMonthlyCap(BigDecimal monthlyCap) {
        this.monthlyCap = monthlyCap;
        this.monthlyCapPresent = true;
    }

    public boolean hasName() {
        return namePresent;
    }

    public boolean hasIconName() {
        return iconNamePresent;
    }

    public boolean hasGlyph() {
        return glyphPresent;
    }

    /**
     * {@code true} when the client sent a {@code monthlyCap} key at all —
     * including {@code "monthlyCap": null}, which is the contract's way of
     * saying "clear the cap".
     */
    public boolean hasMonthlyCap() {
        return monthlyCapPresent;
    }
}
