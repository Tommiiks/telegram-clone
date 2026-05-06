package com.telegram_clone.controller.payload.response;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class OtpResponseDTO {

    private String token;

    // Tells the frontend if this is a first-time login, so it can prompt the user to complete their profile.
    private boolean newUser;
}
