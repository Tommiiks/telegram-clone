package com.telegram_clone.controller.payload.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class UpdateMessageRequestDTO {

    @NotBlank
    @Size(max = 4000, message = "Il messaggio può contenere al massimo 4000 caratteri")
    private String content;
}
