package com.telegram_clone.config;


import com.telegram_clone.security.WebSocketAuthInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final WebSocketAuthInterceptor authInterceptor;

    public WebSocketConfig(WebSocketAuthInterceptor authInterceptor) {
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // This is the real WebSocket entry point.
        // The frontend connects here first, then STOMP destinations are used after the connection is open.
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // Simple in-memory broker used by Spring to deliver messages to connected clients.
        // In this project I use it mainly for private queues like /user/queue/messages.
        registry.enableSimpleBroker("/queue");

        // Messages sent by the client to /app/... would be routed to @MessageMapping methods.
        // Most chat actions here still use REST, but keeping this prefix makes the WebSocket setup standard.
        registry.setApplicationDestinationPrefixes("/app");

        // Enables per-user destinations. Backend sends with convertAndSendToUser(...),
        // frontend listens on /user/queue/messages.
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        // WebSocket frames do not go through the normal JWT HTTP filter.
        // This interceptor checks the JWT when the STOMP connection starts.
        registration.interceptors(authInterceptor);
    }
}
