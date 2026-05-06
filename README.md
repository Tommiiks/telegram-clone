# Telegram Clone

Messaging app built taking Telegram as inspiration.

The backend is Spring Boot: handles auth, users, conversations, messages, file uploads and realtime events over WebSocket. The frontend is vanilla JS, no framework, talking directly to the REST API and the STOMP socket.

## Features

- Email login with OTP (no passwords)
- JWT auth on every request
- User search, profile, username and display name
- Private chats between two users
- Saved Messages (self-chat)
- Text messages, file/photo uploads, captions
- Reply to a message
- Edit and delete messages
- Read receipts (double tick)
- Online/offline presence
- Realtime updates via WebSocket/STOMP
- OpenAPI docs

## Stack

- Java 21 + Spring Boot
- Spring Security + JWT
- Spring Data JPA + H2
- WebSocket/STOMP
- JavaMailSender (for OTP)
- SpringDoc OpenAPI

## Running it

From the `backend` folder:

```powershell
.\mvnw.cmd spring-boot:run
```

You need three env variables:

```
JWT_SECRET=...
MAIL_USERNAME=...
MAIL_PASSWORD=...
```

Then:

```
http://localhost:8080         → app
http://localhost:8080/docs.html   → Swagger UI
http://localhost:8080/h2-console  → database
```

## Auth

No registration. Just email + OTP.

```
POST /api/v1/auth/send-otp    { "email": "..." }
POST /api/v1/auth/verify-otp  { "email": "...", "code": "..." }
```

On success, the backend returns a JWT and a `newUser` flag. If it's a new account the frontend asks for username and display name before continuing.

All subsequent requests go with:

```
Authorization: Bearer <token>
```

## API

### Users

```
GET  /api/v1/users/me
GET  /api/v1/users/search?query=...
PUT  /api/v1/users/me/changeDisplayName    { "displayName": "..." }
PUT  /api/v1/users/me/changeUsername       { "username": "..." }
PUT  /api/v1/users/me/changeProfilePic     multipart: newProfilePic
```

### Conversations

```
GET  /api/v1/conversations
POST /api/v1/conversations        body: "other-user-uuid"
DELETE /api/v1/conversations/{uuid}
```

Passing your own UUID opens the Saved Messages self-chat.

### Messages

```
GET    /api/v1/conversations/{uuid}/messages?page=0&size=30
POST   /api/v1/conversations/{uuid}/messages
PUT    /api/v1/conversations/{uuid}/messages/{msgUuid}
DELETE /api/v1/conversations/{uuid}/messages/{msgUuid}
PUT    /api/v1/conversations/{uuid}/messages/read
POST   /api/v1/conversations/{uuid}/messages/files   multipart: file
```

Send text:
```json
{ "content": "ciao", "messageType": "TEXT" }
```

Reply to a message, just add:
```json
{ "content": "ciao", "replyToMessageUuid": "..." }
```

Files get stored under `uploads/` and served at `http://localhost:8080/uploads/...`

## WebSocket

Connect to `ws://localhost:8080/ws` with the JWT in the STOMP headers:

```js
const client = new StompJs.Client({
  brokerURL: "ws://localhost:8080/ws",
  connectHeaders: { Authorization: `Bearer ${token}` },
  onConnect: () => {
    client.subscribe("/user/queue/messages", msg => {
      const event = JSON.parse(msg.body);
    });
    client.subscribe("/queue/presence", msg => {
      const event = JSON.parse(msg.body);
    });
  }
});
client.activate();
```

Events:

```
MESSAGE_CREATED  →  event.message
FILE_CREATED     →  event.message
MESSAGE_UPDATED  →  event.message
MESSAGE_DELETED  →  event.deletedMessageUuid
MESSAGE_READ     →  event.readMessageUuid
USER_ONLINE      →  event.user
USER_OFFLINE     →  event.user
```

REST saves and validates, WebSocket notifies. The client sends a message via REST, the backend persists it and fires an event to both users over the socket.
