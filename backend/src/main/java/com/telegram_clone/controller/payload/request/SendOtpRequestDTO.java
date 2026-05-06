package com.telegram_clone.controller.payload.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class SendOtpRequestDTO {
    @NotBlank
    @Email
    // DTO For Email Auth Identification.
    private String email;
}