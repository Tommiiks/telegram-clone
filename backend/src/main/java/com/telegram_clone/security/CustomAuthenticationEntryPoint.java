package com.telegram_clone.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AccountExpiredException;
import org.springframework.security.authentication.CredentialsExpiredException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.LockedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;

@Component
public class CustomAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void commence(HttpServletRequest request,
                         HttpServletResponse response,
                         AuthenticationException authException) throws IOException {

        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);

        String message = "Token assente, scaduto o non valido";

        if (authException instanceof DisabledException) {
            message = "Account disabilitato";
        } else if (authException instanceof LockedException) {
            message = "Account bloccato";
        } else if (authException instanceof AccountExpiredException) {
            message = "Account scaduto";
        } else if (authException instanceof CredentialsExpiredException) {
            message = "Credenziali scadute, cambia la password";
        }

        Map<String, Object> body = Map.of(
                "status", 401,
                "error", "Unauthorized",
                "message", message,
                "path", request.getRequestURI()
        );

        objectMapper.writeValue(response.getOutputStream(), body);
    }
}
