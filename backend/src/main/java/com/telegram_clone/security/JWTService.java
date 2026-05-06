package com.telegram_clone.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

@Service
public class JWTService {

    // Chiave usata per firmare e validare i token.
    private final SecretKey key;

    // Durata del token in secondi.
    private final long ttlSeconds;

    public JWTService(@Value("${app.jwt.secret}") String secret,
                      @Value("${app.jwt.ttl}") long ttl) {
        this.ttlSeconds = ttl;
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    /* --- Token creation --- */

    public String generateToken(String username) {
        return Jwts.builder()
                .subject(username)
                .issuedAt(Date.from(Instant.now()))
                .expiration(Date.from(Instant.now().plusSeconds(ttlSeconds)))
                .signWith(key)
                .compact();
    }

    /* --- Token validation --- */

    public Jws<Claims> parseAndValidate(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token);
    }
}
