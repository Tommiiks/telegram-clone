package com.telegram_clone.repository;

import com.telegram_clone.entity.UserEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserRepository extends JpaRepository<UserEntity, Long> {

    Optional<UserEntity> findByUsername(String username);
    Optional<UserEntity> findByUuid(UUID uuid);
    Optional<UserEntity> findByEmail(String email);

    // case-insensitive so @Tommiics and @tommiics are treated as the same username
    boolean existsByUsernameIgnoreCase(String username);

    // search by username or display name, case-insensitive so "tom" also finds "Tom" and "TOM"
    @Query("SELECT u FROM UserEntity u WHERE " +
           "LOWER(u.username) LIKE LOWER(CONCAT('%', :query, '%')) OR " +
           "LOWER(u.displayName) LIKE LOWER(CONCAT('%', :query, '%'))")
    Page<UserEntity> search(@Param("query") String query, Pageable pageable);

}
