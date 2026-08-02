package com.myexpense.backend.sync;

/**
 * One {@code {"field","before","after"}} element of {@code change_log.changes}
 * (ADR 0027 §6.3). Values are already in API form (see {@link ChangeSets#value}).
 */
public record FieldChange(String field, Object before, Object after) {
}
