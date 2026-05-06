package com.telegram_clone.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Data
@NoArgsConstructor
@Table(name = "VerificationCode")
public class AuthCodeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // We store the email directly instead of linking to UserEntity,
    // because the user might not exist yet when the OTP is generated.
    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String code;

    // When the OTP was created — used to calculate expiry.
    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime expiresAt;

    public AuthCodeEntity(String email, String code, LocalDateTime expiresAt) {
        this.email = email;
        this.code = code;
        this.expiresAt = expiresAt;
    }
}
