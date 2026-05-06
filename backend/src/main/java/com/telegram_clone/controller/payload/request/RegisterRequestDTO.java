package com.telegram_clone.controller.payload.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RegisterRequestDTO {

    @NotBlank
    private String username;

    @NotBlank
    private String displayName;

    @NotBlank
    private String password;
}
