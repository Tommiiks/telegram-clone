package com.telegram_clone.repository;

import com.telegram_clone.entity.ConversationEntity;
import com.telegram_clone.entity.UserEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface ConversationRepository extends JpaRepository<ConversationEntity, Long> {

    // finds the chat between two users regardless of who is participant1 and who is participant2
    @Query("SELECT C FROM ConversationEntity C WHERE " +
            "(C.participant1=:p1 AND C.participant2=:p2) OR (C.participant1=:p2 AND C.participant2=:p1)")
    Optional<ConversationEntity> findConversationBetweenUsers(@Param("p1") UserEntity participant1,
                                                              @Param("p2") UserEntity participant2);

    // dedicated query for the saved messages self-conversation (participant1 == participant2)
    // using a separate query instead of findConversationBetweenUsers(user, user) avoids
    // any ambiguity with the OR clause when both params are the same entity
    @Query("SELECT C FROM ConversationEntity C WHERE C.participant1 = :user AND C.participant2 = :user")
    Optional<ConversationEntity> findSelfConversation(@Param("user") UserEntity user);

    // gets all conversations for a user, sorted by Pageable (caller passes sort=lastMessageAt,desc)
    // we provide an explicit countQuery so Spring Data doesn't try to auto-generate one from the
    // value query — the auto-generated version keeps ORDER BY inside the COUNT which H2 rejects
    @Query(value = "SELECT C FROM ConversationEntity C WHERE C.participant1=:p OR C.participant2=:p",
           countQuery = "SELECT COUNT(C) FROM ConversationEntity C WHERE C.participant1=:p OR C.participant2=:p")
    Page<ConversationEntity> findAllConversation(@Param("p") UserEntity participant, Pageable pageable);

    Optional<ConversationEntity> findByUuid(UUID Uuid);
}
