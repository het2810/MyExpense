package com.myexpense.backend.dto.request;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request body for {@code PATCH /api/v1/transactions/{id}} (api-overview.md
 * §4.4) — a partial update: every field except {@code version} is optional and
 * an omitted field leaves the stored value unchanged.
 *
 * <p><strong>A class rather than a record for exactly one reason, and it is the
 * same reason {@link UpdateUserRequest} and {@link UpdateCategoryRequest}
 * are</strong> — read {@code UpdateUserRequest}'s Javadoc first; the mechanism
 * is copied from it verbatim rather than re-invented (constitution §25, and
 * backend/README.md §11.7's explicit instruction to do so). Two fields here
 * have three distinct client intents rather than two:
 *
 * <ul>
 *   <li>field omitted → leave the stored value alone;</li>
 *   <li>{@code "notes": null} / {@code "receiptPublicId": null} → explicitly
 *       <strong>clear</strong> it (contract, §4.4: "an absent field leaves the
 *       column unchanged; an explicit null clears it" — §3.3's verified
 *       {@code monthlyCap} convention applied unchanged, so no new convention
 *       is invented and one request object does not end up carrying two);</li>
 *   <li>a value → set it.</li>
 * </ul>
 *
 * <p>A record component collapses the first two into a single {@code null} and
 * cannot tell them apart; {@code Optional<T>} does not help, because Jackson
 * resolves both a missing creator property and an explicit JSON null to
 * {@code Optional.empty()}. So this is a plain mutable bean whose setters
 * record that they were called — Jackson invokes a setter only for a property
 * physically present in the JSON, which makes {@link #hasNotes()} exactly "the
 * client sent a {@code notes} key", independent of its value. The presence
 * flags are exposed as {@code hasXxx()} rather than {@code isXxxProvided()} on
 * purpose: {@code has} is not a JavaBean accessor prefix, so Jackson never
 * treats them as bindable properties and a client cannot try to set them.
 *
 * <h2>Why only those two fields carry presence flags</h2>
 *
 * <p>Every other field here needs only its value, and adding flags it does not
 * need would make the DTO harder to read for no behavioural gain:
 *
 * <ul>
 *   <li>{@code title}, {@code txnDate}, {@code amount}, {@code type},
 *       {@code scope}, {@code paymentMode} back {@code NOT NULL} columns, so
 *       there is no "clear" intent to express — an explicit {@code null} is
 *       treated exactly like omission, the same lenient rule Domains 2 and 3
 *       already apply;</li>
 *   <li>{@code categoryId} is nullable in the database, but "clear the
 *       category" is not a client intent the contract has: an expense must have
 *       one, and an income row's {@code null} is set by the server as part of
 *       the type transition. §4.4's rule is written in terms of a
 *       <em>non-null</em> value ("a non-null {@code categoryId} in the same
 *       request is a 400"), so absent and {@code null} are correctly the same
 *       thing here;</li>
 *   <li>{@code cashAmount}/{@code onlineAmount} are resolved as part of one
 *       cross-field payment-mode rule rather than independently — see
 *       below.</li>
 * </ul>
 *
 * <h2>{@code txnTime} is deliberately absent and must not be added</h2>
 *
 * <p>It is frozen at creation (api-overview.md §4.4, mirroring the frontend's
 * own already-corrected rule), {@code Transaction.txnTime} is mapped
 * {@code updatable = false}, and no code path in {@code TransactionService}
 * writes it on update. So a {@code "txnTime"} key in the body is ignored
 * exactly as any other unknown field is (the API-wide behaviour recorded in
 * backend/README.md §11.8), and the refusal is structural rather than a check
 * someone has to remember — the same shape ADR 0019 §9 chose for reparenting a
 * category.
 *
 * <h2>How {@code paymentMode} / {@code cashAmount} / {@code onlineAmount}
 * interact</h2>
 *
 * <p>{@code TransactionService} computes the <em>effective</em> final state
 * (each field's submitted value, or the stored one if absent) and validates
 * that, rather than validating the three fields independently. Two consequences
 * worth knowing:
 *
 * <ul>
 *   <li>patching {@code amount} alone on a {@code both} transaction is a
 *       {@code 400}, because the stored portions no longer sum to the new
 *       amount — the client must send a consistent triple, which is what keeps
 *       the row's arithmetic true at every instant;</li>
 *   <li>switching away from {@code both} <strong>clears</strong> both portions
 *       server-side; sending a non-null portion alongside a non-{@code both}
 *       mode is a {@code 400}, since the contract's rule is "required
 *       <em>iff</em> {@code paymentMode='both'}" and the database's
 *       {@code chk_transactions_*} constraints say the same.</li>
 * </ul>
 *
 * <h2>Not accepted, same as on create</h2>
 *
 * <p>The five category snapshot fields ({@code categoryName},
 * {@code parentCategoryName}, {@code categoryIconName}, {@code categoryGlyph},
 * {@code categoryTone}) are server-authoritative and must never become request
 * fields (ADR 0018 §3.1, ADR 0019 §5). Nor are {@code clientId} (a record's
 * provenance does not change), {@code splitExpenseId}, {@code deletedAt},
 * {@code id}, {@code userId} or the timestamps.
 */
public class UpdateTransactionRequest {

    /** At least one non-whitespace character. Applied only when the field is present. */
    private static final String NOT_BLANK_PATTERN = ".*\\S.*";

    /**
     * Required (api-overview.md §4.4) — "the version last read by the client".
     * A mismatch against the stored row is {@code 409 VERSION_CONFLICT}.
     *
     * <p>{@link Integer} rather than {@code int} so that an omitted
     * {@code version} is a {@code 400 VALIDATION_ERROR} naming the field,
     * instead of silently defaulting to {@code 0} and becoming an
     * always-conflicting request. Same reasoning as Domain 2's
     * {@code UpdatePremiumRequest}: a missing required value must never be read
     * as a plausible one.
     *
     * <p><strong>Since ADR 0027 §5.3 it is required only in legacy mode</strong>
     * (no {@code X-Client-Updated-At} header). In LWW mode it is optional and not
     * checked. The conditional rule lives in {@code TransactionService}, because
     * the header is not part of this body; an omitted value in legacy mode is
     * still {@code 400 VALIDATION_ERROR}.
     */
    @Min(1)
    private Integer version;

    @Size(max = 255)
    @Pattern(regexp = NOT_BLANK_PATTERN, message = "must not be blank")
    private String title;

    private UUID categoryId;

    private LocalDate txnDate;

    @DecimalMin(value = "0", inclusive = false)
    @Digits(integer = 10, fraction = 2)
    private BigDecimal amount;

    @Pattern(regexp = "expense|income", message = "must be 'expense' or 'income'")
    private String type;

    @Pattern(regexp = "personal|group", message = "must be 'personal' or 'group'")
    private String scope;

    /**
     * The effective value is this field when supplied and the stored
     * {@code group_id} otherwise, and the resulting {@code (scope, groupId)}
     * pair must satisfy §4.2's "required iff {@code scope='group'}". A
     * {@code group} result additionally requires the caller to be a
     * <strong>registered member</strong> of that group, re-derived from
     * {@code group_members} on this request
     * ({@code TransactionService#requireScopeAndGroupAgree}) — so a
     * {@code PATCH} cannot move a transaction into a group the caller is not in,
     * and a non-member's attempt is {@code 403 NOT_GROUP_MEMBER} exactly as on
     * create.
     *
     * <p><strong>Known gap, newly reachable and deliberately not fixed here:
     * there is no way to demote a group transaction back to
     * {@code scope='personal'}.</strong> This field carries no absent-vs-null
     * distinction — §4.4 gives that convention to {@code notes} and
     * {@code receiptPublicId} only — so an explicit {@code null} is
     * indistinguishable from an omission and the stored group id survives,
     * making {@code {"scope": "personal"}} a {@code 400}. Nothing could trip
     * over this before 2026-11-03, because no group-scoped row could exist.
     * Fixing it means either extending the presence-flag convention to this
     * field or defining the demotion explicitly, both of which are contract
     * decisions for the System Architect. Flagged in backend/README.md §13.12.
     */
    private UUID groupId;

    @Pattern(regexp = "cash|online|both", message = "must be 'cash', 'online' or 'both'")
    private String paymentMode;

    /** Non-negative; see {@link CreateTransactionRequest}'s note on why zero is allowed and negatives are not. */
    @DecimalMin(value = "0")
    @Digits(integer = 10, fraction = 2)
    private BigDecimal cashAmount;

    @DecimalMin(value = "0")
    @Digits(integer = 10, fraction = 2)
    private BigDecimal onlineAmount;

    /** No {@code @Size} — the column is uncapped {@code text}; see {@link CreateTransactionRequest#notes()}. */
    private String notes;

    @Size(max = 255)
    private String receiptPublicId;

    private boolean notesPresent;
    private boolean receiptPublicIdPresent;

    public Integer getVersion() {
        return version;
    }

    public void setVersion(Integer version) {
        this.version = version;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public UUID getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(UUID categoryId) {
        this.categoryId = categoryId;
    }

    public LocalDate getTxnDate() {
        return txnDate;
    }

    public void setTxnDate(LocalDate txnDate) {
        this.txnDate = txnDate;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getScope() {
        return scope;
    }

    public void setScope(String scope) {
        this.scope = scope;
    }

    public UUID getGroupId() {
        return groupId;
    }

    public void setGroupId(UUID groupId) {
        this.groupId = groupId;
    }

    public String getPaymentMode() {
        return paymentMode;
    }

    public void setPaymentMode(String paymentMode) {
        this.paymentMode = paymentMode;
    }

    public BigDecimal getCashAmount() {
        return cashAmount;
    }

    public void setCashAmount(BigDecimal cashAmount) {
        this.cashAmount = cashAmount;
    }

    public BigDecimal getOnlineAmount() {
        return onlineAmount;
    }

    public void setOnlineAmount(BigDecimal onlineAmount) {
        this.onlineAmount = onlineAmount;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
        this.notesPresent = true;
    }

    public String getReceiptPublicId() {
        return receiptPublicId;
    }

    public void setReceiptPublicId(String receiptPublicId) {
        this.receiptPublicId = receiptPublicId;
        this.receiptPublicIdPresent = true;
    }

    /**
     * {@code true} when the client sent a {@code notes} key at all — including
     * {@code "notes": null}, which is the contract's way of saying "clear the
     * note".
     */
    public boolean hasNotes() {
        return notesPresent;
    }

    /**
     * {@code true} when the client sent a {@code receiptPublicId} key at all —
     * including {@code "receiptPublicId": null}, which clears the receipt
     * reference (and nothing else: the Cloudinary asset is never destroyed,
     * ADR 0020 §9).
     */
    public boolean hasReceiptPublicId() {
        return receiptPublicIdPresent;
    }
}
