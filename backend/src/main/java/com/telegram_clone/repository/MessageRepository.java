package com.telegram_clone.repository;

import com.telegram_clone.entity.ConversationEntity;
import com.telegram_clone.entity.MessageEntity;
import com.telegram_clone.entity.UserEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MessageRepository extends JpaRepository<MessageEntity, Long> {

    Optional<MessageEntity> findByUuid(UUID uuid);

    // get all messages in a conversation - we use pagination so we don't load everything at once
    Page<MessageEntity> findAllByConversation(ConversationEntity conversation, Pageable pageable);

    // get the most recent message - used for the preview in the sidebar
    Optional<MessageEntity> findTopByConversationOrderBySentAtDesc(ConversationEntity conversation);

    // used when you delete a whole conversation - we remove all messages first
    void deleteAllByConversation(ConversationEntity conversation);

    @Modifying
    @Query("UPDATE MessageEntity m SET m.replyTo = null WHERE m.replyTo = :message")
    void clearRepliesTo(@Param("message") MessageEntity message);

    @Modifying
    @Query("UPDATE MessageEntity m SET m.replyTo = null WHERE m.conversation = :conversation")
    void clearReplyLinksInConversation(@Param("conversation") ConversationEntity conversation);

    // find messages sent by the other person that the current user hasn't read yet
    // we use this to show the blue double ticks when you open a chat
    @Query("SELECT m FROM MessageEntity m WHERE m.conversation = :conversation AND m.sender <> :user AND m.isRead = false")
    List<MessageEntity> findUnreadMessagesForUser(@Param("conversation") ConversationEntity conversation,
                                                  @Param("user") UserEntity user);

}
