package com.telegram_clone.controller;

import com.telegram_clone.controller.payload.request.SendMessageRequestDTO;
import com.telegram_clone.controller.payload.request.UpdateMessageRequestDTO;
import com.telegram_clone.service.ConversationService;
import com.telegram_clone.service.MessageService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Objects;
import java.util.UUID;

// all conversation and message endpoints live here
// we always pull the email from the JWT (SecurityContext) so the user can't fake their identity
@RestController
@RequestMapping("/api/v1/conversations")
@Tag(name = "Conversations", description = "User Conversations endpoints")
public class ConversationController {

    private final ConversationService serv;
    private final MessageService messageServ;

    public ConversationController(ConversationService serv, MessageService messageServ) {
        this.serv = serv;
        this.messageServ = messageServ;
    }

    // GET /api/v1/conversations/saved
    // returns (or creates) the saved messages conversation for the logged user
    @Operation(summary = "Get or create Saved Messages",
               description = "Returns the self-conversation used as Saved Messages. Creates it if it doesn't exist yet.")
    @GetMapping("/saved")
    public ResponseEntity<?> getSavedMessages() {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(serv.getSavedMessages(email));
    }

    // GET /api/v1/conversations
    // returns all conversations for the logged user, sorted by latest message
    @Operation(summary = "Get all conversations",
               description = "Get all conversations for the logged user, paginated.")
    @GetMapping()
    public ResponseEntity<?> findAllConversation(Pageable pageable) {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(serv.findAllConversation(email, pageable));
    }

    // POST /api/v1/conversations  (body: otherUserUuid)
    // opens a chat with another user - creates the conversation if it doesn't exist yet
    @Operation(summary = "Open or find a conversation",
               description = "Finds the conversation between the logged user and another user. Creates it if it doesn't exist.")
    @PostMapping()
    public ResponseEntity<?> findConversationBetweenUsers(@RequestBody UUID otherUserUuid) {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(serv.findConversationBetweenUsers(email, otherUserUuid));
    }

    // DELETE /api/v1/conversations/{uuid}
    // deletes the conversation and all its messages for both users
    @Operation(summary = "Delete a conversation",
               description = "Deletes a conversation and all of its messages. Only participants can do this.")
    @DeleteMapping("/{conversationUuid}")
    public ResponseEntity<?> deleteConversation(@PathVariable UUID conversationUuid) {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        serv.deleteConversation(email, conversationUuid);
        return ResponseEntity.noContent().build();
    }

    // GET /api/v1/conversations/{uuid}/messages
    // returns all messages in a conversation, paginated
    @Operation(summary = "Get messages",
               description = "Get all messages of a conversation, paginated.")
    @GetMapping("/{conversationUuid}/messages")
    public ResponseEntity<?> findAllMessagesFromConv(@PathVariable UUID conversationUuid, Pageable pageable) {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(messageServ.getChatConversation(email, conversationUuid, pageable));
    }

    // POST /api/v1/conversations/{uuid}/messages
    // sends a text message - the websocket event goes out from the service layer
    @Operation(summary = "Send a text message",
               description = "Creates a text message in the conversation. Only participants can send.")
    @PostMapping("/{conversationUuid}/messages")
    public ResponseEntity<?> sendMessage(@PathVariable UUID conversationUuid,
                                         @RequestBody @Valid SendMessageRequestDTO req) {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(messageServ.sendMessage(email, conversationUuid, req));
    }

    // PUT /api/v1/conversations/{uuid}/messages/{msgUuid}
    // edits a text message - only the original sender can do this
    @Operation(summary = "Edit a message",
               description = "Updates the text of a message. Only the sender can edit, and only text messages.")
    @PutMapping("/{conversationUuid}/messages/{messageUuid}")
    public ResponseEntity<?> editMessage(@PathVariable UUID conversationUuid,
                                         @PathVariable UUID messageUuid,
                                         @RequestBody @Valid UpdateMessageRequestDTO dto) {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(messageServ.editMessage(email, conversationUuid, messageUuid, dto));
    }

    // POST /api/v1/conversations/{uuid}/messages/files
    // uploads a file and creates a FILE type message
    @Operation(summary = "Send a file",
               description = "Uploads a file and creates a FILE message in the conversation.")
    @PostMapping("/{conversationUuid}/messages/files")
    public ResponseEntity<?> sendFile(@PathVariable UUID conversationUuid,
                                      @RequestParam MultipartFile file,
                                      @RequestParam(required = false) String caption,
                                      @RequestParam(defaultValue = "false") boolean asDocument,
                                      @RequestParam(required = false) UUID replyToMessageUuid) throws IOException {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(messageServ.sendFile(email, conversationUuid, file, caption, asDocument, replyToMessageUuid));
    }

    // DELETE /api/v1/conversations/{uuid}/messages/{msgUuid}
    // deletes a message - in private chats any participant can delete any message
    @Operation(summary = "Delete a message",
               description = "Deletes a message from the conversation. Any participant can delete.")
    @DeleteMapping("/{conversationUuid}/messages/{messageUuid}")
    public ResponseEntity<?> deleteMessage(@PathVariable UUID conversationUuid,
                                           @PathVariable UUID messageUuid) {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        messageServ.deleteMessage(email, conversationUuid, messageUuid);
        return ResponseEntity.noContent().build();
    }

    // PUT /api/v1/conversations/{uuid}/messages/read
    // marks all unread messages as read and pushes the double tick event via websocket
    @Operation(summary = "Mark messages as read",
               description = "Marks all unread messages in the conversation as read for the logged user.")
    @PutMapping("/{conversationUuid}/messages/read")
    public ResponseEntity<?> markConversationAsRead(@PathVariable UUID conversationUuid) {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        messageServ.markConversationAsRead(email, conversationUuid);
        return ResponseEntity.noContent().build();
    }

}
