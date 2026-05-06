package com.telegram_clone.controller.payload.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

@Data
public class UserResponseDTO {

    private UUID uuid;
    private String username;
    private String email;
    private String displayName;
    private String profilePicturePath;

    @JsonProperty("isOnline")
    private boolean isOnline;
    private LocalDateTime lastSeen;

}
