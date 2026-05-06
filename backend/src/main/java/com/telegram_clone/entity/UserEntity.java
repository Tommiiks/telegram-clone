package com.telegram_clone.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "users")
@Data
@NoArgsConstructor
public class UserEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // public-facing id - we never expose the numeric id to the frontend
    @Column(unique = true)
    private UUID uuid = UUID.randomUUID();

    @Column(unique = true, nullable = false)
    private String username;

    @Column(nullable = false)
    private String displayName;

    // we use email instead of phone number for identification, simpler for now
    @Column(nullable = false, unique = true)
    private String email;

    private String profilePicturePath;

    // set to true when the user connects to the websocket, false when they disconnect
    private boolean isOnline;

    // updated every time the user disconnects - used for "last seen X minutes ago"
    private LocalDateTime lastSeen;

    public UserEntity(String username) {
        this.username = username;
    }

    // these are needed by Spring Security but we never actually lock or expire accounts
    @Column(nullable = false)
    private boolean enabled = true;

    @Column(nullable = false)
    private boolean accountNonLocked = true;

    @Column(nullable = false)
    private boolean accountNonExpired = true;

    @Column(nullable = false)
    private boolean credentialsNonExpired = true;

}
