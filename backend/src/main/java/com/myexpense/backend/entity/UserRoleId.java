package com.myexpense.backend.entity;

import java.io.Serializable;
import java.util.UUID;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Composite primary key for {@link UserRole}, matching the composite
 * {@code (user_id, role)} primary key of the {@code user_roles} table
 * (docs/architecture/data-model.md §1.2). Required by JPA's {@code @IdClass}
 * mechanism: field names/types here must mirror the {@code @Id}-annotated
 * fields on {@link UserRole} exactly.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class UserRoleId implements Serializable {

    private UUID userId;
    private String role;
}
