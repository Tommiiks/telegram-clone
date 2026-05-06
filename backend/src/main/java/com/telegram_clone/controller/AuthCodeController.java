package com.telegram_clone.controller;

import com.telegram_clone.controller.payload.request.SendOtpRequestDTO;
import com.telegram_clone.controller.payload.request.VerifyOtpRequestDTO;
import com.telegram_clone.controller.payload.response.OtpResponseDTO;
import com.telegram_clone.service.AuthCodeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
// Swagger / Scaler annotation.
@Tag(name = "Authentication", description = "OTP-based authentication endpoints")
public class AuthCodeController {

    private final AuthCodeService authServ;

    public AuthCodeController(AuthCodeService authServ) {
        this.authServ = authServ;
    }

    @Operation(
        summary = "Send OTP",
        description = "Sends a 6-digit OTP to the provided email. If the email is new, the OTP is sent via email. If the user already exists, the OTP is stored and can be retrieved via the active session."
    )
    @PostMapping("/send-otp")
    public ResponseEntity<?> sendOtp(@RequestBody @Valid SendOtpRequestDTO dto) {
        authServ.sendOTP(dto.getEmail());
        return ResponseEntity.ok().build();
    }

    @Operation(
        summary = "Verify OTP",
        description = "Verifies the OTP code for the given email. If correct and not expired, returns a JWT token and a flag indicating whether this is a new user (so the frontend can prompt profile setup)."
    )
    @PostMapping("/verify-otp")
    public ResponseEntity<OtpResponseDTO> verifyOtp(@RequestBody @Valid VerifyOtpRequestDTO dto) {
        OtpResponseDTO response = authServ.verifyOTP(dto.getEmail(), dto.getCode());
        return ResponseEntity.ok(response);
    }
}
