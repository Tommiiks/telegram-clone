package com.telegram_clone.security;

import com.telegram_clone.entity.UserEntity;
import com.telegram_clone.repository.UserRepository;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class CustomUserDetailsService implements UserDetailsService {

    private final UserRepository repo;

    public CustomUserDetailsService(UserRepository repo) {
        this.repo = repo;
    }

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        // The JWT subject is the email, so we load the user by email.
        Optional<UserEntity> userOptional = repo.findByEmail(email);

        if (userOptional.isEmpty()) {
            throw new UsernameNotFoundException("Credenziali non valide!");
        }

        return new CustomUserDetails(userOptional.get());
    }
}
