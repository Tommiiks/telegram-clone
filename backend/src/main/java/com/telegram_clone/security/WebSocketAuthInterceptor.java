package com.telegram_clone.security;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class WebSocketAuthInterceptor implements ChannelInterceptor {

    private final JWTService jwtService;

    public WebSocketAuthInterceptor(JWTService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

        if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
            String authHeader = accessor.getFirstNativeHeader("Authorization");

            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                throw new AccessDeniedException("Missing WebSocket token.");
            }

            String token = authHeader.substring("Bearer ".length()).trim();

            Jws<Claims> jws = jwtService.parseAndValidate(token);
            String email = jws.getPayload().getSubject();

            UsernamePasswordAuthenticationToken user =
                    new UsernamePasswordAuthenticationToken(email, null, List.of());

            accessor.setUser(user);
        }

        return message;
    }
}
