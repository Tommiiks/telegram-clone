package com.telegram_clone.controller.payload.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

@Data
public class ConversationResponseDTO {

    private UUID uuid;
    private PublicUserResponseDTO participant1;
    private PublicUserResponseDTO participant2;
    private LocalDateTime createdAt;
    private LocalDateTime lastMessageAt;
    private MessageResponseDTO lastMessage;
    @JsonProperty("isSavedMessages")
    private boolean savedMessages;
}
