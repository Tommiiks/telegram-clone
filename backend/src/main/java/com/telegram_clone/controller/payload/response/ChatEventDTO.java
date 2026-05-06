package com.telegram_clone.controller.payload.response;


import lombok.Data;

import java.util.UUID;

@Data
public class ChatEventDTO {

    /*
    TYPE EVENTS:

    MESSAGE_CREATED -> uses message
    FILE_CREATED -> uses message
    MESSAGE_UPDATED -> uses message
    MESSAGE_DELETED -> uses deletedMessageUuid
    MESSAGE_READ -> uses readMessageUuid
    CONVERSATION_DELETED -> uses conversationUuid
    USER_ONLINE -> uses user
    USER_OFFLINE -> uses user
    USER_UPDATED -> uses user

    */

    private String type;

    private UUID conversationUuid;

    private MessageResponseDTO message;

    private UUID deletedMessageUuid;

    private UUID readMessageUuid;

    private PublicUserResponseDTO user;
}
