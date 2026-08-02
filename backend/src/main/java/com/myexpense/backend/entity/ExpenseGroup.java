package com.myexpense.backend.entity;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Maps to the {@code groups} table (data-model.md §4.2,
 * database/migrations/V10__groups.sql).
 *
 * <p><strong>Why the class is {@code ExpenseGroup} and not {@code Group}.</strong>
 * {@code GROUP} is a reserved word in JPQL/HQL ({@code GROUP BY}), and the
 * entity name is what every derived Spring Data query and every {@code @Query}
 * string resolves against. Naming the entity {@code Group} would put a reserved
 * token in that position for no benefit; the table name stays {@code groups}
 * (which is <em>non</em>-reserved in PostgreSQL, so V10's unquoted
 * {@code CREATE TABLE groups} and Hibernate's unquoted SQL are both fine), and
 * the API surface stays {@code group}/{@code groupId}/{@code GroupResponse}
 * throughout. The repository is still {@code GroupRepository} — the domain word
 * is "group" everywhere a reader meets it except this one identifier.
 *
 * <p><strong>Deliberately small — the interesting data is in
 * {@link GroupMember} and {@link GroupMemberBalance}.</strong>
 *
 * <p><strong>NO STORED BALANCE COLUMN, and the reason is structural rather than
 * stylistic</strong> (§4.2): a group's balance is <em>viewer-relative</em>. Each
 * member has their own {@code group_member_balances} row and
 * {@code GroupResponse.yourBalance} is built from the requesting principal's own
 * row (api-overview.md §7.1). A single group-level number could not be correct
 * for two members at once.
 *
 * <p><strong>{@link #createdByUserId} is a record of who created the group, NOT
 * a permission.</strong> The creator is just another {@code 'member'} row
 * (§4.3), there is no {@code 'owner'} role this phase, and no endpoint in §7 is
 * authorized by this column — authorization is always "does a
 * {@code group_members} row exist for (groupId, principal)" (V10's RULE 1,
 * security-architecture.md §2). Substituting this column for that check is the
 * single highest-severity bug available in this domain.
 *
 * <p>{@link #lastActivity} is free-text display state ("Settled up • Today"),
 * nullable, with no vocabulary and no structure — it is a sentence, not an enum.
 * It is <strong>shared</strong>: every member reads the same string, so the
 * V11/V12 write paths that update it must treat it as part of the shared fact
 * they are committing, not as a per-viewer annotation. Nothing in §6/§7 writes
 * it, so it is {@code null} on every group this sub-step creates.
 *
 * <p>No {@code deleted_at} and no {@code version}: §7 has no DELETE and no
 * PATCH, and a group-leave/member-removal feature would need both questions
 * answered first (V10's "what this migration deliberately does NOT do").
 */
@Entity
@Table(name = "groups")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@EqualsAndHashCode(of = "id")
public class ExpenseGroup {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "created_by_user_id", nullable = false, updatable = false)
    private UUID createdByUserId;

    @Column(name = "last_activity", length = 255)
    private String lastActivity;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
