package com.telegram_clone.controller.payload.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class UpdateDisplayNameRequestDTO {
    @NotBlank
    @Size(min = 1, max = 64)
    private String displayName;
}
