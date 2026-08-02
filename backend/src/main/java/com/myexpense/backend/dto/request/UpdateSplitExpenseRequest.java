package com.myexpense.backend.dto.request;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code PUT /api/v1/split-expenses/{id}} (api-overview.md §9.4,
 * ADR 0028 §6.2) — <strong>the full editable state</strong>. PUT, not PATCH:
 * amount, payers and participants are coupled by two exact-sum rules, so a
 * partial body could not be validated on its own.
 *
 * <p>Every editable field carries create's own constraints
 * ({@link CreateSplitExpenseRequest}); the payer and participant rules are
 * create's, unchanged (ADR 0025 R1-R7, the participant sum).
 *
 * <h2>The U1 fields</h2>
 *
 * <p>{@code splitMode}, {@code groupId}, {@code individualCounterpartContactId(s)},
 * {@code addToPersonalExpenses}, {@code personalTransactionId} and {@code id}
 * are <strong>declared so U1 is explicit</strong> rather than depending on
 * Jackson's unknown-property setting (ADR 0028 §6.2). Any of them non-null is
 * {@code 400 VALIDATION_ERROR} ({@code fieldNotEditable}); their types are
 * deliberately loose ({@link Object}) so a wrong-typed value is still answered
 * with U1's message rather than a parse error.
 *
 * <p>{@code categoryId}: absent or {@code null} = unchanged. Only the creator may
 * change it (U2).
 */
public record UpdateSplitExpenseRequest(

        @NotBlank
        @Size(max = 255)
        String title,

        UUID categoryId,

        @NotNull
        LocalDate splitDate,

        @NotNull
        @DecimalMin(value = "0", inclusive = false)
        @Digits(integer = 10, fraction = 2)
        BigDecimal amount,

        @NotBlank
        @Pattern(regexp = "equally|unequally|percentage|shares|adjustment",
                message = "must be one of 'equally', 'unequally', 'percentage', 'shares', 'adjustment'")
        String splitMethod,

        UUID paidByUserId,

        UUID paidByContactId,

        @Size(min = 1, max = 50)
        List<@NotNull @Valid SplitPayerRequest> payers,

        @NotEmpty
        @Size(max = 50)
        List<@NotNull @Valid SplitParticipantRequest> participants,

        // ---- U1: present only to be rejected when non-null ----
        Object splitMode,
        Object groupId,
        Object individualCounterpartContactId,
        Object individualCounterpartContactIds,
        Object addToPersonalExpenses,
        Object personalTransactionId,
        Object id) {

    /**
     * The first U1 field sent non-null, by its API name, or {@code null} when
     * none was. The order is ADR 0028 §6.2's.
     */
    public String firstImmutableFieldPresent() {
        if (splitMode != null) {
            return "splitMode";
        }
        if (groupId != null) {
            return "groupId";
        }
        if (individualCounterpartContactId != null) {
            return "individualCounterpartContactId";
        }
        if (individualCounterpartContactIds != null) {
            return "individualCounterpartContactIds";
        }
        if (addToPersonalExpenses != null) {
            return "addToPersonalExpenses";
        }
        if (personalTransactionId != null) {
            return "personalTransactionId";
        }
        if (id != null) {
            return "id";
        }
        return null;
    }
}
