package com.telegram_clone.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.telegram_clone.enums.MessageType;
import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "Message")
@Data
@NoArgsConstructor
public class MessageEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // public id we expose to the frontend - never the numeric one
    @Column(unique = true)
    private UUID uuid = UUID.randomUUID();

    // null for FILE type messages that have no caption
    @Column(length = 4000)
    private String content;

    @ManyToOne
    @JoinColumn(name = "sender_id")
    private UserEntity sender;

    // hidden from the message json response - the frontend gets the conversation uuid separately
    @ManyToOne
    @JoinColumn(name = "conversation_id")
    @JsonIgnore
    private ConversationEntity conversation;

    // set automatically by hibernate when the row is created
    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime sentAt;

    private LocalDateTime editedAt;

    @Column(nullable = false)
    @Enumerated(EnumType.STRING)
    private MessageType messageType = MessageType.TEXT;

    // only used for FILE type messages
    private String filePath;
    private String fileName;

    // if true the image is shown as a file download instead of an inline preview
    @Column(name = "as_document")
    private Boolean asDocument = false;

    @ManyToOne
    @JoinColumn(name = "reply_to_message_id")
    private MessageEntity replyTo;

    // false by default, gets set to true when the other user opens the conversation
    private boolean isRead = false;
}
