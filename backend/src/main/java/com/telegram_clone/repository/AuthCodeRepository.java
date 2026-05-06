package com.telegram_clone.repository;

import com.telegram_clone.entity.AuthCodeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface AuthCodeRepository extends JpaRepository<AuthCodeEntity, Long> {

    Optional<AuthCodeEntity> findByEmail(String email);
}
