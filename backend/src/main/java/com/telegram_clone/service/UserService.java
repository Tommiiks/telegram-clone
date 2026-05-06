package com.telegram_clone.service;

import com.telegram_clone.controller.payload.response.ChatEventDTO;
import com.telegram_clone.controller.payload.response.PublicUserResponseDTO;
import com.telegram_clone.controller.payload.response.UserResponseDTO;
import com.telegram_clone.entity.UserEntity;
import com.telegram_clone.repository.UserRepository;
import jakarta.persistence.EntityNotFoundException;
import org.modelmapper.ModelMapper;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class UserService {

    private final UserRepository repo;
    private final ModelMapper mapper;
    private final SimpMessagingTemplate messagingTemplate;

    public UserService(UserRepository repo, ModelMapper mapper, SimpMessagingTemplate messagingTemplate) {
        this.repo = repo;
        this.mapper = mapper;
        this.messagingTemplate = messagingTemplate;
    }

    // searches users by username or display name - used for the search bar in the sidebar
    public Page<PublicUserResponseDTO> searchUsers(String query, Pageable pageable) {
        Page<UserEntity> entityPage = repo.search(query, pageable);

        List<PublicUserResponseDTO> dtos = new ArrayList<>();
        for (UserEntity e : entityPage)
            dtos.add(mapper.map(e, PublicUserResponseDTO.class));

        return new PageImpl<>(dtos, entityPage.getPageable(), entityPage.getTotalElements());
    }

    // returns the profile of the logged user - email comes from the JWT so we know it's correct
    public UserResponseDTO getProfile(String email) {
        UserEntity profile = repo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("Profile not found: " + email));
        return mapper.map(profile, UserResponseDTO.class);
    }

    // changes the display name - display names don't need to be unique so no conflict check needed
    public UserResponseDTO updateDisplayName(String email, String newDisplayName) {
        UserEntity profile = repo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("Profile not found: " + email));

        // if it's the same name as before, skip the save and just return the current profile
        if (profile.getDisplayName().equals(newDisplayName))
            return mapper.map(profile, UserResponseDTO.class);

        profile.setDisplayName(newDisplayName);
        repo.save(profile);

        // tell everyone connected via websocket that this user updated their profile
        notifyProfileUpdated(profile);

        return mapper.map(profile, UserResponseDTO.class);
    }

    // changes the username - always stored lowercase so there's no case ambiguity at all
    public UserResponseDTO updateUsername(String email, String newUsername) {
        UserEntity profile = repo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("Profile not found: " + email));

        // normalize to lowercase so @Tommiics and @tommiics are always the same thing
        String normalized = newUsername.toLowerCase();

        // already the same, nothing to do
        if (profile.getUsername().equals(normalized))
            return mapper.map(profile, UserResponseDTO.class);

        // check if someone else already has this username
        if (repo.existsByUsernameIgnoreCase(normalized))
            throw new IllegalArgumentException("The username is already used by another user");

        profile.setUsername(normalized);
        repo.save(profile);
        notifyProfileUpdated(profile);

        return mapper.map(profile, UserResponseDTO.class);
    }

    // replaces the profile picture - saves the new file on disk and deletes the old one
    public UserResponseDTO updateProfilePic(String email, MultipartFile newProfilePic) throws IOException {
        UserEntity profile = repo.findByEmail(email)
                .orElseThrow(() -> new EntityNotFoundException("Profile not found: " + email));

        // delete the old picture so we don't leave orphan files on disk
        if (profile.getProfilePicturePath() != null)
            Files.deleteIfExists(Paths.get(profile.getProfilePicturePath()));

        if (newProfilePic == null || newProfilePic.isEmpty())
            throw new IllegalArgumentException("Profile Pic File can't be empty.");

        String originalFileName = newProfilePic.getOriginalFilename();
        if (originalFileName == null || originalFileName.isBlank())
            originalFileName = "uploaded-file";

        // sanitize the name just in case
        originalFileName = originalFileName.replace("\\", "_").replace("/", "_");

        // prefix with uuid so two people can upload a file with the same name without conflict
        String storedFileName = UUID.randomUUID() + "_" + originalFileName;

        Path path = Paths.get("uploads/profile-pics/" + storedFileName);
        Files.createDirectories(path.getParent());
        Files.copy(newProfilePic.getInputStream(), path);

        profile.setProfilePicturePath("uploads/profile-pics/" + storedFileName);
        repo.save(profile);
        notifyProfileUpdated(profile);

        return mapper.map(profile, UserResponseDTO.class);
    }

    // broadcasts a USER_UPDATED event so all connected clients can update this user's avatar/name
    private void notifyProfileUpdated(UserEntity profile) {
        ChatEventDTO event = new ChatEventDTO();
        event.setType("USER_UPDATED");
        event.setUser(mapper.map(profile, PublicUserResponseDTO.class));
        messagingTemplate.convertAndSend("/queue/presence", event);
    }

}
