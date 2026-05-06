package com.telegram_clone.controller.payload.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.telegram_clone.enums.MessageType;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

@Data
public class MessageResponseDTO {

    private UUID uuid;
    private String content;
    private UserResponseDTO sender;
    private LocalDateTime sentAt;
    private LocalDateTime editedAt;
    private MessageType messageType;
    private String filePath;
    private String fileName;
    private ReplyMessageResponseDTO replyTo;
    @JsonProperty("asDocument")
    private boolean asDocument;
    @JsonProperty("isRead")
    private boolean isRead;
}
