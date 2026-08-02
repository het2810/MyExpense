package com.myexpense.backend.sync;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Pure functions computing {@code change_log.changes} server-side from an
 * entity's logged fields before and after a write (ADR 0027 §6.3). The client
 * never supplies a diff.
 *
 * <p>Callers describe an entity as an ordered {@code field → value} map using
 * the API's camelCase names, and only the fields ADR 0027 §6.3's table lists.
 */
public final class ChangeSets {

    private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");

    private ChangeSets() {
    }

    /** Create: every logged field, {@code before: null}. */
    public static List<FieldChange> create(Map<String, ?> after) {
        List<FieldChange> changes = new ArrayList<>(after.size());
        after.forEach((field, value) -> changes.add(new FieldChange(field, null, value(value))));
        return changes;
    }

    /** Applied update: only fields whose value changed. No change → {@code []}. */
    public static List<FieldChange> update(Map<String, ?> before, Map<String, ?> after) {
        List<FieldChange> changes = new ArrayList<>();
        after.forEach((field, newValue) -> {
            Object oldValue = value(before.get(field));
            Object normalizedNew = value(newValue);
            if (!sameValue(oldValue, normalizedNew)) {
                changes.add(new FieldChange(field, oldValue, normalizedNew));
            }
        });
        return changes;
    }

    /**
     * Superseded update: every field the request tried to set. {@code before} is
     * the server's current value, {@code after} the attempted value — the
     * overwritten values ruling 4 requires the user can see.
     */
    public static List<FieldChange> attempted(Map<String, ?> current, Map<String, ?> attempted) {
        List<FieldChange> changes = new ArrayList<>(attempted.size());
        attempted.forEach((field, value) -> changes.add(new FieldChange(field, value(current.get(field)), value(value))));
        return changes;
    }

    /**
     * Delete: {@code deletedAt null → instant}, then every logged field's last
     * value as {@code before} with {@code after: null}, then any extra facts
     * ({@code before: null}).
     */
    public static List<FieldChange> delete(Map<String, ?> lastValues, OffsetDateTime deletedAt,
            Map<String, ?> extras) {
        List<FieldChange> changes = new ArrayList<>();
        changes.add(new FieldChange("deletedAt", null, value(deletedAt)));
        lastValues.forEach((field, value) -> {
            if (!"deletedAt".equals(field)) {
                changes.add(new FieldChange(field, value(value), null));
            }
        });
        extras.forEach((field, value) -> changes.add(new FieldChange(field, null, value(value))));
        return changes;
    }

    /**
     * API form: money ({@link BigDecimal}) with 2 decimals, dates
     * {@code YYYY-MM-DD}, times {@code HH:mm}, instants ISO-8601 UTC, ids as
     * strings; collections and maps element-wise; other values unchanged.
     */
    public static Object value(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof BigDecimal decimal) {
            return decimal.setScale(2, RoundingMode.HALF_UP);
        }
        if (raw instanceof LocalDate date) {
            return date.toString();
        }
        if (raw instanceof LocalTime time) {
            return TIME_FORMAT.format(time);
        }
        if (raw instanceof OffsetDateTime instant) {
            return instant.toInstant().toString();
        }
        if (raw instanceof UUID id) {
            return id.toString();
        }
        if (raw instanceof Map<?, ?> map) {
            Map<String, Object> normalized = new LinkedHashMap<>();
            map.forEach((key, element) -> normalized.put(String.valueOf(key), value(element)));
            return normalized;
        }
        if (raw instanceof Collection<?> collection) {
            List<Object> normalized = new ArrayList<>(collection.size());
            collection.forEach(element -> normalized.add(value(element)));
            return normalized;
        }
        return raw;
    }

    private static boolean sameValue(Object left, Object right) {
        if (left instanceof BigDecimal a && right instanceof BigDecimal b) {
            return a.compareTo(b) == 0;
        }
        return Objects.equals(left, right);
    }
}
