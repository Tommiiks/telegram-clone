package com.telegram_clone.service;

import com.telegram_clone.controller.payload.request.SendMessageRequestDTO;
import com.telegram_clone.controller.payload.request.UpdateMessageRequestDTO;
import com.telegram_clone.controller.payload.response.ChatEventDTO;
import com.telegram_clone.controller.payload.response.MessageResponseDTO;
import com.telegram_clone.controller.payload.response.ReplyMessageResponseDTO;
import com.telegram_clone.controller.payload.response.UserResponseDTO;
import com.telegram_clone.entity.ConversationEntity;
import com.telegram_clone.entity.MessageEntity;
import com.telegram_clone.entity.UserEntity;
import com.telegram_clone.enums.MessageType;
import com.telegram_clone.repository.ConversationRepository;
import com.telegram_clone.repository.MessageRepository;
import com.telegram_clone.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class MessageService {

    private final UserRepository userRepo;
    private final ConversationRepository conversationRepo;
    private final MessageRepository messageRepo;
    private final SimpMessagingTemplate messagingTemplate;

    public MessageService(UserRepository userRepo, ConversationRepository conversationRepo,
                          MessageRepository messageRepo,
                          SimpMessagingTemplate messagingTemplate) {
        this.userRepo = userRepo;
        this.messageRepo = messageRepo;
        this.conversationRepo = conversationRepo;
        this.messagingTemplate = messagingTemplate;
    }

    // returns all messages of a conversation, paginated
    // the client already has the conversation uuid so we just use that directly
    public Page<MessageResponseDTO> getChatConversation(String email, UUID conversationUuid, Pageable pageable) {
        ConversationEntity conversation = conversationRepo.findByUuid(conversationUuid)
                .orElseThrow(() -> new EntityNotFoundException("Conversation was not found: " + conversationUuid));

        // make sure the person asking is actually in this conversation
        boolean isParticipant = conversation.getParticipant1().getEmail().equals(email)
                || conversation.getParticipant2().getEmail().equals(email);

        if (!isParticipant)
            throw new AccessDeniedException("You are not a participant of this conversation.");

        Page<MessageEntity> messages = messageRepo.findAllByConversation(conversation, pageable);

        // convert entities to dtos before sending them out
        List<MessageResponseDTO> dtos = messages.getContent().stream()
                .map(this::toMessageResponse)
                .toList();

        return new PageImpl<>(dtos, pageable, messages.getTotalElements());
    }

    // sends a text message - saves it to db and pushes it to both users via websocket
    public MessageResponseDTO sendMessage(String email, UUID conversationUuid, SendMessageRequestDTO dto) {
        UserEntity sender = userRepo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("User was not found: " + email));

        ConversationEntity conversation = conversationRepo.findByUuid(conversationUuid)
                .orElseThrow(() -> new EntityNotFoundException("Conversation was not found: " + conversationUuid));

        // only participants can send messages here
        boolean isParticipant = conversation.getParticipant1().getEmail().equals(email)
                || conversation.getParticipant2().getEmail().equals(email);

        if (!isParticipant)
            throw new AccessDeniedException("You are not a participant of this conversation.");

        // no empty messages
        if (dto.getContent() == null || dto.getContent().isBlank())
            throw new IllegalArgumentException("The message can't be empty.");

        String content = dto.getContent().trim();

        // 4000 chars max, same limit as in the frontend
        if (content.length() > 4000)
            throw new IllegalArgumentException("Il messaggio puo contenere al massimo 4000 caratteri");

        // files go through a separate endpoint, not here
        MessageType messageType = dto.getMessageType() == null ? MessageType.TEXT : dto.getMessageType();
        if (messageType != MessageType.TEXT)
            throw new IllegalArgumentException("Use the file upload endpoint for file messages.");

        MessageEntity entity = new MessageEntity();
        entity.setSender(sender);
        entity.setConversation(conversation);
        entity.setMessageType(MessageType.TEXT);
        entity.setContent(content);
        entity.setReplyTo(resolveReplyToMessage(conversation, dto.getReplyToMessageUuid()));

        // update the timestamp so the conversation goes to the top of the list
        conversation.setLastMessageAt(LocalDateTime.now());

        messageRepo.save(entity);
        conversationRepo.save(conversation);

        // build the event and push it to both users - this is how the chat updates in real time
        MessageResponseDTO response = toMessageResponse(entity);

        ChatEventDTO event = new ChatEventDTO();
        event.setType("MESSAGE_CREATED");
        event.setConversationUuid(conversation.getUuid());
        event.setMessage(response);

        notifyParticipants(conversation, event);

        return response;
    }

    // edits the content of a text message - only the sender can do this
    public MessageResponseDTO editMessage(String email, UUID conversationUuid, UUID messageUuid, UpdateMessageRequestDTO dto) {
        UserEntity sender = userRepo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("User was not found: " + email));

        ConversationEntity conversation = conversationRepo.findByUuid(conversationUuid)
                .orElseThrow(() -> new EntityNotFoundException("Conversation was not found: " + conversationUuid));

        MessageEntity message = messageRepo.findByUuid(messageUuid)
                .orElseThrow(() -> new EntityNotFoundException("Message was not found: " + messageUuid));

        // standard participant check
        boolean isParticipant = conversation.getParticipant1().getEmail().equals(email)
                || conversation.getParticipant2().getEmail().equals(email);

        if (!isParticipant)
            throw new AccessDeniedException("You are not a participant of this conversation.");

        // make sure the message actually belongs to this conversation
        if (!message.getConversation().getUuid().equals(conversation.getUuid()))
            throw new AccessDeniedException("This message does not belong to this conversation.");

        // only text messages can be edited, files stay as they are
        if (!message.getMessageType().equals(MessageType.TEXT))
            throw new IllegalArgumentException("Only text messages can be edited.");

        // you can only edit your own messages
        if (!message.getSender().equals(sender))
            throw new IllegalArgumentException("You can only edit your own messages.");

        if (dto.getContent() == null || dto.getContent().isBlank())
            throw new IllegalArgumentException("The message can't be empty.");

        String content = dto.getContent().trim();
        if (content.length() > 4000)
            throw new IllegalArgumentException("Il messaggio puo contenere al massimo 4000 caratteri");

        message.setContent(content);
        message.setEditedAt(LocalDateTime.now());
        messageRepo.save(message);

        MessageResponseDTO response = toMessageResponse(message);

        // tell both users the message changed so the frontend updates it
        ChatEventDTO event = new ChatEventDTO();
        event.setType("MESSAGE_UPDATED");
        event.setConversationUuid(conversation.getUuid());
        event.setMessage(response);

        notifyParticipants(conversation, event);

        return response;
    }

    // handles file uploads - saves the file to disk and creates a FILE type message
    public MessageResponseDTO sendFile(String email, UUID conversationUuid, MultipartFile file,
                                       String caption, boolean asDocument, UUID replyToMessageUuid) throws IOException {
        UserEntity sender = userRepo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("User was not found: " + email));

        ConversationEntity conversation = conversationRepo.findByUuid(conversationUuid)
                .orElseThrow(() -> new EntityNotFoundException("Conversation was not found: " + conversationUuid));

        boolean isParticipant = conversation.getParticipant1().getEmail().equals(email)
                || conversation.getParticipant2().getEmail().equals(email);

        if (!isParticipant)
            throw new AccessDeniedException("You are not a participant of this conversation.");

        if (file == null || file.isEmpty())
            throw new IllegalArgumentException("File can't be empty.");

        String originalFileName = file.getOriginalFilename();
        if (originalFileName == null || originalFileName.isBlank())
            originalFileName = "uploaded-file";

        // sanitize slashes so nobody can mess with the path
        originalFileName = originalFileName.replace("\\", "_").replace("/", "_");

        // prefix with a uuid so we never have two files with the same name
        String storedFileName = UUID.randomUUID() + "_" + originalFileName;

        Path path = Paths.get("uploads/messages/files/" + storedFileName);
        Files.createDirectories(path.getParent());
        Files.copy(file.getInputStream(), path);

        MessageEntity entity = new MessageEntity();
        entity.setSender(sender);
        entity.setConversation(conversation);
        entity.setMessageType(MessageType.FILE);
        entity.setFileName(originalFileName);
        entity.setFilePath("uploads/messages/files/" + storedFileName);
        entity.setAsDocument(asDocument);
        entity.setReplyTo(resolveReplyToMessage(conversation, replyToMessageUuid));

        // caption is optional - it's like a description under the file
        if (caption != null && !caption.isBlank()) {
            String trimmedCaption = caption.trim();
            if (trimmedCaption.length() > 4000)
                throw new IllegalArgumentException("Il messaggio puo contenere al massimo 4000 caratteri");
            entity.setContent(trimmedCaption);
        }

        conversation.setLastMessageAt(LocalDateTime.now());

        messageRepo.save(entity);
        conversationRepo.save(conversation);

        MessageResponseDTO response = toMessageResponse(entity);

        ChatEventDTO event = new ChatEventDTO();
        event.setType("FILE_CREATED");
        event.setConversationUuid(conversation.getUuid());
        event.setMessage(response);

        notifyParticipants(conversation, event);

        return response;
    }

    // deletes a message - in a private chat both users can delete any message
    @Transactional
    public void deleteMessage(String email, UUID conversationUuid, UUID messageUuid) {
        ConversationEntity conversation = conversationRepo.findByUuid(conversationUuid)
                .orElseThrow(() -> new EntityNotFoundException("Conversation was not found: " + conversationUuid));

        MessageEntity message = messageRepo.findByUuid(messageUuid)
                .orElseThrow(() -> new EntityNotFoundException("Message was not found: " + messageUuid));

        boolean isParticipant = conversation.getParticipant1().getEmail().equals(email)
                || conversation.getParticipant2().getEmail().equals(email);

        if (!isParticipant)
            throw new AccessDeniedException("You are not a participant of this conversation.");

        if (!message.getConversation().getUuid().equals(conversation.getUuid()))
            throw new AccessDeniedException("This message does not belong to this conversation.");

        UUID deletedUuid = message.getUuid();
        messageRepo.clearRepliesTo(message);
        messageRepo.delete(message);

        // tell both users which message was deleted so they can remove it from the screen
        ChatEventDTO event = new ChatEventDTO();
        event.setType("MESSAGE_DELETED");
        event.setConversationUuid(conversation.getUuid());
        event.setDeletedMessageUuid(deletedUuid);

        notifyParticipants(conversation, event);
    }

    private MessageEntity resolveReplyToMessage(ConversationEntity conversation, UUID replyToMessageUuid) {
        if (replyToMessageUuid == null)
            return null;

        MessageEntity replyTo = messageRepo.findByUuid(replyToMessageUuid)
                .orElseThrow(() -> new EntityNotFoundException("Reply message was not found: " + replyToMessageUuid));

        if (!replyTo.getConversation().getUuid().equals(conversation.getUuid()))
            throw new AccessDeniedException("Reply message does not belong to this conversation.");

        return replyTo;
    }

    private MessageResponseDTO toMessageResponse(MessageEntity message) {
        MessageResponseDTO dto = new MessageResponseDTO();
        dto.setUuid(message.getUuid());
        dto.setContent(message.getContent());
        dto.setSender(toUserResponse(message.getSender()));
        dto.setSentAt(message.getSentAt());
        dto.setEditedAt(message.getEditedAt());
        dto.setMessageType(message.getMessageType());
        dto.setFilePath(message.getFilePath());
        dto.setFileName(message.getFileName());
        dto.setReplyTo(toReplyResponse(message.getReplyTo()));
        dto.setAsDocument(Boolean.TRUE.equals(message.getAsDocument()));
        dto.setRead(message.isRead());
        return dto;
    }

    private ReplyMessageResponseDTO toReplyResponse(MessageEntity message) {
        if (message == null)
            return null;

        ReplyMessageResponseDTO dto = new ReplyMessageResponseDTO();
        dto.setUuid(message.getUuid());
        dto.setContent(message.getContent());
        dto.setSender(toUserResponse(message.getSender()));
        dto.setMessageType(message.getMessageType());
        dto.setFileName(message.getFileName());
        return dto;
    }

    private UserResponseDTO toUserResponse(UserEntity user) {
        if (user == null)
            return null;

        UserResponseDTO dto = new UserResponseDTO();
        dto.setUuid(user.getUuid());
        dto.setUsername(user.getUsername());
        dto.setEmail(user.getEmail());
        dto.setDisplayName(user.getDisplayName());
        dto.setProfilePicturePath(user.getProfilePicturePath());
        dto.setOnline(user.isOnline());
        dto.setLastSeen(user.getLastSeen());
        return dto;
    }

    // sends a websocket event to both people in the conversation
    private void notifyParticipants(ConversationEntity conversation, ChatEventDTO event) {
        Set<String> participantEmails = new LinkedHashSet<>();
        participantEmails.add(conversation.getParticipant1().getEmail());
        participantEmails.add(conversation.getParticipant2().getEmail());

        participantEmails.forEach(email ->
                messagingTemplate.convertAndSendToUser(email, "/queue/messages", event)
        );
    }

    // marks all messages in the conversation as read for the logged user
    // we also push a MESSAGE_READ event for each one so the sender sees the double tick
    public void markConversationAsRead(String email, UUID conversationUuid) {
        UserEntity user = userRepo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("User was not found: " + email));

        ConversationEntity conversation = conversationRepo.findByUuid(conversationUuid)
                .orElseThrow(() -> new EntityNotFoundException("Conversation was not found: " + conversationUuid));

        boolean isParticipant = conversation.getParticipant1().getEmail().equals(email)
                || conversation.getParticipant2().getEmail().equals(email);

        if (!isParticipant)
            throw new AccessDeniedException("You are not a participant of this conversation.");

        // only get unread messages that were sent by the other person, not by us
        List<MessageEntity> unreadMessages = messageRepo.findUnreadMessagesForUser(conversation, user);

        for (MessageEntity message : unreadMessages)
            message.setRead(true);

        messageRepo.saveAll(unreadMessages);

        // notify both users for each message so the blue double ticks show up
        for (MessageEntity message : unreadMessages) {
            ChatEventDTO event = new ChatEventDTO();
            event.setType("MESSAGE_READ");
            event.setConversationUuid(conversation.getUuid());
            event.setReadMessageUuid(message.getUuid());

            notifyParticipants(conversation, event);
        }
    }

}
