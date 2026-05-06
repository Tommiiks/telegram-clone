package com.telegram_clone.controller;

import com.telegram_clone.controller.payload.request.UpdateDisplayNameRequestDTO;
import com.telegram_clone.controller.payload.request.UpdateUsernameRequestDTO;
import com.telegram_clone.controller.payload.response.PublicUserResponseDTO;
import com.telegram_clone.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Objects;

@RestController
@RequestMapping("/api/v1/users")
@Validated
// Swagger / Scaler annotation.
@Tag(name = "Users", description = "User management endpoints")
public class UserController {

    private UserService serv;

    public UserController(UserService serv) {
        this.serv = serv;
    }

    @Operation(
        summary = "Search users",
        description = "Search users by username or display name using a single query string. Returns a paginated list. Supports pagination via ?page=0&size=20."
    )
    @GetMapping("search")
    public Page<PublicUserResponseDTO> searchUsers(@RequestParam @NotBlank @Size(min = 2, max = 64) String query,
                                                   Pageable pageable) {
        return serv.searchUsers(query, pageable);
    }

    @Operation(summary = "Get own profile",
            description = "Returns the profile of the currently logged-in user.")

    @GetMapping("me")
    public ResponseEntity<?> getProfile() {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(serv.getProfile(email));
    }

    @Operation(summary = "Update display name",
            description = "Update the display name of the logged user.")

    @PutMapping("me/changeDisplayName")
    public ResponseEntity<?> changeDisplayName(@RequestBody @Valid UpdateDisplayNameRequestDTO dto) {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(serv.updateDisplayName(email, dto.getDisplayName()));
    }

    @Operation(summary = "Update username",
            description = "Update the username tag of the logged user. Must be unique.")

    @PutMapping("me/changeUsername")
    public ResponseEntity<?> changeUsername(@RequestBody @Valid UpdateUsernameRequestDTO dto) {
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(serv.updateUsername(email, dto.getUsername()));
    }

    @Operation(summary = "Update profile picture",
            description = "Upload and update the profile picture of the logged user.")

    @PutMapping("me/changeProfilePic")
    public ResponseEntity<?> changeProfilePic(@RequestParam MultipartFile newProfilePic) throws IOException {
        // MultipartFile receives files sent as multipart/form-data.
        // @RequestParam extracts the file field named "newProfilePic" from the multipart request.
        String email = Objects.requireNonNull(SecurityContextHolder.getContext().getAuthentication()).getName();
        return ResponseEntity.ok(serv.updateProfilePic(email, newProfilePic));
    }




}
