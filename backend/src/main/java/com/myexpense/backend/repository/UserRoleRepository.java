package com.myexpense.backend.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.myexpense.backend.entity.UserRole;
import com.myexpense.backend.entity.UserRoleId;

public interface UserRoleRepository extends JpaRepository<UserRole, UserRoleId> {

    @Query("select ur.role from UserRole ur where ur.userId = :userId")
    List<String> findRolesByUserId(@Param("userId") UUID userId);
}
