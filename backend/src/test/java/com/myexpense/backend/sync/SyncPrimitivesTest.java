package com.myexpense.backend.sync;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import com.myexpense.backend.dto.response.ApiErrorResponse;
import com.myexpense.backend.entity.ChangeLog;

/**
 * Pure ADR 0027 rules: the §5.2 LWW decision and clock clamp, §6.3's change
 * sets, §4.1's header parsing and §4.3's race-to-replay mapping.
 */
class SyncPrimitivesTest {

    private static final OffsetDateTime T0 = OffsetDateTime.of(2026, 11, 11, 10, 0, 0, 0, ZoneOffset.UTC);

    @Test
    void lwwTiesLoseOlderLosesNewerWinsDeletedAlwaysLoses() {
        assertEquals(ChangeLog.REASON_NEWER_WRITE, LastWriteWins.supersededReason(false, T0, T0));
        assertEquals(ChangeLog.REASON_NEWER_WRITE, LastWriteWins.supersededReason(false, T0, T0.minusSeconds(1)));
        assertNull(LastWriteWins.supersededReason(false, T0, T0.plusNanos(1_000_000)));
        assertNull(LastWriteWins.supersededReason(false, null, T0));
        assertEquals(ChangeLog.REASON_DELETED, LastWriteWins.supersededReason(true, null, T0));
    }

    @Test
    void clientClockAheadIsClampedToServerTimeAndBehindIsKept() {
        WriteContext ahead = new WriteContext(null, T0.plusHours(5), "live", null);
        assertEquals(T0, ahead.effectiveWriteAt(T0));
        WriteContext behind = new WriteContext(null, OffsetDateTime.of(2026, 11, 11, 15, 0, 0, 0,
                ZoneOffset.ofHoursMinutes(5, 30)), "replay", null);
        assertEquals(T0.minusMinutes(30), behind.effectiveWriteAt(T0));
        assertEquals(T0, WriteContext.NONE.effectiveWriteAt(T0));
        assertFalse(WriteContext.NONE.lwwMode());
    }

    @Test
    void updateChangeSetHasOnlyChangedFieldsAndComparesMoneyByValue() {
        Map<String, Object> before = new LinkedHashMap<>();
        before.put("title", "Lunch");
        before.put("amount", new BigDecimal("250.0"));
        before.put("txnDate", LocalDate.of(2026, 11, 1));
        Map<String, Object> after = new LinkedHashMap<>(before);
        after.put("amount", new BigDecimal("250.00"));
        after.put("title", "Dinner");

        List<FieldChange> changes = ChangeSets.update(before, after);
        assertEquals(List.of(new FieldChange("title", "Lunch", "Dinner")), changes);
        assertTrue(ChangeSets.update(before, before).isEmpty());
    }

    @Test
    void valuesAreInApiForm() {
        assertEquals(new BigDecimal("300.00"), ChangeSets.value(new BigDecimal("300")));
        assertEquals("2026-11-01", ChangeSets.value(LocalDate.of(2026, 11, 1)));
        assertEquals("2026-11-11T10:00:00Z", ChangeSets.value(T0));
        UUID id = UUID.randomUUID();
        assertEquals(id.toString(), ChangeSets.value(id));
    }

    @Test
    void deleteChangeSetStartsWithDeletedAtAndKeepsLastValues() {
        Map<String, Object> last = new LinkedHashMap<>();
        last.put("name", "Food");
        List<FieldChange> changes = ChangeSets.delete(last, T0, Map.of("deletedSubcategoryCount", 2));
        assertEquals(new FieldChange("deletedAt", null, "2026-11-11T10:00:00Z"), changes.get(0));
        assertEquals(new FieldChange("name", "Food", null), changes.get(1));
        assertEquals(new FieldChange("deletedSubcategoryCount", null, 2), changes.get(2));
    }

    @Test
    void malformedHeadersAreReportedByNameAndAbsentOnesAreNull() {
        List<ApiErrorResponse.FieldErrorDetail> errors = new ArrayList<>();
        assertNull(WriteContextFilter.parseUuid(null, WriteContextFilter.IDEMPOTENCY_KEY, errors));
        assertNull(WriteContextFilter.parseUuid("not-a-uuid", WriteContextFilter.IDEMPOTENCY_KEY, errors));
        assertNull(WriteContextFilter.parseUuid("00000000-0000-0000-0000-000000000000",
                WriteContextFilter.DEVICE_ID, errors));
        assertNull(WriteContextFilter.parseInstant("2026-11-11 10:00", errors));
        assertEquals("live", WriteContextFilter.parseOrigin("later", errors));
        assertEquals(List.of(WriteContextFilter.IDEMPOTENCY_KEY, WriteContextFilter.DEVICE_ID,
                        WriteContextFilter.CLIENT_UPDATED_AT, WriteContextFilter.CLIENT_ORIGIN),
                errors.stream().map(ApiErrorResponse.FieldErrorDetail::field).toList());

        List<ApiErrorResponse.FieldErrorDetail> none = new ArrayList<>();
        assertEquals(T0, WriteContextFilter.parseInstant("2026-11-11T10:00:00.000Z", none)
                .withOffsetSameInstant(ZoneOffset.UTC));
        assertEquals("replay", WriteContextFilter.parseOrigin("replay", none));
        assertTrue(none.isEmpty());
    }

    @Test
    void onlyTheIdempotencyIndexAndPrimaryKeysAreReplayableRaces() {
        assertTrue(IdempotentWriteExecutor.isReplayableRace(violation("uq_change_log_user_idempotency_key")));
        assertTrue(IdempotentWriteExecutor.isReplayableRace(violation("transactions_pkey")));
        assertTrue(IdempotentWriteExecutor.isReplayableRace(violation("pk_user_settings")));
        assertFalse(IdempotentWriteExecutor.isReplayableRace(violation("uq_transactions_receipt_public_id")));
        assertFalse(IdempotentWriteExecutor.isReplayableRace(violation("fk_change_log_user_id")));
        assertFalse(IdempotentWriteExecutor.isReplayableRace(violation(null)));
    }

    @Test
    void replayMatchComparesTypeOperationAndIdWhenKnown() {
        UUID id = UUID.randomUUID();
        ChangeLog row = ChangeLog.builder().entityType("transaction").operation("update").entityId(id).build();
        assertTrue(IdempotentWriteExecutor.ReplayMatch.of("transaction", "update", id).matches(row));
        assertFalse(IdempotentWriteExecutor.ReplayMatch.of("transaction", "update", UUID.randomUUID()).matches(row));
        assertFalse(IdempotentWriteExecutor.ReplayMatch.of("transaction", "delete", id).matches(row));
        assertFalse(IdempotentWriteExecutor.ReplayMatch.of("category", "update", id).matches(row));
    }

    private static DataIntegrityViolationException violation(String constraintName) {
        return new DataIntegrityViolationException("duplicate",
                new ConstraintViolationException("duplicate", new SQLException("23505"), constraintName));
    }
}
