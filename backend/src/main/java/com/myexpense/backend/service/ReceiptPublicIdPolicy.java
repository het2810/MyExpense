package com.myexpense.backend.service;

import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.myexpense.backend.exception.TransactionRuleViolationException;

/**
 * The <strong>claim check</strong> for {@code receiptPublicId} — the only
 * server-side validation of that field, and the one that matters
 * (docs/decisions/0020-receipt-upload-cloudinary-signed-direct.md §3,
 * docs/api/api-overview.md §4.2 rule 3).
 *
 * <p>A submitted reference must match the configured root <strong>and carry the
 * authenticated principal's own user id</strong> in its {@code {userId}}
 * segment. Anything else is {@code 400 VALIDATION_ERROR}. That one structural
 * property is what makes a stolen or guessed reference unusable: a
 * {@code public_id} on its own grants nothing, and the only route from a stored
 * reference to readable bytes runs through a row the caller owns.
 *
 * <p><strong>Existence is deliberately NOT verified.</strong> The server does
 * not call Cloudinary to confirm the asset is really there: that would put a
 * third-party round trip on a financial write path, it proves nothing for a
 * write arriving later through {@code /sync/push}, and the failure it would
 * catch is a broken thumbnail on the claimant's <em>own</em> row rather than a
 * security failure (ADR 0020 §3). The security-relevant property is enforced
 * structurally by the check below.
 *
 * <h2>What is NOT implemented yet, and what that means for this class</h2>
 *
 * <p>{@code POST /receipts/upload-signature} — the endpoint that
 * <em>generates</em> these references — is <strong>not built</strong>: the
 * Cloudinary plan's signed-delivery support is unconfirmed and no credentials
 * exist (Project Owner, 2026-10-24). {@code receiptSignedUrl} on
 * {@code GET /transactions/{id}} is not built either. So today the only way to
 * obtain a value this class accepts is to construct one by hand, which is
 * exactly what makes it testable — and the check is implemented now rather than
 * deferred, because a field that accepts an arbitrary client string "until the
 * signing endpoint lands" is precisely the never-trust-client-input failure
 * security-architecture.md §3 exists to prevent.
 *
 * <p>When the signing endpoint lands it <strong>must generate its
 * {@code public_id} from this same bean</strong> ({@link #slotFor(UUID)}), not
 * from its own copy of the format string. One source for the shape means the
 * two halves cannot drift; two copies means a silent mismatch where every
 * legitimately-uploaded receipt is rejected at claim time.
 *
 * <p>{@code app.receipts.public-id-root} carries a default
 * ({@code myexpense}) because it is a folder name, <strong>not a secret</strong>
 * — unlike {@code CLOUDINARY_API_SECRET}, which when it exists must follow
 * {@code JWT_SECRET}/{@code DB_PASSWORD} and have no default at all
 * (security-architecture.md §6). Nothing in this class reads a credential.
 */
@Component
public class ReceiptPublicIdPolicy {

    /** The fixed middle segment of every receipt's path (ADR 0020 §2). */
    private static final String RECEIPTS_SEGMENT = "/receipts/";

    private final String root;

    public ReceiptPublicIdPolicy(@Value("${app.receipts.public-id-root:myexpense}") String root) {
        this.root = root;
    }

    /**
     * The one asset slot a given user's receipts may occupy:
     * {@code {root}/receipts/{userId}/}.
     *
     * <p>{@code userId} comes from the JWT and never from a payload
     * (security-architecture.md §2), which is what confines a replayed
     * signature to one slot in the replayer's own folder.
     */
    public String slotFor(UUID userId) {
        return root + RECEIPTS_SEGMENT + userId + "/";
    }

    /**
     * Throws {@code 400 VALIDATION_ERROR} unless {@code receiptPublicId} is a
     * reference this user may claim.
     *
     * <p>Accepted shape: {@code {root}/receipts/{callerUserId}/{name}}, where
     * {@code name} is a single non-blank path segment — the {@code {uuid}} the
     * signing endpoint will generate. Strict on purpose: no correct client ever
     * sends anything else, because the value only ever echoes a string the
     * server just handed it. Rejecting a deeper path matters specifically — it
     * is what stops a crafted value from pointing at a nested folder the
     * signature was never issued for.
     *
     * <p>The error message deliberately reveals neither the expected shape nor
     * the configured root (constitution §22).
     *
     * @param receiptPublicId must be non-null; callers skip this check entirely
     *                        for an absent or explicitly-null value, since
     *                        clearing a receipt needs no claim
     */
    public void requireClaimableBy(UUID userId, String receiptPublicId) {
        String slot = slotFor(userId);
        if (!receiptPublicId.startsWith(slot)) {
            throw TransactionRuleViolationException.receiptPublicIdNotClaimable();
        }
        String assetName = receiptPublicId.substring(slot.length());
        if (assetName.isBlank() || assetName.contains("/")) {
            throw TransactionRuleViolationException.receiptPublicIdNotClaimable();
        }
    }
}
