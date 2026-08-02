package com.myexpense.backend.dto.response;

import java.util.List;

import org.springframework.data.domain.Page;

/**
 * {@code PageResponse<T>} (api-overview.md "Common types") — the envelope every
 * paginated list endpoint in this API returns.
 *
 * <p><strong>A project DTO, not Spring Data's {@code Page}.</strong> Serializing
 * a {@code Page} directly would put Spring's own internal shape
 * ({@code pageable}, {@code sort}, {@code first}, {@code last},
 * {@code numberOfElements}, …) on the wire — a contract this project does not
 * own, which Spring itself warns is unstable across versions, and which does
 * not match the five keys the contract specifies. The same rule that keeps JPA
 * entities off the boundary applies to framework types (constitution §9).
 *
 * <p>Field names mirror the contract exactly: {@code content}, {@code page},
 * {@code size}, {@code totalElements}, {@code totalPages}. {@code page} is
 * zero-based, matching the {@code page} query parameter.
 *
 * <p>Introduced with Domain 4 (Transactions) — the first genuinely unbounded
 * list in this API (constitution §11). Domain 3's categories list is a plain
 * array by contract, because that set is small and bounded. Later paginated
 * domains (Activities, Notifications, Split expenses) reuse this type rather
 * than defining their own envelope.
 */
public record PageResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages) {

    /**
     * Wraps a Spring Data {@link Page} of entities whose elements have already
     * been mapped to DTOs.
     *
     * <p>The mapping is done by the caller rather than inside here (via
     * {@code Page#map}) so that this type never has to know about entities at
     * all — it stays a pure transport shape.
     */
    public static <T> PageResponse<T> of(Page<?> page, List<T> content) {
        return new PageResponse<>(
                content,
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages());
    }
}
