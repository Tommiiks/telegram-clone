package com.telegram_clone.controller.payload.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

// Public-facing user view: no email, no PII beyond what other users may see.
@Data
public class PublicUserResponseDTO {
    private UUID uuid;
    private String username;
    private String displayName;
    private String profilePicturePath;
    @JsonProperty("isOnline")
    private boolean isOnline;
    private LocalDateTime lastSeen;
}
