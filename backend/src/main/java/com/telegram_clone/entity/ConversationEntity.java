package com.telegram_clone.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "Conversation")
@Data
@NoArgsConstructor
public class ConversationEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true)
    private UUID uuid = UUID.randomUUID();

    // for a normal chat these are two different users
    // for saved messages (notes to self) both participants point to the same user
    @ManyToOne
    @JoinColumn(name = "partecipant_1_id")
    private UserEntity participant1;

    @ManyToOne
    @JoinColumn(name = "partecipant_2_id")
    private UserEntity participant2;

    @Column(updatable = false)
    @CreationTimestamp
    private LocalDateTime createdAt;

    // we update this every time a message is sent so we can sort chats by latest activity
    private LocalDateTime lastMessageAt;

}
