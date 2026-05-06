package com.telegram_clone.controller.payload.response;

import com.telegram_clone.enums.MessageType;
import lombok.Data;

import java.util.UUID;

@Data
public class ReplyMessageResponseDTO {

    private UUID uuid;
    private String content;
    private UserResponseDTO sender;
    private MessageType messageType;
    private String fileName;
}
