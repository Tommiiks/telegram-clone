package com.telegram_clone.service;

import com.telegram_clone.controller.payload.response.OtpResponseDTO;
import com.telegram_clone.entity.AuthCodeEntity;
import com.telegram_clone.entity.UserEntity;
import com.telegram_clone.repository.AuthCodeRepository;
import com.telegram_clone.repository.UserRepository;
import com.telegram_clone.security.JWTService;
import jakarta.persistence.EntityNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Optional;
import java.util.Random;

@Service
public class AuthCodeService {

    private static final Logger log = LoggerFactory.getLogger(AuthCodeService.class);

    private final UserRepository userRepo;
    private final AuthCodeRepository authCodeRepo;
    private final EmailService emailService;
    private final JWTService jwtService;

    // how many minutes before the otp expires - we read this from application.yaml
    @Value("${app.otp.expiry-minutes}")
    private int otpExpiryMinutes;

    public AuthCodeService(UserRepository userRepo, AuthCodeRepository authCodeRepo,
                           EmailService emailService, JWTService jwtService) {
        this.userRepo = userRepo;
        this.authCodeRepo = authCodeRepo;
        this.emailService = emailService;
        this.jwtService = jwtService;
    }

    // makes a random 6-digit code, with leading zeros if needed (e.g. 007391)
    public String generateRandomOTP() {
        Random rnd = new Random();
        return String.format("%06d", rnd.nextInt(999999));
    }

    public void sendOTP(String email) {
        boolean userExists = userRepo.findByEmail(email).isPresent();
        String otp = generateRandomOTP();
        LocalDateTime expiresAt = LocalDateTime.now().plusMinutes(otpExpiryMinutes);

        // if there's already an otp for this email we update it, otherwise we make a new one
        // this way we don't have duplicates in the db if the user clicks send twice
        AuthCodeEntity authCode = authCodeRepo.findByEmail(email)
                .orElse(new AuthCodeEntity(email, otp, expiresAt));

        authCode.setCode(otp);
        authCode.setExpiresAt(expiresAt);
        authCodeRepo.save(authCode);

        // always print the otp to the console so we can test without a working email
        log.info("====================================");
        log.info("  OTP for {}  →  {}", email, otp);
        log.info("====================================");

        // we try to send the email but if it fails the app still works
        // the user can just use the otp from the console
        try {
            emailService.sendOtpEmail(email, otp);
        } catch (Exception e) {
            log.warn("Email delivery failed ({}). Use the OTP printed above.", e.getMessage());
        }
    }

    public OtpResponseDTO verifyOTP(String email, String code) {
        // get the otp record - if there's nothing for this email, the user never requested one
        AuthCodeEntity authCode = authCodeRepo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("No OTP found for: " + email));

        // check if the otp is still valid
        if (LocalDateTime.now().isAfter(authCode.getExpiresAt()))
            throw new IllegalStateException("OTP expired");

        // check if the code the user typed matches the one we sent
        if (!authCode.getCode().equals(code))
            throw new IllegalArgumentException("Invalid OTP");

        // otp is correct - remove it from db so nobody can use it again
        authCodeRepo.delete(authCode);

        // check if this email already has an account or not
        Optional<UserEntity> existingUser = userRepo.findByEmail(email);
        boolean isNewUser = existingUser.isEmpty();

        // if the user doesn't exist yet we create one with a temporary username
        // they'll set a real one in the profile setup screen right after login
        UserEntity user = existingUser.orElseGet(() -> {
            UserEntity newUser = new UserEntity();
            newUser.setEmail(email);
            newUser.setUsername("user_" + newUser.getUuid().toString().substring(0, 8));
            newUser.setDisplayName("New User");
            return userRepo.save(newUser);
        });

        // give the user a jwt so they stay logged in for future requests
        String token = jwtService.generateToken(user.getEmail());
        return new OtpResponseDTO(token, isNewUser);
    }
}
