package com.myexpense.backend.repository;

import java.util.UUID;

/**
 * One resolved display name for a group member — either a registered user's
 * {@code firstName + lastName} or an invited contact's {@code name}
 * (api-overview.md §7.1: "{@code members[].name} is resolved server-side").
 *
 * <p>Produced by {@link UserRepository#findMemberNamesByIdIn} and
 * {@link ContactRepository#findMemberNamesByIdIn} via JPQL constructor
 * expressions, so a batch of names never travels as an {@code Object[]} that a
 * caller has to index by position and cast — the same convention
 * {@link CategorySpendRow} established.
 *
 * <p><strong>Two queries, never one per member</strong> (constitution §10,
 * V10 contract item 3): {@code GroupService} collects every member id across
 * every group in the response, resolves each <em>source table</em> once, and
 * joins in memory. One query per member would be the N+1 that contract item
 * names.
 *
 * <p>A {@code repository}-package type rather than a DTO: this is the shape a
 * query returns, never a wire shape. The API's own shape is
 * {@code dto/response/GroupMemberSummary}.
 *
 * @param id   the {@code users.id} or {@code contacts.id} this name belongs to
 * @param name the display name, never {@code null} — both source columns are
 *             {@code NOT NULL}
 */
public record MemberNameRow(UUID id, String name) {
}
