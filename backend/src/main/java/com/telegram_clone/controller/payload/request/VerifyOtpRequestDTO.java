package com.telegram_clone.controller.payload.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class VerifyOtpRequestDTO {

    @NotBlank
    @Email
    private String email;

    @NotBlank
    private String code;
}
