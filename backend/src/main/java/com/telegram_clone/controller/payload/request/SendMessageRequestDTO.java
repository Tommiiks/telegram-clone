package com.telegram_clone.controller.payload.request;

import com.telegram_clone.enums.MessageType;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.UUID;

@Data
public class SendMessageRequestDTO {

    @Size(max = 4000, message = "Il messaggio può contenere al massimo 4000 caratteri")
    private String content;

    @NotNull
    private MessageType messageType = MessageType.TEXT;

    private UUID replyToMessageUuid;
}
