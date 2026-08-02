package com.myexpense.backend.dto.response;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * {@code ActivityResponse} (api-overview.md §11.1) — one entry of the caller's
 * global Activities feed, returned inside a {@link PageResponse}.
 *
 * <p>Never the {@code Activity} entity: {@code userId} must not cross the API
 * boundary (every row in a response already belongs to the caller by
 * construction, so echoing an owner id would only invite a client to start
 * sending one back), and {@code updatedAt} is deliberately absent because
 * <strong>an activity row is immutable</strong> — it would be a second, always
 * identical copy of {@code createdAt} for the life of every row ({@code V13}:
 * "an audit trail that can be rewritten is not an audit trail").
 *
 * <h2>The three-part sentence</h2>
 *
 * <p>{@code descriptionPrefix} + {@code entityName} + {@code descriptionSuffix}
 * is ADR 0008 §1.2's shape: {@code entityName} renders in the accent colour and
 * the other two are plain. <strong>Plain concatenation always reconstructs the
 * full sentence</strong>, which is why there is no redundant flat
 * {@code description} field (constitution §25).
 *
 * <ul>
 *   <li>{@code entityName} is {@code null} when the entry has no single entity
 *       to highlight — a normal, common state, not a missing value. It is never
 *       blank ({@code chk_activities_entity_name_not_blank}).</li>
 *   <li>{@code descriptionSuffix} is <strong>{@code ""} whenever
 *       {@code entityName} is null</strong>, and that empty string is the normal
 *       case rather than a defect. A client must not treat it as missing.</li>
 *   <li>{@code descriptionPrefix} is <strong>the complete sentence</strong> when
 *       {@code entityName} is null.</li>
 * </ul>
 *
 * <h2>The four {@code related_*} ids are navigation only</h2>
 *
 * <p>{@code entityName}, {@code iconName}, {@code glyph} and {@code tone} are
 * snapshots frozen at fan-out time, and they are what render the row. The four
 * ids are for navigation and for §11.1's four filters — <strong>never for a
 * lookup needed to display the entry</strong> ({@code V13} contract item 7: a
 * page of twenty entries is one query, with no join to
 * {@code transactions}/{@code groups}/{@code contacts}/{@code split_expenses}).
 *
 * <p>Each is independently nullable, each is {@code ON DELETE SET NULL}, and
 * <strong>a null id does not make the row less readable</strong> — that is
 * exactly what the snapshot columns are for. A client must therefore render
 * every entry and treat the ids as "tappable if present".
 *
 * <p>There is <strong>no {@code relatedSettlementId}</strong> ({@code V13}
 * FLAG 1): §5.1 lists four {@code related_*} columns and §11.1 exposes those
 * same four, so a fifth is not invented here. The known consequence is that a
 * {@code settlement} entry points at its group or contact and not at the
 * settlement row itself.
 *
 * <h2>No amount and no currency anywhere in this shape</h2>
 *
 * <p>Deliberate, and a property of the whole domain rather than of this type:
 * every figure a user reads in the feed has already been rendered into the
 * sentence by the service that wrote the row, including its currency symbol
 * ({@code V13}: "this domain stores sentences, not amounts"). A numeric field
 * here would be a second copy of a number whose authoritative home is
 * {@code transactions}, {@code split_expenses} or {@code settlements}
 * (constitution §17). The recorded cost: the symbol is frozen at write time and
 * does <strong>not</strong> re-render if the user later switches currency.
 */
public record ActivityResponse(
        UUID id,

        /*
         * 'transaction_edited' | 'split_saved' | 'group_created' | 'settlement'
         * — an EXTENSIBLE union (ADR 0008 §1), returned verbatim. A client must
         * tolerate a value it does not know rather than switch exhaustively on
         * it; nothing in this schema or this API constrains the set.
         */
        String type,

        LocalDate activityDate,

        /*
         * "HH:mm" (api-overview.md §11.1), formatted explicitly in the service
         * rather than left to a Jackson date format — the same decision, for
         * the same reason, as TransactionResponse#txnTime: LocalTime's own
         * serialization emits "HH:mm:ss" whenever seconds are non-zero, and the
         * fan-out writes a wall-clock instant whose seconds almost never are.
         * A String here makes the wire shape unconditional and independent of
         * any Jackson configuration.
         *
         * V13 FLAG 2 records what this value is and is not: TIME carries no
         * zone and cannot be re-zoned, and — unlike transactions.txn_time — it
         * is NOT a reading from the user's own device. It is the instant the
         * SERVER composed the fan-out, in the server's zone (UTC, as
         * ActivityFanoutService computes it), so a member in another timezone
         * reads a time that is not theirs. createdAt is the only field here
         * that could ever be rendered correctly for a second timezone.
         */
        String activityTime,

        String descriptionPrefix,
        String entityName,
        String descriptionSuffix,
        UUID relatedTransactionId,
        UUID relatedGroupId,
        UUID relatedContactId,
        UUID relatedSplitExpenseId,
        String iconName,
        String glyph,

        /*
         * The IconBadge tone vocabulary (ADR 0008 §1's six values) — a
         * presentation value with no CHECK behind it, returned verbatim.
         */
        String tone,

        OffsetDateTime createdAt,

        /*
         * ADR 0027 §6.5 (additive): the change_log entry this row explains, so
         * the feed can open its field-level detail via GET /change-log/{id}.
         * Null on other members' fanned-out rows and on pre-V18 rows.
         */
        UUID relatedChangeLogId) {
}
