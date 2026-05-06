package com.telegram_clone.service;

import com.telegram_clone.controller.payload.response.ChatEventDTO;
import com.telegram_clone.controller.payload.response.PublicUserResponseDTO;
import com.telegram_clone.entity.UserEntity;
import com.telegram_clone.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import org.modelmapper.ModelMapper;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.security.Principal;
import java.time.LocalDateTime;

@Service
public class WebSocketPresenceService {

    private final UserRepository userRepo;
    private final ModelMapper mapper;
    private final SimpMessagingTemplate messagingTemplate;

    public WebSocketPresenceService(UserRepository userRepo,
                                    ModelMapper mapper,
                                    SimpMessagingTemplate messagingTemplate) {
        this.userRepo = userRepo;
        this.mapper = mapper;
        this.messagingTemplate = messagingTemplate;
    }

    // runs automatically when a user connects to the websocket
    // we mark them as online in the db and tell everyone else
    @EventListener
    public void handleConnected(SessionConnectedEvent event) {
        Principal principal = event.getUser();

        // if there's no user attached to the session we ignore it
        if (principal == null) return;

        String email = principal.getName();

        UserEntity user = userRepo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("User was not found: " + email));

        user.setOnline(true);
        userRepo.save(user);

        // broadcast USER_ONLINE so all clients update the green dot
        ChatEventDTO chatEvent = new ChatEventDTO();
        chatEvent.setType("USER_ONLINE");
        chatEvent.setUser(mapper.map(user, PublicUserResponseDTO.class));

        messagingTemplate.convertAndSend("/queue/presence", chatEvent);
    }

    // runs automatically when a user disconnects from the websocket
    // we mark them as offline and save the time so we can show "last seen X minutes ago"
    @EventListener
    public void handleDisconnected(SessionDisconnectEvent event) {
        Principal principal = event.getUser();

        if (principal == null) return;

        String email = principal.getName();

        UserEntity user = userRepo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("User was not found: " + email));

        user.setOnline(false);
        user.setLastSeen(LocalDateTime.now());
        userRepo.save(user);

        // broadcast USER_OFFLINE so all clients remove the green dot
        ChatEventDTO chatEvent = new ChatEventDTO();
        chatEvent.setType("USER_OFFLINE");
        chatEvent.setUser(mapper.map(user, PublicUserResponseDTO.class));

        messagingTemplate.convertAndSend("/queue/presence", chatEvent);
    }
}
