package com.telegram_clone.service;

import com.telegram_clone.controller.payload.response.ChatEventDTO;
import com.telegram_clone.controller.payload.response.ConversationResponseDTO;
import com.telegram_clone.controller.payload.response.MessageResponseDTO;
import com.telegram_clone.entity.ConversationEntity;
import com.telegram_clone.entity.UserEntity;
import com.telegram_clone.repository.ConversationRepository;
import com.telegram_clone.repository.MessageRepository;
import com.telegram_clone.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import org.modelmapper.ModelMapper;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class ConversationService {

    private final ConversationRepository repo;
    private final MessageRepository messageRepo;
    private final UserRepository userRepo;
    private final ModelMapper mapper;
    private final SimpMessagingTemplate messagingTemplate;

    public ConversationService(ConversationRepository repo,
                               MessageRepository messageRepo,
                               ModelMapper mapper,
                               UserRepository userRepo,
                               SimpMessagingTemplate messagingTemplate) {
        this.repo = repo;
        this.messageRepo = messageRepo;
        this.mapper = mapper;
        this.userRepo = userRepo;
        this.messagingTemplate = messagingTemplate;
    }

    // saved messages is basically a conversation with yourself (participant1 == participant2)
    // if it doesn't exist yet we create it here
    public ConversationResponseDTO getSavedMessages(String email) {
        UserEntity user = userRepo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("User was not found: " + email));

        // use the dedicated self-conversation query so there's zero ambiguity
        ConversationEntity conversation = repo.findSelfConversation(user)
                .orElseGet(() -> {
                    ConversationEntity self = new ConversationEntity();
                    self.setParticipant1(user);
                    self.setParticipant2(user);
                    return repo.save(self);
                });

        return mapConversation(conversation);
    }

    // finds the conversation between two users, or creates it if it doesn't exist yet
    // this is also how Telegram works - you click on a user and the chat opens
    public ConversationResponseDTO findConversationBetweenUsers(String email, UUID otherUserUuid) {
        UserEntity participant1 = userRepo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("User 1 was not found: " + email));
        UserEntity participant2 = userRepo.findByUuid(otherUserUuid)
                .orElseThrow(() -> new EntityNotFoundException("User 2 was not found: " + otherUserUuid));

        ConversationEntity conversation = repo.findConversationBetweenUsers(participant1, participant2)
                .orElseGet(() -> {
                    // no conversation yet, so we make one
                    ConversationEntity newConversation = new ConversationEntity();
                    newConversation.setParticipant1(participant1);
                    newConversation.setParticipant2(participant2);
                    return repo.save(newConversation);
                });

        return mapConversation(conversation);
    }

    // gets all conversations for the logged user, sorted by latest message
    public Page<ConversationResponseDTO> findAllConversation(String email, Pageable pageable) {
        UserEntity participant = userRepo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("User was not found: " + email));

        Page<ConversationEntity> conversations = repo.findAllConversation(participant, pageable);
        List<ConversationResponseDTO> dtos = conversations.getContent().stream()
                .map(this::mapConversation)
                .toList();
        return new PageImpl<>(dtos, pageable, conversations.getTotalElements());
    }

    // converts a conversation entity to the dto we send to the frontend
    // we also attach the last message here so the sidebar preview works
    private ConversationResponseDTO mapConversation(ConversationEntity conversation) {
        ConversationResponseDTO dto = mapper.map(conversation, ConversationResponseDTO.class);

        // grab the most recent message for the preview in the sidebar
        messageRepo.findTopByConversationOrderBySentAtDesc(conversation)
                .map(message -> mapper.map(message, MessageResponseDTO.class))
                .ifPresent(dto::setLastMessage);

        // if both participants are the same person it's the saved messages chat
        boolean isSelf = conversation.getParticipant1().getUuid()
                .equals(conversation.getParticipant2().getUuid());
        dto.setSavedMessages(isSelf);

        return dto;
    }

    // deletes the conversation and all its messages, then tells both users about it via websocket
    @Transactional
    public void deleteConversation(String email, UUID conversationUuid) {
        ConversationEntity conversation = repo.findByUuid(conversationUuid)
                .orElseThrow(() -> new EntityNotFoundException("Conversation was not found: " + conversationUuid));

        // only people who are actually in the conversation can delete it
        boolean isParticipant = conversation.getParticipant1().getEmail().equals(email)
                || conversation.getParticipant2().getEmail().equals(email);

        if (!isParticipant)
            throw new AccessDeniedException("You are not a participant of this conversation.");

        // prepare the event before deleting, because after delete we lose the participant data
        ChatEventDTO event = new ChatEventDTO();
        event.setType("CONVERSATION_DELETED");
        event.setConversationUuid(conversation.getUuid());

        messageRepo.clearReplyLinksInConversation(conversation);
        messageRepo.deleteAllByConversation(conversation);
        repo.delete(conversation);

        // tell both users the conversation is gone so the frontend can remove it
        notifyParticipants(conversation, event);
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

}
