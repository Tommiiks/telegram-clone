'use strict';


const State = {
  currentUser:     null,
  conversations:   [],
  activeConvUuid:  null,
  messages:        new Map(),
  lastMessages:    new Map(),
  unreadCounts:    new Map(),
  onlineUsers:     new Set(),
  savedMessagesUuid: null,
  stompClient:     null,
  editingMsg:      null,
  replyingTo:      null,
  contextTarget:   null,
  conversationContextTarget: null,
  localConversationDeletes: new Set(),
  confirmResolve: null,
  searchDebounce:  null,
  wsRetries:       0,
  photoCrop:       null,
  profilePanelUser:null,
  attachmentDraft: null,
};

const MESSAGE_MAX_LENGTH = 4000;




function token() { return localStorage.getItem('jwt'); }


function authHeaders(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = token();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}


async function apiFetch(method, path, body) {
  const opts = { method, headers: authHeaders() };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, opts);
  } catch (e) {
    throw new Error('Errore di rete — il backend è raggiungibile?');
  }


  if (res.status === 401) {
    localStorage.clear();
    window.location.href = './login/login.html';
    throw new Error('Non autorizzato');
  }


  if (res.status === 204) return null;

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));

    const fieldMessage = err.fields ? Object.values(err.fields)[0] : null;
    throw new Error(fieldMessage || err.message || `Errore ${res.status}`);
  }

  return res.json();
}

const api = {
  get:    (path)        => apiFetch('GET',    path),
  post:   (path, body)  => apiFetch('POST',   path, body),
  put:    (path, body)  => apiFetch('PUT',    path, body),
  delete: (path)        => apiFetch('DELETE', path),

  async upload(path, formData, method = 'POST') {
    let res;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token()}` },
        body:    formData,
      });
    } catch (e) {
      throw new Error('Errore di rete durante upload');
    }

    if (res.status === 401) {
      localStorage.clear();
      window.location.href = './login/login.html';
      throw new Error('Non autorizzato');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Upload fallito (${res.status})`);
    }

    return res.json();
  },

  fileUrl(path) {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return `${API_URL}/${path}`;
  },
};


function connectWebSocket() {
  if (!token() || !window.StompJs) return;

  const client = new StompJs.Client({
    brokerURL:      WS_URL,
    connectHeaders: { Authorization: `Bearer ${token()}` },
    reconnectDelay: 5000,

    onConnect() {
      State.wsRetries = 0;


      client.subscribe('/user/queue/messages', frame => {
        try { handleWsEvent(JSON.parse(frame.body)); }
        catch (e) { console.error('WS parse error', e); }
      });


      client.subscribe('/queue/presence', frame => {
        try { handlePresenceEvent(JSON.parse(frame.body)); }
        catch (e) { console.error('WS presence error', e); }
      });
    },

    onStompError(frame) {
      console.warn('STOMP error', frame.headers?.message);
    },
  });

  client.activate();
  State.stompClient = client;
}

function handleWsEvent(event) {
  const { type, conversationUuid: cUuid, message, deletedMessageUuid, readMessageUuid } = event;

  switch (type) {
    case 'MESSAGE_CREATED':
    case 'FILE_CREATED':
      onNewMessage(cUuid, message);
      break;
    case 'MESSAGE_UPDATED':
      onMessageUpdated(cUuid, message);
      break;
    case 'MESSAGE_DELETED':
      onMessageDeleted(cUuid, deletedMessageUuid);
      break;
    case 'MESSAGE_READ':
      onMessageRead(cUuid, readMessageUuid);
      break;
    case 'CONVERSATION_DELETED':
      onConversationDeleted(cUuid);
      break;
  }
}

function handlePresenceEvent(event) {
  const { type, user } = event;
  if (!user) return;

  if (type === 'USER_ONLINE') {
    State.onlineUsers.add(user.uuid);
    syncUserEverywhere({ ...user, isOnline: true });
    return;
  }

  if (type === 'USER_OFFLINE') {
    State.onlineUsers.delete(user.uuid);
    syncUserEverywhere({ ...user, isOnline: false });
    return;
  }

  if (type === 'USER_UPDATED') {
    syncUserEverywhere(user);
  }
}




function isSavedConv(conv) {
  return conv?.isSavedMessages === true
    || (conv?.participant1?.uuid && conv.participant1.uuid === conv.participant2?.uuid);
}

function getOtherUser(conv) {
  if (isSavedConv(conv)) return State.currentUser;
  if (!conv.participant1 || !conv.participant2) return State.currentUser;
  return conv.participant1.uuid === State.currentUser.uuid
    ? conv.participant2
    : conv.participant1;
}

function getConvByUuid(uuid) {
  return State.conversations.find(c => c.uuid === uuid) || null;
}

function rememberSavedConversation(conv) {
  if (!conv?.uuid) return null;

  State.savedMessagesUuid = conv.uuid;
  State.localConversationDeletes.delete(conv.uuid);

  const existingIndex = State.conversations.findIndex(c => c.uuid === conv.uuid);
  if (existingIndex >= 0) {
    State.conversations[existingIndex] = { ...State.conversations[existingIndex], ...conv };
  } else {
    State.conversations.unshift(conv);
  }

  if (conv.lastMessage) {
    State.lastMessages.set(conv.uuid, conv.lastMessage);
  } else {
    State.lastMessages.delete(conv.uuid);
  }

  return conv;
}

function getMessagePreviewText(msg) {
  if (!msg) return 'Messaggio';
  if (msg.messageType === 'FILE') return msg.fileName || 'File';
  return msg.content || 'Messaggio';
}

function getMessageAuthorName(msg) {
  if (!msg?.sender) return 'Messaggio';
  if (State.currentUser?.uuid && msg.sender.uuid === State.currentUser.uuid) return 'Tu';
  return msg.sender.displayName || msg.sender.username || 'Utente';
}

function scrollToMessage(messageUuid) {
  if (!messageUuid) return;
  const el = document.querySelector(`.msg-wrap[data-uuid="${messageUuid}"]`);
  if (!el) {
    showToast('Messaggio non caricato', 'info');
    return;
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('reply-highlight');
  setTimeout(() => el.classList.remove('reply-highlight'), 1000);
}

function buildMessageReplyPreview(msg) {
  const reply = msg.replyTo;
  if (!reply?.uuid) return null;

  const preview = document.createElement('div');
  preview.className = 'message-reply-preview';
  preview.addEventListener('click', e => {
    e.stopPropagation();
    scrollToMessage(reply.uuid);
  });

  const author = document.createElement('div');
  author.className = 'message-reply-author';
  author.textContent = getMessageAuthorName(reply);

  const text = document.createElement('div');
  text.className = 'message-reply-text';
  text.textContent = getMessagePreviewText(reply);

  preview.appendChild(author);
  preview.appendChild(text);
  return preview;
}

function syncCurrentUserInConversations() {
  if (!State.currentUser) return;

  State.conversations.forEach(conv => {
    if (conv.participant1?.uuid === State.currentUser.uuid) {
      conv.participant1 = { ...conv.participant1, ...State.currentUser };
    }
    if (conv.participant2?.uuid === State.currentUser.uuid) {
      conv.participant2 = { ...conv.participant2, ...State.currentUser };
    }
  });
}

function syncUserEverywhere(user) {
  if (!user?.uuid) return;

  const mergeUser = existing => existing?.uuid === user.uuid
    ? { ...existing, ...user }
    : existing;

  if (State.currentUser?.uuid === user.uuid) {
    State.currentUser = { ...State.currentUser, ...user };
    populateMenuDrawer();
  }

  State.conversations.forEach(conv => {
    conv.participant1 = mergeUser(conv.participant1);
    conv.participant2 = mergeUser(conv.participant2);
  });

  State.messages.forEach(msgs => {
    msgs.forEach(msg => {
      if (msg.sender?.uuid === user.uuid) msg.sender = { ...msg.sender, ...user };
    });
  });

  State.lastMessages.forEach((msg, convUuid) => {
    if (msg?.sender?.uuid === user.uuid) {
      State.lastMessages.set(convUuid, {
        ...msg,
        sender: { ...msg.sender, ...user },
      });
    }
  });

  if (State.activeConvUuid) {
    const conv = getConvByUuid(State.activeConvUuid);
    if (conv) updateChatHeader(conv);
    if (State.messages.has(State.activeConvUuid)) renderMessages(State.activeConvUuid);
  }

  if (State.profilePanelUser?.uuid === user.uuid) {
    const panelUser = State.currentUser?.uuid === user.uuid
      ? State.currentUser
      : findUserInConversations(user.uuid) || user;
    openProfilePanel(panelUser);
  }

  renderConversationsList();
}

function findUserInConversations(userUuid) {
  for (const conv of State.conversations) {
    if (conv.participant1?.uuid === userUuid) return conv.participant1;
    if (conv.participant2?.uuid === userUuid) return conv.participant2;
  }
  return null;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  const d    = new Date(dateStr);
  const now  = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return 'Oggi';
  if (diff === 1) return 'Ieri';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatLastSeen(user) {
  if (!user) return '';
  if (user.isOnline || State.onlineUsers.has(user.uuid)) return 'online';
  if (!user.lastSeen) return '';
  const d    = new Date(user.lastSeen);
  const diff = Math.floor((Date.now() - d) / 60000);
  if (diff < 5)        return 'visto di recente';
  if (diff < 60)       return `visto ${diff} min fa`;
  if (diff < 1440)     return `visto alle ${formatTime(user.lastSeen)}`;
  return `visto il ${formatDateLabel(user.lastSeen)}`;
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name[0].toUpperCase();
}

const AVATAR_COLORS = [
  '#c03d33','#4fad2d','#d09306','#168acd','#8544d6',
  '#cd4073','#2996ad','#ce671b','#3d8b37','#6c6eb5',
];

function avatarColor(uuid) {
  if (!uuid) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < uuid.length; i++) h = (h * 31 + uuid.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function createAvatar(user, sizeClass) {
  const el = document.createElement('div');
  el.className = `avatar ${sizeClass}`;

  if (user.profilePicturePath) {
    const img = document.createElement('img');
    img.src = api.fileUrl(user.profilePicturePath);
    img.alt = user.displayName || '';
    img.onerror = () => {
      img.remove();
      el.style.background = avatarColor(user.uuid);
      el.textContent = getInitials(user.displayName || user.username);
    };
    el.appendChild(img);
  } else {
    el.style.background = avatarColor(user.uuid);
    el.textContent = getInitials(user.displayName || user.username);
  }

  return el;
}


function buildConvItem(conv) {
  const saved   = isSavedConv(conv);
  const other   = getOtherUser(conv);
  const lastMsg = State.lastMessages.get(conv.uuid);
  const unread  = State.unreadCounts.get(conv.uuid) || 0;
  const isActive = conv.uuid === State.activeConvUuid;

  const item = document.createElement('div');
  item.className = `conv-item${isActive ? ' active' : ''}${saved ? ' saved-messages-item' : ''}`;
  item.dataset.uuid = conv.uuid;

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'conv-avatar-wrap';

  if (saved) {
    const savedAvatar = document.createElement('div');
    savedAvatar.className = 'avatar avatar-lg saved-messages-avatar';
    savedAvatar.innerHTML = '<i class="fa-solid fa-bookmark"></i>';
    avatarWrap.appendChild(savedAvatar);
  } else {
    avatarWrap.appendChild(createAvatar(other, 'avatar-lg'));
    const isOnline = other.isOnline || State.onlineUsers.has(other.uuid);
    if (isOnline) {
      const dot = document.createElement('div');
      dot.className = 'online-dot';
      avatarWrap.appendChild(dot);
    }
  }

  const content = document.createElement('div');
  content.className = 'conv-content';

  const header = document.createElement('div');
  header.className = 'conv-header';

  const name = document.createElement('span');
  name.className = 'conv-name';
  name.textContent = saved ? 'Messaggi Salvati' : (other.displayName || other.username || 'Utente');

  const time = document.createElement('span');
  time.className = 'conv-time';
  time.textContent = lastMsg
    ? formatTime(lastMsg.sentAt)
    : (conv.lastMessageAt ? formatTime(conv.lastMessageAt) : '');

  const meta = document.createElement('div');
  meta.className = 'conv-meta';

  const menuBtn = document.createElement('button');
  menuBtn.className = 'conv-menu-btn';
  menuBtn.type = 'button';
  menuBtn.title = 'Opzioni chat';
  menuBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
  menuBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const rect = menuBtn.getBoundingClientRect();
    showConversationContextMenu(rect.left, rect.bottom + 4, conv.uuid);
  });

  meta.appendChild(time);
  meta.appendChild(menuBtn);
  header.appendChild(name);
  header.appendChild(meta);

  const preview = document.createElement('div');
  preview.className = 'conv-preview';

  const previewText = document.createElement('span');
  previewText.className = 'conv-preview-text';

  if (lastMsg) {
    if (lastMsg.messageType === 'FILE') {
      previewText.innerHTML = `<i class="fa-solid fa-paperclip" style="margin-right:3px;font-size:11px"></i>${lastMsg.fileName || 'File'}`;
    } else {
      const mine = lastMsg.sender.uuid === State.currentUser.uuid;
      previewText.textContent = (mine ? 'Tu: ' : '') + (lastMsg.content || '');
    }
  } else {
    previewText.classList.add('muted');
    previewText.textContent = 'Nessun messaggio';
  }

  preview.appendChild(previewText);

  if (unread > 0) {
    const badge = document.createElement('div');
    badge.className = 'unread-badge';
    badge.textContent = unread > 99 ? '99+' : String(unread);
    preview.appendChild(badge);
  }

  content.appendChild(header);
  content.appendChild(preview);
  item.appendChild(avatarWrap);
  item.appendChild(content);

  if (saved) {
    item.addEventListener('click', () => openSavedMessages());
  } else {
    item.addEventListener('click', () => openConversation(conv.uuid));
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      showConversationContextMenu(e.clientX, e.clientY, conv.uuid);
    });
  }

  return item;
}

function buildStaticSavedItem() {
  const isActive = State.savedMessagesUuid && State.savedMessagesUuid === State.activeConvUuid;

  const item = document.createElement('div');
  item.className = `conv-item saved-messages-item${isActive ? ' active' : ''}`;
  item.id = 'staticSavedMessagesItem';

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'conv-avatar-wrap';
  const savedAvatar = document.createElement('div');
  savedAvatar.className = 'avatar avatar-lg saved-messages-avatar';
  savedAvatar.innerHTML = '<i class="fa-solid fa-bookmark"></i>';
  avatarWrap.appendChild(savedAvatar);

  const content = document.createElement('div');
  content.className = 'conv-content';

  const header = document.createElement('div');
  header.className = 'conv-header';

  const name = document.createElement('span');
  name.className = 'conv-name';
  name.textContent = 'Messaggi Salvati';

  header.appendChild(name);

  const preview = document.createElement('div');
  preview.className = 'conv-preview';
  const previewText = document.createElement('span');
  previewText.className = 'conv-preview-text muted';
  previewText.textContent = 'I tuoi messaggi personali';
  preview.appendChild(previewText);

  content.appendChild(header);
  content.appendChild(preview);
  item.appendChild(avatarWrap);
  item.appendChild(content);
  item.addEventListener('click', () => openSavedMessages());

  return item;
}

async function openSavedMessages() {
  try {
    const conv = await api.get('/api/v1/conversations/saved');
    rememberSavedConversation(conv);
    renderConversationsList();
    await openConversation(conv.uuid);
  } catch (e) {
    console.error('openSavedMessages: failed to fetch/create conversation', e);
    showToast('Impossibile aprire i messaggi salvati', 'error');
  }
}

function renderConversationsList() {
  const list = document.getElementById('conversationsList');
  if (!list) return;

  list.innerHTML = '';

  const savedConv = State.conversations.find(c => isSavedConv(c));
  const regularConvs = State.conversations
    .filter(c => !isSavedConv(c))
    .sort((a, b) => {
      const ta = new Date(a.lastMessageAt || a.createdAt || 0);
      const tb = new Date(b.lastMessageAt || b.createdAt || 0);
      return tb - ta;
    });

  if (savedConv) {
    list.appendChild(buildConvItem(savedConv));
  } else {
    list.appendChild(buildStaticSavedItem());
  }

  regularConvs.forEach(conv => list.appendChild(buildConvItem(conv)));
}


function renderMessages(convUuid) {
  const list = document.getElementById('messagesList');
  if (!list) return;

  const msgs = State.messages.get(convUuid) || [];
  list.innerHTML = '';

  if (msgs.length === 0) {
    list.innerHTML = '<div class="no-messages">Nessun messaggio. Di\' ciao! 👋</div>';
    return;
  }

  let lastDateLabel = null;

  msgs.forEach((msg, idx) => {
    const dateLabel = formatDateLabel(msg.sentAt);
    if (dateLabel !== lastDateLabel) {
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.innerHTML = `<span>${dateLabel}</span>`;
      list.appendChild(sep);
      lastDateLabel = dateLabel;
    }

    const prev = idx > 0 ? msgs[idx - 1] : null;
    const next = idx < msgs.length - 1 ? msgs[idx + 1] : null;
    const isMine = msg.sender.uuid === State.currentUser.uuid;

    const groupWithPrev = prev
      && prev.sender.uuid === msg.sender.uuid
      && (new Date(msg.sentAt) - new Date(prev.sentAt)) < 300_000;

    const groupWithNext = next
      && next.sender.uuid === msg.sender.uuid
      && (new Date(next.sentAt) - new Date(msg.sentAt)) < 300_000;

    list.appendChild(buildMessageEl(msg, isMine, groupWithPrev, groupWithNext));
  });

  scrollToBottom();
}

function buildMessageEl(msg, isMine, groupWithPrev, groupWithNext) {
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${isMine ? 'msg-sent' : 'msg-received'}`;
  if (groupWithPrev) wrap.classList.add('grouped-top');
  if (groupWithNext) wrap.classList.add('grouped-bottom');
  wrap.dataset.uuid = msg.uuid;


  if (!isMine) {
    if (!groupWithNext) {
      wrap.appendChild(createAvatar(msg.sender, 'avatar-sm'));
    } else {
      const ph = document.createElement('div');
      ph.className = 'avatar-placeholder';
      wrap.appendChild(ph);
    }
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const replyPreview = buildMessageReplyPreview(msg);
  if (replyPreview) bubble.appendChild(replyPreview);

  if (msg.messageType === 'FILE') {
    bubble.appendChild(buildFileContent(msg));
  } else {
    const txt = document.createElement('div');
    txt.className = 'msg-text';
    txt.textContent = msg.content || '';
    bubble.appendChild(txt);
  }


  const meta = document.createElement('div');
  meta.className = 'msg-meta';

  if (msg.editedAt) {
    const editedEl = document.createElement('span');
    editedEl.className = 'msg-edited';
    editedEl.textContent = 'modificato';
    meta.appendChild(editedEl);
  }

  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = formatTime(msg.sentAt);
  meta.appendChild(timeEl);

  if (isMine) {
    const tick = document.createElement('span');
    tick.className = `msg-tick${msg.isRead ? ' read' : ''}`;
    tick.innerHTML = msg.isRead
      ? '<i class="fa-solid fa-check-double"></i>'
      : '<i class="fa-solid fa-check"></i>';
    meta.appendChild(tick);
  }

  bubble.appendChild(meta);


  if (!groupWithNext) {
    const tail = document.createElement('div');
    tail.className = 'bubble-tail';
    tail.innerHTML = `<svg viewBox="0 0 11 20" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.851 20C9.12 14.517 4.758 11.333 0 10.333V0c6.667 1.333 11.333 8.667 10.851 20z"/>
    </svg>`;
    bubble.appendChild(tail);
  }


  bubble.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, msg.uuid, msg.content || '', isMine, msg);
  });

  wrap.appendChild(bubble);
  return wrap;
}

function buildFileContent(msg) {
  const ext = getFileExtension(msg.fileName);
  const isImage = isImageExtension(ext) && !msg.asDocument;
  const isVideo = isVideoExtension(ext) && !msg.asDocument;
  const content = document.createElement('div');
  content.className = 'file-content';

  if (isImage && msg.filePath) {
    const img = document.createElement('img');
    img.className = 'file-img';
    img.src = api.fileUrl(msg.filePath);
    img.alt = msg.fileName || '';
    img.loading = 'lazy';
    img.addEventListener('click', () => openImageViewer(api.fileUrl(msg.filePath)));
    content.appendChild(img);
  } else if (isVideo && msg.filePath) {
    const video = document.createElement('video');
    video.className = 'file-video';
    video.src = api.fileUrl(msg.filePath);
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    content.appendChild(video);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'file-msg';

    const icon = document.createElement('div');
    icon.className = 'file-icon';
    icon.innerHTML = '<i class="fa-solid fa-file"></i>';

    const info = document.createElement('div');
    info.className = 'file-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';
    nameEl.textContent = msg.fileName || 'File';

    const link = document.createElement('a');
    link.className = 'file-download';
    link.href = api.fileUrl(msg.filePath);
    link.target = '_blank';
    link.download = msg.fileName || 'file';
    link.textContent = 'Scarica';
    link.addEventListener('click', e => e.stopPropagation());

    info.appendChild(nameEl);
    info.appendChild(link);
    wrap.appendChild(icon);
    wrap.appendChild(info);
    content.appendChild(wrap);
  }

  if (msg.content) {
    const caption = document.createElement('div');
    caption.className = 'msg-text file-caption';
    caption.textContent = msg.content;
    content.appendChild(caption);
  }

  return content;
}

function scrollToBottom(smooth = false) {
  const area = document.getElementById('messagesArea');
  if (area) area.scrollTo({ top: area.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}


async function loadConversations() {
  try {
    const data = await api.get('/api/v1/conversations?size=100&sort=lastMessageAt,desc');
    State.conversations = data.content || [];
    State.conversations.forEach(conv => {
      if (isSavedConv(conv)) State.savedMessagesUuid = conv.uuid;

      [conv.participant1, conv.participant2].forEach(p => {
        if (!p) return;
        if (p.isOnline) State.onlineUsers.add(p.uuid);
        else State.onlineUsers.delete(p.uuid);
      });

      if (conv.lastMessage) {
        State.lastMessages.set(conv.uuid, conv.lastMessage);
      } else {
        State.lastMessages.delete(conv.uuid);
      }
    });
    try { renderConversationsList(); } catch (re) { console.error('renderConversationsList', re); }
  } catch (e) {
    console.error('loadConversations', e);
    showToast('Impossibile caricare le conversazioni', 'error');
    try { renderConversationsList(); } catch (_) {}
  }
}

async function openConversation(uuid) {
  closeSearchPanel();

  if (State.activeConvUuid && State.activeConvUuid !== uuid) {
    cancelEdit();
    cancelReply();
  }

  State.activeConvUuid = uuid;
  State.unreadCounts.set(uuid, 0);

  const conv = getConvByUuid(uuid);
  if (!conv) {
    if (uuid === State.savedMessagesUuid) {
      State.savedMessagesUuid = null;
      await openSavedMessages();
    }
    return;
  }


  document.getElementById('welcomeScreen').hidden = true;
  const chatArea = document.getElementById('chatArea');
  chatArea.hidden = false;


  document.getElementById('profilePanel').hidden = true;

  updateChatHeader(conv);


  document.querySelectorAll('.conv-item').forEach(el =>
    el.classList.toggle('active', el.dataset.uuid === uuid));

  renderConversationsList();


  if (!State.messages.has(uuid)) {
    document.getElementById('messagesList').innerHTML =
      '<div class="no-messages"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    await loadMessages(uuid);
  } else {
    renderMessages(uuid);
  }

  markMessagesAsRead(uuid);
  document.getElementById('messageInput').focus();
}

function updateChatHeader(conv) {
  const saved    = isSavedConv(conv);
  const other    = getOtherUser(conv);
  const avatarEl = document.getElementById('chatHeaderAvatar');
  const statusEl = document.getElementById('chatHeaderStatus');
  const nameEl   = document.getElementById('chatHeaderName');
  const onlineDot = document.getElementById('chatHeaderOnlineDot');

  if (avatarEl) {
    avatarEl.innerHTML = '';
    if (saved) {
      const a = document.createElement('div');
      a.className = 'avatar avatar-md saved-messages-avatar';
      a.innerHTML = '<i class="fa-solid fa-bookmark"></i>';
      avatarEl.appendChild(a);
    } else {
      avatarEl.appendChild(createAvatar(other, 'avatar-md'));
    }
  }

  if (nameEl) nameEl.textContent = saved ? 'Messaggi Salvati' : (other.displayName || other.username || 'Utente');

  if (saved) {
    if (statusEl) { statusEl.textContent = 'I tuoi messaggi personali'; statusEl.className = 'chat-header-status'; }
    if (onlineDot) onlineDot.hidden = true;
  } else {
    const isOnline = other.isOnline || State.onlineUsers.has(other.uuid);
    if (statusEl) {
      statusEl.textContent = formatLastSeen(other);
      statusEl.className   = `chat-header-status${isOnline ? ' online' : ''}`;
    }
    if (onlineDot) onlineDot.hidden = !isOnline;
  }
}

async function loadMessages(convUuid) {
  try {
    const data = await api.get(
      `/api/v1/conversations/${convUuid}/messages?size=100&sort=sentAt,asc`
    );
    const msgs = data.content || [];
    State.messages.set(convUuid, msgs);
    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      State.lastMessages.set(convUuid, last);

      const conv = getConvByUuid(convUuid);
      if (conv) conv.lastMessageAt = last.sentAt;
      renderConversationsList();
    }
    if (convUuid === State.activeConvUuid) renderMessages(convUuid);
  } catch (e) {
    console.error('loadMessages', e);
    if (convUuid === State.activeConvUuid)
      document.getElementById('messagesList').innerHTML =
        '<div class="no-messages">Errore nel caricamento dei messaggi</div>';
  }
}

async function markMessagesAsRead(convUuid) {
  try {
    await api.put(`/api/v1/conversations/${convUuid}/messages/read`);
  } catch (_) {  }
}


async function sendMessage() {
  const input   = document.getElementById('messageInput');
  const content = input.value.trim();
  const lengthState = updateMessageCharCounter();

  if (lengthState.overLimit) {
    showToast(`Messaggio troppo lungo: ${lengthState.length}/${MESSAGE_MAX_LENGTH} caratteri`, 'error');
    return;
  }

  if (State.editingMsg) {
    if (!content) return;
    await confirmEdit(content);
    return;
  }

  if (!content || !State.activeConvUuid) return;

  input.value = '';
  input.style.height = 'auto';
  updateMessageCharCounter();

  try {
    const replyToMessageUuid = State.replyingTo?.uuid;
    await api.post(`/api/v1/conversations/${State.activeConvUuid}/messages`, {
      content,
      messageType: 'TEXT',
      ...(replyToMessageUuid ? { replyToMessageUuid } : {}),
    });
    if (replyToMessageUuid) cancelReply();
  } catch (e) {
    input.value = content;
    updateMessageCharCounter();
    showToast(e.message || 'Invio fallito', 'error');
  }
}

async function sendFile(file, options = {}) {
  if (!file || !State.activeConvUuid) return;

  const fd = new FormData();
  fd.append('file', file);
  if (options.caption) fd.append('caption', options.caption);
  if (options.asDocument) fd.append('asDocument', 'true');
  if (options.replyToMessageUuid) fd.append('replyToMessageUuid', options.replyToMessageUuid);

  try {
    await api.upload(
      `/api/v1/conversations/${State.activeConvUuid}/messages/files`,
      fd
    );
  } catch (e) {
    showToast(e.message || 'Upload fallito', 'error');
    throw e;
  }
}


function openAttachmentComposer(files) {
  const selected = Array.from(files || []);
  if (!selected.length) return;

  if (!State.activeConvUuid) {
    showToast('Apri una chat prima di allegare file', 'error');
    return;
  }

  if (!State.attachmentDraft) {
    State.attachmentDraft = { files: [], sendAsDocumentTouched: false };
    document.getElementById('attachmentCaption').value = '';
    document.getElementById('sendAsDocument').checked = false;
  }

  State.attachmentDraft.files.push(...selected);
  if (!State.attachmentDraft.sendAsDocumentTouched && selected.some(isInlineMediaFile)) {
    document.getElementById('sendAsDocument').checked = false;
  }
  document.getElementById('attachmentComposer').hidden = false;
  renderAttachmentComposer();
}

function openSelectedAttachments(files) {
  const selected = Array.from(files || []);
  if (!selected.length) return;

  if (!State.activeConvUuid) {
    showToast('Apri una chat prima di allegare file', 'error');
    return;
  }

  const imageIndex = selected.findIndex(isImageFile);
  if (imageIndex === -1) {
    openAttachmentComposer(selected);
    return;
  }

  const beforeImage = selected.slice(0, imageIndex);
  const image = selected[imageIndex];
  const afterImage = selected.slice(imageIndex + 1);

  if (beforeImage.length) openAttachmentComposer(beforeImage);

  openPhotoCrop(image, {
    mode: 'attachment',
    applyLabel: afterImage.some(isImageFile) ? 'Avanti' : 'Aggiungi',
    onApply: croppedFile => {
      openAttachmentComposer([croppedFile]);
      if (afterImage.length) openSelectedAttachments(afterImage);
    },
  });
}

function closeAttachmentComposer() {
  clearAttachmentPreviewUrls();
  State.attachmentDraft = null;
  document.getElementById('attachmentComposer').hidden = true;
  document.getElementById('attachmentCaption').value = '';
  document.getElementById('sendAsDocument').checked = false;
}

function clearAttachmentPreviewUrls() {
  if (!State.attachmentDraft) return;
  State.attachmentDraft.files.forEach(item => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
}

function renderAttachmentComposer() {
  const draft = State.attachmentDraft;
  const list = document.getElementById('attachmentPreviews');
  const title = document.getElementById('attachmentTitle');

  if (!draft || !draft.files.length) {
    closeAttachmentComposer();
    return;
  }

  title.textContent = draft.files.length === 1
    ? getSingleAttachmentTitle(draft.files[0])
    : `Invia ${draft.files.length} allegati`;

  list.innerHTML = '';
  draft.files.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = `attachment-preview${isInlineMediaFile(file) ? '' : ' attachment-file-preview'}`;

    if (isImageFile(file)) {
      const img = document.createElement('img');
      file.previewUrl ||= URL.createObjectURL(file);
      img.src = file.previewUrl;
      img.alt = file.name;
      item.appendChild(img);
    } else if (isVideoFile(file)) {
      const video = document.createElement('video');
      file.previewUrl ||= URL.createObjectURL(file);
      video.src = file.previewUrl;
      video.muted = true;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      item.appendChild(video);
    } else {
      item.innerHTML = `
        <i class="fa-solid fa-file"></i>
        <span class="attachment-preview-name">${escHtml(file.name)}</span>`;
    }

    const remove = document.createElement('button');
    remove.className = 'attachment-remove-btn';
    remove.type = 'button';
    remove.title = 'Rimuovi';
    remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    remove.addEventListener('click', () => removeAttachmentFile(index));

    item.appendChild(remove);
    list.appendChild(item);
  });
}

function removeAttachmentFile(index) {
  const draft = State.attachmentDraft;
  if (!draft) return;

  const [removed] = draft.files.splice(index, 1);
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  renderAttachmentComposer();
}

function isImageFile(file) {
  return file?.type?.startsWith('image/') || isImageExtension(getFileExtension(file?.name));
}

function isVideoFile(file) {
  return file?.type?.startsWith('video/') || isVideoExtension(getFileExtension(file?.name));
}

function isInlineMediaFile(file) {
  return isImageFile(file) || isVideoFile(file);
}

function getFileExtension(fileName = '') {
  const parts = String(fileName).toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function isImageExtension(ext) {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
}

function isVideoExtension(ext) {
  return ['mp4', 'webm', 'mov', 'm4v', 'ogg', 'ogv'].includes(ext);
}

function getSingleAttachmentTitle(file) {
  if (isImageFile(file)) return "Invia un'immagine";
  if (isVideoFile(file)) return 'Invia un video';
  return 'Invia un file';
}

async function sendAttachmentDraft() {
  const draft = State.attachmentDraft;
  if (!draft?.files.length) return;

  const sendBtn = document.getElementById('sendAttachmentBtn');
  const caption = document.getElementById('attachmentCaption').value.trim();
  const asDocumentInput = document.getElementById('sendAsDocument');
  const asDocument = asDocumentInput.checked && Boolean(draft.sendAsDocumentTouched);
  const replyToMessageUuid = State.replyingTo?.uuid || null;

  sendBtn.disabled = true;
  try {
    showOverlay();
    for (let i = 0; i < draft.files.length; i++) {
      await sendFile(draft.files[i], {
        caption: i === 0 ? caption : '',
        asDocument,
        replyToMessageUuid: i === 0 ? replyToMessageUuid : null,
      });
    }
    closeAttachmentComposer();
    if (replyToMessageUuid) cancelReply();
  } finally {
    hideOverlay();
    sendBtn.disabled = false;
  }
}


function startEdit(msgUuid, content) {
  cancelReply();
  State.editingMsg = { uuid: msgUuid, convUuid: State.activeConvUuid };

  const input          = document.getElementById('messageInput');
  const bar            = document.getElementById('editBar');
  const barPreview     = document.getElementById('editBarPreview');

  barPreview.textContent = content;
  bar.hidden = false;
  input.value = content;
  input.focus();
  input.setSelectionRange(content.length, content.length);
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  updateMessageCharCounter();
}

function startReply(msg) {
  if (!msg?.uuid) return;
  if (State.editingMsg) cancelEdit();

  State.replyingTo = msg;

  document.getElementById('replyBarTitle').textContent = `Risposta a ${getMessageAuthorName(msg)}`;
  document.getElementById('replyBarPreview').textContent = getMessagePreviewText(msg);
  document.getElementById('replyBar').hidden = false;
  document.getElementById('messageInput').focus();
}

function cancelReply() {
  State.replyingTo = null;
  const bar = document.getElementById('replyBar');
  if (bar) bar.hidden = true;
}

function cancelEdit() {
  State.editingMsg = null;
  document.getElementById('editBar').hidden = true;
  document.getElementById('messageInput').value = '';
  document.getElementById('messageInput').style.height = 'auto';
  updateMessageCharCounter();
}

function updateMessageCharCounter() {
  const input = document.getElementById('messageInput');
  const counter = document.getElementById('messageCharCounter');
  const wrap = input?.closest('.message-input-wrap');
  const sendBtn = document.getElementById('sendBtn');
  if (!input || !counter || !wrap) return { length: 0, overLimit: false };

  const length = input.value.length;
  const nearLimit = length >= Math.floor(MESSAGE_MAX_LENGTH * .9);
  const overLimit = length > MESSAGE_MAX_LENGTH;

  counter.textContent = `${length}/${MESSAGE_MAX_LENGTH}`;
  counter.hidden = length === 0 || (!nearLimit && !overLimit);
  counter.classList.toggle('near-limit', nearLimit && !overLimit);
  counter.classList.toggle('over-limit', overLimit);
  wrap.classList.toggle('over-limit', overLimit);
  if (sendBtn) sendBtn.disabled = overLimit;

  return { length, overLimit };
}

async function confirmEdit(content) {
  const { uuid, convUuid } = State.editingMsg;
  cancelEdit();
  try {
    await api.put(`/api/v1/conversations/${convUuid}/messages/${uuid}`, { content });
  } catch (e) {
    showToast(e.message || 'Modifica fallita', 'error');
  }
}

async function deleteMessage(msgUuid) {
  if (!State.activeConvUuid) return;
  try {
    await api.delete(`/api/v1/conversations/${State.activeConvUuid}/messages/${msgUuid}`);
  } catch (e) {
    showToast(e.message || 'Eliminazione fallita', 'error');
  }
}

function removeConversationLocally(convUuid) {
  const wasActive = State.activeConvUuid === convUuid;
  const removedConv = getConvByUuid(convUuid);
  const wasSaved = removedConv ? isSavedConv(removedConv) : State.savedMessagesUuid === convUuid;

  State.conversations = State.conversations.filter(c => c.uuid !== convUuid);
  State.messages.delete(convUuid);
  State.lastMessages.delete(convUuid);
  State.unreadCounts.delete(convUuid);
  State.localConversationDeletes.delete(convUuid);

  if (wasSaved) {
    State.savedMessagesUuid = null;
  }

  if (wasActive) {
    State.activeConvUuid = null;
    cancelEdit();
    cancelReply();
    if (State.attachmentDraft) closeAttachmentComposer();

    document.getElementById('chatArea').hidden = true;
    document.getElementById('welcomeScreen').hidden = false;
    document.getElementById('profilePanel').hidden = true;
    document.getElementById('messagesList').innerHTML = '';
  }

  renderConversationsList();
  return wasActive;
}

async function deleteConversation(convUuid = State.conversationContextTarget?.convUuid) {
  if (!convUuid) return;
  const conv = getConvByUuid(convUuid);
  const other = conv ? getOtherUser(conv) : null;
  const name = other?.displayName || other?.username || 'questa chat';

  const confirmed = await showConfirmDialog({
    title: 'Eliminare chat?',
    message: `La conversazione con ${name} e tutti i messaggi verranno rimossi definitivamente.`,
    confirmText: 'Elimina',
    danger: true,
  });
  if (!confirmed) return;

  try {
    showOverlay();
    State.localConversationDeletes.add(convUuid);
    await api.delete(`/api/v1/conversations/${convUuid}`);
    removeConversationLocally(convUuid);
    State.localConversationDeletes.delete(convUuid);
    showToast('Chat eliminata', 'success');
  } catch (e) {
    State.localConversationDeletes.delete(convUuid);
    showToast(e.message || 'Eliminazione chat fallita', 'error');
  } finally {
    hideOverlay();
  }
}


function onNewMessage(convUuid, msg) {
  const msgs = State.messages.get(convUuid) || [];
  const existingIndex = msgs.findIndex(m => m.uuid === msg.uuid);
  const isNewMessage = existingIndex === -1;

  if (isNewMessage) {
    msgs.push(msg);
  } else {
    msgs[existingIndex] = { ...msgs[existingIndex], ...msg };
  }
  State.messages.set(convUuid, msgs);

  State.lastMessages.set(convUuid, msg);


  const conv = getConvByUuid(convUuid);
  if (conv) {
    conv.lastMessageAt = msg.sentAt;
  } else {
    loadConversations().then(() => {
      State.lastMessages.set(convUuid, msg);
      const loadedConv = getConvByUuid(convUuid);
      if (loadedConv) loadedConv.lastMessageAt = msg.sentAt;
      renderConversationsList();
    }).catch(e => console.error('load conversation from ws', e));
  }


  if (convUuid !== State.activeConvUuid && msg.sender.uuid !== State.currentUser.uuid) {
    State.unreadCounts.set(convUuid, (State.unreadCounts.get(convUuid) || 0) + 1);
  }

  renderConversationsList();

  if (convUuid === State.activeConvUuid && isNewMessage) {
    appendMessageToChat(msg, msgs.length - 1, msgs);
    if (msg.sender.uuid !== State.currentUser.uuid) markMessagesAsRead(convUuid);
  }
}

function appendMessageToChat(msg, idx, msgs) {
  const list = document.getElementById('messagesList');
  if (!list) return;


  const placeholder = list.querySelector('.no-messages');
  if (placeholder) placeholder.remove();

  const prev   = idx > 0 ? msgs[idx - 1] : null;
  const isMine = msg.sender.uuid === State.currentUser.uuid;

  const groupWithPrev = prev
    && prev.sender.uuid === msg.sender.uuid
    && (new Date(msg.sentAt) - new Date(prev.sentAt)) < 300_000;


  if (groupWithPrev && prev) {
    const prevEl = list.querySelector(`[data-uuid="${prev.uuid}"]`);
    if (prevEl) {
      prevEl.classList.add('grouped-bottom');
      const tail = prevEl.querySelector('.bubble-tail');
      if (tail) tail.remove();
      const bubble = prevEl.querySelector('.bubble');
      if (bubble) {
        const r = isMine
          ? 'var(--r-lg) var(--r-lg) var(--r-lg) var(--r-lg)'
          : 'var(--r-lg) var(--r-lg) var(--r-lg) var(--r-lg)';
        bubble.style.borderRadius = r;
      }
    }
  }

  const el = buildMessageEl(msg, isMine, groupWithPrev, false);
  list.appendChild(el);
  scrollToBottom(true);
}

function onMessageUpdated(convUuid, updatedMsg) {
  const msgs = State.messages.get(convUuid);
  if (!msgs) return;
  const idx = msgs.findIndex(m => m.uuid === updatedMsg.uuid);
  if (idx !== -1) msgs[idx] = updatedMsg;

  State.messages.forEach(convMsgs => {
    convMsgs.forEach(msg => {
      if (msg.replyTo?.uuid === updatedMsg.uuid) {
        msg.replyTo = { ...msg.replyTo, ...updatedMsg };
      }
    });
  });

  if (convUuid === State.activeConvUuid) {
    renderMessages(convUuid);
  }


  const last = State.lastMessages.get(convUuid);
  if (last && last.uuid === updatedMsg.uuid) {
    State.lastMessages.set(convUuid, updatedMsg);
    renderConversationsList();
  }
}

function onMessageDeleted(convUuid, deletedUuid) {
  const msgs = State.messages.get(convUuid);
  if (msgs) {
    const filtered = msgs.filter(m => m.uuid !== deletedUuid);
    filtered.forEach(msg => {
      if (msg.replyTo?.uuid === deletedUuid) msg.replyTo = null;
    });
    State.messages.set(convUuid, filtered);

    const last = State.lastMessages.get(convUuid);
    if (last && last.uuid === deletedUuid) {
      State.lastMessages.set(
        convUuid,
        filtered.length > 0 ? filtered[filtered.length - 1] : null
      );
    }
  }

  if (convUuid === State.activeConvUuid) {
    if (State.replyingTo?.uuid === deletedUuid) cancelReply();
    renderMessages(convUuid);
  }

  renderConversationsList();
}

function onMessageRead(convUuid, readUuid) {
  const msgs = State.messages.get(convUuid);
  if (msgs) {
    const msg = msgs.find(m => m.uuid === readUuid);
    if (msg) msg.isRead = true;
  }

  if (convUuid === State.activeConvUuid) {
    const el = document.querySelector(`.msg-wrap[data-uuid="${readUuid}"]`);
    if (el) {
      const tick = el.querySelector('.msg-tick');
      if (tick) {
        tick.className = 'msg-tick read';
        tick.innerHTML = '<i class="fa-solid fa-check-double"></i>';
      }
    }
  }
}

function onConversationDeleted(convUuid) {
  const existed = getConvByUuid(convUuid);
  const localDelete = State.localConversationDeletes.has(convUuid);
  State.localConversationDeletes.delete(convUuid);

  const wasActive = removeConversationLocally(convUuid);

  if (existed && wasActive && !localDelete) {
    showToast('Chat eliminata', 'success');
  }
}


function onSearchInput(query) {
  clearTimeout(State.searchDebounce);

  if (!query || query.trim().length < 2) {
    closeSearchPanel();
    return;
  }

  State.searchDebounce = setTimeout(() => searchUsers(query.trim()), 300);
}

async function searchUsers(query) {
  try {
    const data = await api.get(`/api/v1/users/search?query=${encodeURIComponent(query)}&size=20`);
    renderSearchResults(data.content || []);
  } catch (e) {
    console.error('searchUsers', e);
  }
}

function renderSearchResults(users) {
  const panel   = document.getElementById('searchPanel');
  const results = document.getElementById('searchResults');

  document.getElementById('conversationsList').hidden = true;
  panel.hidden = false;
  results.innerHTML = '';

  const filtered = users.filter(u => u.uuid !== State.currentUser.uuid);

  if (filtered.length === 0) {
    results.innerHTML = '<div class="search-empty">Nessun utente trovato</div>';
    return;
  }

  filtered.forEach(user => {
    const item = document.createElement('div');
    item.className = 'search-item';

    item.appendChild(createAvatar(user, 'avatar-lg'));

    const info = document.createElement('div');
    info.className = 'search-item-info';
    info.innerHTML = `
      <div class="search-item-name">${escHtml(user.displayName || user.username || '')}</div>
      <div class="search-item-username">@${escHtml(user.username || '')}</div>`;

    item.appendChild(info);
    item.addEventListener('click', () => startConversation(user.uuid));
    results.appendChild(item);
  });
}

function closeSearchPanel() {
  document.getElementById('searchPanel').hidden = true;
  document.getElementById('conversationsList').hidden = false;
}

async function startConversation(userUuid) {
  try {
    showOverlay();
    const conv = await api.post('/api/v1/conversations', userUuid);

    if (!getConvByUuid(conv.uuid)) {
      State.conversations.push(conv);
    }
    if (conv.lastMessage) State.lastMessages.set(conv.uuid, conv.lastMessage);

    document.getElementById('searchInput').value = '';
    closeSearchPanel();
    await openConversation(conv.uuid);
  } catch (e) {
    showToast(e.message || 'Impossibile aprire la conversazione', 'error');
  } finally {
    hideOverlay();
  }
}


function showContextMenu(x, y, msgUuid, content, isMine, fullMsg) {
  hideConversationContextMenu();
  State.contextTarget = { msgUuid, content, isMine, msg: fullMsg };

  const menu    = document.getElementById('contextMenu');
  const ctxEdit = document.getElementById('ctxEdit');
  const ctxDel  = document.getElementById('ctxDelete');

  ctxEdit.style.display = (isMine && fullMsg.messageType === 'TEXT') ? 'flex' : 'none';
  ctxDel.style.display  = isMine ? 'flex' : 'none';

  menu.hidden = false;
  menu.style.animation = 'none';
  menu.offsetHeight;
  menu.style.animation = '';

  const mw = 168, mh = menu.offsetHeight || 120;
  menu.style.left = Math.min(x, window.innerWidth  - mw - 8) + 'px';
  menu.style.top  = (y + mh > window.innerHeight ? y - mh : y) + 'px';
}

function hideContextMenu() {
  document.getElementById('contextMenu').hidden = true;
  State.contextTarget = null;
}

function showConversationContextMenu(x, y, convUuid) {
  hideContextMenu();
  State.conversationContextTarget = { convUuid };

  const menu = document.getElementById('conversationContextMenu');
  menu.hidden = false;
  menu.style.animation = 'none';
  menu.offsetHeight;
  menu.style.animation = '';

  const mw = 178, mh = menu.offsetHeight || 56;
  menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  menu.style.top = (y + mh > window.innerHeight ? y - mh : y) + 'px';
}

function hideConversationContextMenu() {
  const menu = document.getElementById('conversationContextMenu');
  if (menu) menu.hidden = true;
  State.conversationContextTarget = null;
}

function showConfirmDialog({ title, message, confirmText = 'Conferma', danger = false }) {
  const dialog = document.getElementById('confirmDialog');
  const okBtn = document.getElementById('confirmOkBtn');

  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  okBtn.textContent = confirmText;
  okBtn.classList.toggle('danger', danger);

  dialog.hidden = false;

  return new Promise(resolve => {
    State.confirmResolve = resolve;
  });
}

function closeConfirmDialog(result = false) {
  document.getElementById('confirmDialog').hidden = true;

  if (State.confirmResolve) {
    const resolve = State.confirmResolve;
    State.confirmResolve = null;
    resolve(result);
  }
}


function openImageViewer(url) {
  const viewer = document.getElementById('imageViewer');
  document.getElementById('imageViewerImg').src = url;
  viewer.hidden = false;
}


function openPhotoCrop(file, options = {}) {
  if (!file.type.startsWith('image/')) {
    showToast('Seleziona un file immagine', 'error');
    return;
  }

  const modal = document.getElementById('photoCropModal');
  const canvas = document.getElementById('photoCropCanvas');
  const zoomInput = document.getElementById('photoCropZoom');
  const applyBtn = document.getElementById('applyPhotoCropBtn');
  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    State.photoCrop = {
      file,
      url,
      img,
      canvas,
      ctx: canvas.getContext('2d'),
      width: 0,
      height: 0,
      rect: { x: 0, y: 0, size: 0 },
      imageX: 0,
      imageY: 0,
      zoom: 1,
      baseScale: 1,
      scale: 1,
      rotation: 0,
      drag: null,
      mode: options.mode || 'profile',
      onApply: typeof options.onApply === 'function' ? options.onApply : null,
    };

    modal.hidden = false;
    canvas.setAttribute(
      'aria-label',
      State.photoCrop.mode === 'attachment' ? 'Ritaglia immagine' : 'Ritaglia foto profilo'
    );
    applyBtn.textContent = options.applyLabel || (
      State.photoCrop.mode === 'attachment' ? 'Aggiungi' : 'Imposta foto'
    );
    zoomInput.value = '1';
    resetPhotoCrop();
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    showToast('Impossibile aprire questa immagine', 'error');
  };

  img.src = url;
}

function closePhotoCrop() {
  const crop = State.photoCrop;
  if (crop?.url) URL.revokeObjectURL(crop.url);
  State.photoCrop = null;
  document.getElementById('photoCropModal').hidden = true;
  document.getElementById('photoCropCanvas').classList.remove('dragging');
  document.getElementById('photoCropCanvas').setAttribute('aria-label', 'Ritaglia foto profilo');
  document.getElementById('applyPhotoCropBtn').textContent = 'Imposta foto';
}

function resizePhotoCropCanvas() {
  const crop = State.photoCrop;
  if (!crop) return;

  const maxW = Math.max(280, Math.min(window.innerWidth - 72, 840));
  const maxH = Math.max(280, Math.min(window.innerHeight - 180, 720));
  const rotated = crop.rotation % 180 !== 0;
  const aspect = rotated
    ? crop.img.naturalHeight / crop.img.naturalWidth
    : crop.img.naturalWidth / crop.img.naturalHeight;
  let width = maxW;
  let height = width / aspect;

  if (height > maxH) {
    height = maxH;
    width = height * aspect;
  }

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const previousW = crop.width;
  const previousH = crop.height;
  const previousRect = { ...crop.rect };
  const previousImageX = crop.imageX;
  const previousImageY = crop.imageY;

  crop.width = width;
  crop.height = height;
  crop.canvas.style.width = `${width}px`;
  crop.canvas.style.height = `${height}px`;
  crop.canvas.width = Math.round(width * dpr);
  crop.canvas.height = Math.round(height * dpr);
  crop.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (previousW > 0 && previousH > 0) {
    const ratioX = width / previousW;
    const ratioY = height / previousH;
    const ratio = Math.min(ratioX, ratioY);
    crop.rect = {
      x: previousRect.x * ratioX,
      y: previousRect.y * ratioY,
      size: previousRect.size * ratio,
    };
    crop.imageX = width / 2 + (previousImageX - previousW / 2) * ratio;
    crop.imageY = height / 2 + (previousImageY - previousH / 2) * ratio;
  } else {
    const rectSize = Math.min(width, height) * .82;
    crop.rect = {
      x: (width - rectSize) / 2,
      y: (height - rectSize) / 2,
      size: rectSize,
    };
    crop.imageX = width / 2;
    crop.imageY = height / 2;
  }

  updatePhotoCropScale();
  clampPhotoCropRect();
  clampPhotoCrop();
  drawPhotoCrop();
}

function updatePhotoCropScale() {
  const crop = State.photoCrop;
  if (!crop) return;

  const rad = crop.rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const boxW = crop.img.naturalWidth * cos + crop.img.naturalHeight * sin;
  const boxH = crop.img.naturalWidth * sin + crop.img.naturalHeight * cos;

  crop.baseScale = Math.min(crop.width / boxW, crop.height / boxH);
  crop.scale = crop.baseScale * crop.zoom;
}

function resetPhotoCrop() {
  const crop = State.photoCrop;
  if (!crop) return;

  crop.zoom = 1;
  crop.rotation = 0;
  resizePhotoCropCanvas();
  const rectSize = Math.min(crop.width, crop.height) * .82;
  crop.rect = {
    x: (crop.width - rectSize) / 2,
    y: (crop.height - rectSize) / 2,
    size: rectSize,
  };
  crop.imageX = crop.width / 2;
  crop.imageY = crop.height / 2;
  document.getElementById('photoCropZoom').value = '1';
  updatePhotoCropScale();
  clampPhotoCropRect();
  clampPhotoCrop();
  drawPhotoCrop();
}

function clampPhotoCropRect() {
  const crop = State.photoCrop;
  if (!crop) return;

  const maxSize = Math.min(crop.width, crop.height);
  const minSize = Math.min(140, maxSize * .36);
  crop.rect.size = Math.max(minSize, Math.min(maxSize, crop.rect.size));
  crop.rect.x = Math.max(0, Math.min(crop.width - crop.rect.size, crop.rect.x));
  crop.rect.y = Math.max(0, Math.min(crop.height - crop.rect.size, crop.rect.y));
}

function clampPhotoCrop() {
  const crop = State.photoCrop;
  if (!crop) return;

  const rad = crop.rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const displayW = (crop.img.naturalWidth * cos + crop.img.naturalHeight * sin) * crop.scale;
  const displayH = (crop.img.naturalWidth * sin + crop.img.naturalHeight * cos) * crop.scale;
  const minX = crop.width - displayW / 2;
  const maxX = displayW / 2;
  const minY = crop.height - displayH / 2;
  const maxY = displayH / 2;

  crop.imageX = displayW <= crop.width
    ? crop.width / 2
    : Math.max(minX, Math.min(maxX, crop.imageX));
  crop.imageY = displayH <= crop.height
    ? crop.height / 2
    : Math.max(minY, Math.min(maxY, crop.imageY));
}

function drawPhotoCrop() {
  const crop = State.photoCrop;
  if (!crop) return;

  const { ctx, width, height, img } = crop;
  const { x, y } = crop.rect;
  const cropSize = crop.rect.size;
  const centerX = x + cropSize / 2;
  const centerY = y + cropSize / 2;
  const radius = cropSize / 2;
  const corner = Math.max(22, cropSize * .07);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0e1621';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(crop.imageX, crop.imageY);
  ctx.rotate(crop.rotation * Math.PI / 180);
  ctx.scale(crop.scale, crop.scale);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(5, 10, 16, .46)';
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(232, 234, 237, .74)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.lineCap = 'square';
  drawPhotoCropCorner(ctx, x, y, corner, 'tl');
  drawPhotoCropCorner(ctx, x + cropSize, y, corner, 'tr');
  drawPhotoCropCorner(ctx, x, y + cropSize, corner, 'bl');
  drawPhotoCropCorner(ctx, x + cropSize, y + cropSize, corner, 'br');
  ctx.restore();
}

function drawPhotoCropCorner(ctx, x, y, length, corner) {
  ctx.beginPath();
  if (corner === 'tl') {
    ctx.moveTo(x, y + length);
    ctx.lineTo(x, y);
    ctx.lineTo(x + length, y);
  } else if (corner === 'tr') {
    ctx.moveTo(x - length, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + length);
  } else if (corner === 'bl') {
    ctx.moveTo(x, y - length);
    ctx.lineTo(x, y);
    ctx.lineTo(x + length, y);
  } else {
    ctx.moveTo(x - length, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y - length);
  }
  ctx.stroke();
}

function startPhotoCropDrag(e) {
  const crop = State.photoCrop;
  if (!crop) return;
  const point = getPhotoCropPoint(e);
  const handle = getPhotoCropHandle(point.x, point.y);
  const mode = handle || (isPointInPhotoCropRect(point.x, point.y) ? 'rect' : 'image');

  crop.drag = {
    mode,
    pointerId: e.pointerId,
    startX: point.x,
    startY: point.y,
    originImageX: crop.imageX,
    originImageY: crop.imageY,
    originRect: { ...crop.rect },
  };
  crop.canvas.setPointerCapture(e.pointerId);
  crop.canvas.classList.add('dragging');
}

function movePhotoCropDrag(e) {
  const crop = State.photoCrop;
  if (!crop?.drag || crop.drag.pointerId !== e.pointerId) return;
  const point = getPhotoCropPoint(e);

  if (crop.drag.mode === 'image') {
    crop.imageX = crop.drag.originImageX + point.x - crop.drag.startX;
    crop.imageY = crop.drag.originImageY + point.y - crop.drag.startY;
  } else if (crop.drag.mode === 'rect') {
    crop.rect.x = crop.drag.originRect.x + point.x - crop.drag.startX;
    crop.rect.y = crop.drag.originRect.y + point.y - crop.drag.startY;
  } else {
    resizePhotoCropRect(crop.drag.mode, point.x, point.y);
    updatePhotoCropScale();
  }

  clampPhotoCropRect();
  clampPhotoCrop();
  drawPhotoCrop();
}

function endPhotoCropDrag(e) {
  const crop = State.photoCrop;
  if (!crop?.drag || crop.drag.pointerId !== e.pointerId) return;

  crop.drag = null;
  crop.canvas.classList.remove('dragging');
}

function getPhotoCropPoint(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const crop = State.photoCrop;
  const scaleX = crop.width / rect.width;
  const scaleY = crop.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function getPhotoCropHandle(x, y) {
  const crop = State.photoCrop;
  if (!crop) return null;

  const { rect } = crop;
  const hit = Math.max(28, rect.size * .07);
  const points = {
    tl: [rect.x, rect.y],
    tr: [rect.x + rect.size, rect.y],
    bl: [rect.x, rect.y + rect.size],
    br: [rect.x + rect.size, rect.y + rect.size],
  };

  for (const [name, [px, py]] of Object.entries(points)) {
    if (Math.abs(x - px) <= hit && Math.abs(y - py) <= hit) return name;
  }

  return null;
}

function isPointInPhotoCropRect(x, y) {
  const crop = State.photoCrop;
  if (!crop) return false;

  const { rect } = crop;
  return x >= rect.x
    && x <= rect.x + rect.size
    && y >= rect.y
    && y <= rect.y + rect.size;
}

function resizePhotoCropRect(handle, pointerX, pointerY) {
  const crop = State.photoCrop;
  if (!crop?.drag) return;

  const origin = crop.drag.originRect;
  const maxBase = Math.min(crop.width, crop.height);
  const minSize = Math.min(140, maxBase * .36);
  let nextSize = origin.size;
  let x = origin.x;
  let y = origin.y;

  if (handle === 'tl') {
    const fixedX = origin.x + origin.size;
    const fixedY = origin.y + origin.size;
    nextSize = Math.max(fixedX - pointerX, fixedY - pointerY);
    nextSize = Math.min(Math.max(nextSize, minSize), fixedX, fixedY);
    x = fixedX - nextSize;
    y = fixedY - nextSize;
  } else if (handle === 'tr') {
    const fixedX = origin.x;
    const fixedY = origin.y + origin.size;
    nextSize = Math.max(pointerX - fixedX, fixedY - pointerY);
    nextSize = Math.min(Math.max(nextSize, minSize), crop.width - fixedX, fixedY);
    x = fixedX;
    y = fixedY - nextSize;
  } else if (handle === 'bl') {
    const fixedX = origin.x + origin.size;
    const fixedY = origin.y;
    nextSize = Math.max(fixedX - pointerX, pointerY - fixedY);
    nextSize = Math.min(Math.max(nextSize, minSize), fixedX, crop.height - fixedY);
    x = fixedX - nextSize;
    y = fixedY;
  } else if (handle === 'br') {
    const fixedX = origin.x;
    const fixedY = origin.y;
    nextSize = Math.max(pointerX - fixedX, pointerY - fixedY);
    nextSize = Math.min(Math.max(nextSize, minSize), crop.width - fixedX, crop.height - fixedY);
    x = fixedX;
    y = fixedY;
  }

  crop.rect = { x, y, size: nextSize };
}

function rotatePhotoCrop() {
  const crop = State.photoCrop;
  if (!crop) return;

  crop.rotation = (crop.rotation + 90) % 360;
  resizePhotoCropCanvas();
  updatePhotoCropScale();
  clampPhotoCrop();
  drawPhotoCrop();
}

function setPhotoCropZoom(value) {
  const crop = State.photoCrop;
  if (!crop) return;

  crop.zoom = Number(value) || 1;
  updatePhotoCropScale();
  clampPhotoCrop();
  drawPhotoCrop();
}

async function applyPhotoCrop() {
  const crop = State.photoCrop;
  if (!crop) return;

  const applyBtn = document.getElementById('applyPhotoCropBtn');
  applyBtn.disabled = true;

  try {
    const blob = crop.mode === 'attachment'
      ? await createAttachmentImageBlob(crop)
      : await createProfilePhotoBlob(crop);
    if (!blob) throw new Error('Ritaglio fallito');

    if (crop.mode === 'attachment') {
      const croppedFile = new File(
        [blob],
        getCroppedImageName(crop.file),
        { type: blob.type || 'image/jpeg', lastModified: Date.now() }
      );
      const onApply = crop.onApply;
      closePhotoCrop();
      if (onApply) onApply(croppedFile);
      else openAttachmentComposer([croppedFile]);
      return;
    }

    const fd = new FormData();
    fd.append('newProfilePic', blob, 'profile-photo.jpg');

    showOverlay();
    State.currentUser = await api.upload('/api/v1/users/me/changeProfilePic', fd, 'PUT');
    syncUserEverywhere(State.currentUser);
    populateMenuDrawer();
    openProfilePanel();
    closePhotoCrop();
    showToast('Foto aggiornata', 'success');
  } catch (err) {
    showToast(err.message || 'Aggiornamento fallito', 'error');
  } finally {
    hideOverlay();
    applyBtn.disabled = false;
  }
}

function createProfilePhotoBlob(crop) {
  return createPhotoCropBlob(crop, 512);
}

function createAttachmentImageBlob(crop) {
  const naturalCropSize = Math.round(crop.rect.size / Math.max(crop.scale, 0.01));
  const outSize = Math.max(512, Math.min(1600, naturalCropSize));
  return createPhotoCropBlob(crop, outSize);
}

function createPhotoCropBlob(crop, outSize) {
  return new Promise(resolve => {
    const out = document.createElement('canvas');
    const ctx = out.getContext('2d');
    const ratio = outSize / crop.rect.size;

    out.width = outSize;
    out.height = outSize;
    ctx.fillStyle = '#17212b';
    ctx.fillRect(0, 0, outSize, outSize);
    ctx.translate((crop.imageX - crop.rect.x) * ratio, (crop.imageY - crop.rect.y) * ratio);
    ctx.rotate(crop.rotation * Math.PI / 180);
    ctx.scale(crop.scale * ratio, crop.scale * ratio);
    ctx.drawImage(crop.img, -crop.img.naturalWidth / 2, -crop.img.naturalHeight / 2);
    out.toBlob(resolve, 'image/jpeg', .92);
  });
}

function getCroppedImageName(file) {
  const originalName = file?.name || 'image';
  const dotIndex = originalName.lastIndexOf('.');
  const baseName = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName;
  return `${baseName}-ritagliata.jpg`;
}


async function loadCurrentUser() {
  try {
    State.currentUser = await api.get('/api/v1/users/me');
    populateMenuDrawer();
    return State.currentUser;
  } catch (e) {
    localStorage.clear();
    window.location.href = './login/login.html';
    throw e;
  }
}

function populateMenuDrawer() {
  const u = State.currentUser;
  if (!u) return;

  const avatarEl = document.getElementById('menuAvatar');
  if (avatarEl) {
    avatarEl.innerHTML = '';
    avatarEl.appendChild(createAvatar(u, 'avatar-xl'));
  }
  const name = document.getElementById('menuUserName');
  const handle = document.getElementById('menuUserHandle');
  if (name)   name.textContent   = u.displayName || u.username || 'Utente';
  if (handle) handle.textContent = u.username ? `@${u.username.toLowerCase()}` : u.email;
}

function openProfilePanel(user = State.currentUser) {
  const panel  = document.getElementById('profilePanel');
  const u      = user || State.currentUser;
  const isMine = u.uuid === State.currentUser.uuid;

  State.profilePanelUser = u;
  panel.classList.toggle('own-profile', isMine);

  document.getElementById('profilePanelAvatar').innerHTML   = '';
  document.getElementById('profilePanelAvatar').appendChild(createAvatar(u, 'avatar-xxl'));
  document.getElementById('profilePanelName').textContent     = u.displayName || u.username || 'Utente';
  document.getElementById('profilePanelUsername').textContent = u.username ? `@${u.username.toLowerCase()}` : '';
  document.getElementById('profileFieldEmail').hidden         = !isMine || !u.email;
  document.getElementById('profilePanelEmail').textContent    = isMine ? (u.email || '') : '';
  document.getElementById('profilePanelStatus').textContent   = u.isOnline ? 'Online' : formatLastSeen(u);
  document.getElementById('profilePicActions').hidden         = !isMine;

  const editFields = document.getElementById('profileEditFields');
  editFields.hidden = !isMine;
  if (isMine) {
    document.getElementById('profileDisplayNameInput').value = u.displayName || '';
    document.getElementById('profileUsernameInput').value = (u.username || '').toLowerCase();
  }

  panel.hidden = false;
}

function openActiveChatProfile() {
  if (!State.activeConvUuid) return;

  const conv = getConvByUuid(State.activeConvUuid);
  if (!conv) return;

  if (isSavedConv(conv)) {
    openProfilePanel(State.currentUser);
  } else {
    openProfilePanel(getOtherUser(conv));
  }
}

async function saveProfile() {
  const username    = document.getElementById('setupUsername').value.trim().toLowerCase();
  const displayName = document.getElementById('setupDisplayName').value.trim();

  if (username.length < 3) { showToast('Username minimo 3 caratteri', 'error'); return; }
  if (!/^[a-z0-9_]+$/.test(username)) { showToast('Username: solo lettere, numeri e _', 'error'); return; }
  if (!displayName) { showToast('Il nome è obbligatorio', 'error'); return; }

  try {
    showOverlay();
    await api.put('/api/v1/users/me/changeUsername',    { username });
    await api.put('/api/v1/users/me/changeDisplayName', { displayName });

    localStorage.removeItem('setupRequired');
    State.currentUser = await api.get('/api/v1/users/me');
    populateMenuDrawer();

    document.getElementById('profileSetupModal').hidden = true;
    showToast('Profilo salvato!', 'success');
  } catch (e) {
    showToast(e.message || 'Salvataggio fallito', 'error');
  } finally {
    hideOverlay();
  }
}

async function saveProfileDetails() {
  const username = document.getElementById('profileUsernameInput').value.trim().toLowerCase();
  const displayName = document.getElementById('profileDisplayNameInput').value.trim();

  if (username.length < 3) { showToast('Username minimo 3 caratteri', 'error'); return; }
  if (!/^[a-z0-9_]+$/.test(username)) { showToast('Username: solo lettere, numeri e _', 'error'); return; }
  if (!displayName) { showToast('Il nome è obbligatorio', 'error'); return; }

  const currentUsername = State.currentUser.username || '';
  const currentDisplayName = State.currentUser.displayName || '';

  if (username === currentUsername && displayName === currentDisplayName) {
    showToast('Nessuna modifica da salvare', 'info');
    return;
  }

  try {
    showOverlay();

    if (username !== currentUsername) {
      await api.put('/api/v1/users/me/changeUsername', { username });
    }
    if (displayName !== currentDisplayName) {
      await api.put('/api/v1/users/me/changeDisplayName', { displayName });
    }

    State.currentUser = await api.get('/api/v1/users/me');
    syncCurrentUserInConversations();
    populateMenuDrawer();
    openProfilePanel(State.currentUser);
    renderConversationsList();
    showToast('Profilo aggiornato', 'success');
  } catch (e) {
    showToast(e.message || 'Salvataggio fallito', 'error');
  } finally {
    hideOverlay();
  }
}


function toggleMenuDrawer() {
  document.getElementById('menuDrawer').classList.toggle('open');
}
function closeMenuDrawer() {
  document.getElementById('menuDrawer').classList.remove('open');
}


function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


function bindEvents() {

  document.getElementById('menuBtn').addEventListener('click', e => {
    e.stopPropagation();
    toggleMenuDrawer();
  });
  document.addEventListener('click', e => {
    const drawer  = document.getElementById('menuDrawer');
    const menuBtn = document.getElementById('menuBtn');
    if (drawer.classList.contains('open')
      && !drawer.contains(e.target)
      && !menuBtn.contains(e.target)) {
      closeMenuDrawer();
    }
  });


  document.getElementById('logoutMenuItem').addEventListener('click', () => {
    if (State.stompClient) State.stompClient.deactivate();
    localStorage.clear();
    window.location.href = './login/login.html';
  });


  document.getElementById('profileMenuItem').addEventListener('click', () => {
    closeMenuDrawer();
    openProfilePanel();
  });


  document.getElementById('closePanelBtn').addEventListener('click', () => {
    document.getElementById('profilePanel').hidden = true;
  });


  document.getElementById('chatInfoBtn').addEventListener('click', openActiveChatProfile);
  document.querySelector('.chat-header-left').addEventListener('click', openActiveChatProfile);


  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input',   e => onSearchInput(e.target.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { searchInput.value = ''; closeSearchPanel(); }
  });


  const msgInput = document.getElementById('messageInput');
  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
    updateMessageCharCounter();
  });
  updateMessageCharCounter();


  document.getElementById('sendBtn').addEventListener('click', sendMessage);


  document.getElementById('attachBtn').addEventListener('click', () =>
    document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) openSelectedAttachments(files);
  });


  document.getElementById('addAttachmentBtn').addEventListener('click', () =>
    document.getElementById('fileInput').click());
  document.getElementById('cancelAttachmentBtn').addEventListener('click', closeAttachmentComposer);
  document.getElementById('closeAttachmentBtn').addEventListener('click', closeAttachmentComposer);
  document.getElementById('sendAttachmentBtn').addEventListener('click', sendAttachmentDraft);
  document.getElementById('attachmentCaption').addEventListener('input', e => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 116) + 'px';
  });
  document.getElementById('sendAsDocument').addEventListener('change', () => {
    if (State.attachmentDraft) State.attachmentDraft.sendAsDocumentTouched = true;
  });


  document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);
  document.getElementById('cancelReplyBtn').addEventListener('click', cancelReply);


  document.getElementById('ctxReply').addEventListener('click', () => {
    if (State.contextTarget?.msg)
      startReply(State.contextTarget.msg);
    hideContextMenu();
  });
  document.getElementById('ctxCopy').addEventListener('click', () => {
    if (State.contextTarget?.content)
      navigator.clipboard.writeText(State.contextTarget.content)
        .then(() => showToast('Copiato!', 'success'));
    hideContextMenu();
  });
  document.getElementById('ctxEdit').addEventListener('click', () => {
    if (State.contextTarget)
      startEdit(State.contextTarget.msgUuid, State.contextTarget.content);
    hideContextMenu();
  });
  document.getElementById('ctxDelete').addEventListener('click', () => {
    if (State.contextTarget) deleteMessage(State.contextTarget.msgUuid);
    hideContextMenu();
  });
  document.getElementById('convCtxDelete').addEventListener('click', () => {
    const convUuid = State.conversationContextTarget?.convUuid;
    hideConversationContextMenu();
    if (convUuid) deleteConversation(convUuid);
  });


  document.addEventListener('click', e => {
    if (!document.getElementById('contextMenu').contains(e.target)) hideContextMenu();
    if (!document.getElementById('conversationContextMenu').contains(e.target)) hideConversationContextMenu();
  });


  document.getElementById('confirmCancelBtn').addEventListener('click', () => closeConfirmDialog(false));
  document.getElementById('confirmOkBtn').addEventListener('click', () => closeConfirmDialog(true));
  document.getElementById('confirmDialog').addEventListener('click', e => {
    if (e.target.id === 'confirmDialog') closeConfirmDialog(false);
  });


  document.getElementById('imageViewer').addEventListener('click', () => {
    document.getElementById('imageViewer').hidden = true;
  });


  document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
  document.getElementById('setupUsername').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('setupDisplayName').focus();
  });
  document.getElementById('setupDisplayName').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveProfile();
  });
  document.getElementById('saveProfileDetailsBtn').addEventListener('click', saveProfileDetails);
  document.getElementById('profileUsernameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveProfileDetails();
  });
  document.getElementById('profileDisplayNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveProfileDetails();
  });


  document.getElementById('changeProfilePicBtn').addEventListener('click', () =>
    document.getElementById('profilePicInput').click());
  document.getElementById('profilePanelAvatar').addEventListener('click', () => {
    if (State.profilePanelUser?.uuid === State.currentUser.uuid) {
      document.getElementById('profilePicInput').click();
    }
  });
  document.getElementById('profilePicInput').addEventListener('change', e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) openPhotoCrop(file);
  });


  const cropCanvas = document.getElementById('photoCropCanvas');
  cropCanvas.addEventListener('pointerdown', startPhotoCropDrag);
  cropCanvas.addEventListener('pointermove', movePhotoCropDrag);
  cropCanvas.addEventListener('pointerup', endPhotoCropDrag);
  cropCanvas.addEventListener('pointercancel', endPhotoCropDrag);
  document.getElementById('photoCropZoom').addEventListener('input', e => setPhotoCropZoom(e.target.value));
  document.getElementById('rotatePhotoCropBtn').addEventListener('click', rotatePhotoCrop);
  document.getElementById('resetPhotoCropBtn').addEventListener('click', resetPhotoCrop);
  document.getElementById('cancelPhotoCropBtn').addEventListener('click', closePhotoCrop);
  document.getElementById('applyPhotoCropBtn').addEventListener('click', applyPhotoCrop);
  window.addEventListener('resize', resizePhotoCropCanvas);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && State.confirmResolve) closeConfirmDialog(false);
    if (e.key === 'Escape' && State.replyingTo) cancelReply();
    if (e.key === 'Escape' && State.photoCrop) closePhotoCrop();
    if (e.key === 'Escape' && State.attachmentDraft) closeAttachmentComposer();
  });
}


async function ensureSavedMessages() {
  try {
    const conv = await api.get('/api/v1/conversations/saved');
    rememberSavedConversation(conv);
    renderConversationsList();
  } catch (e) {
    console.warn('ensureSavedMessages failed', e);
  }
}


async function init() {
  if (!token()) {
    window.location.href = './login/login.html';
    return;
  }

  await loadCurrentUser();


  const needsSetup = !State.currentUser.username
    || localStorage.getItem('setupRequired') === 'true';
  if (needsSetup) {
    document.getElementById('setupDisplayName').value =
      State.currentUser.displayName || '';
    document.getElementById('profileSetupModal').hidden = false;
  }

  await loadConversations();
  await ensureSavedMessages();
  connectWebSocket();
  bindEvents();
}

document.addEventListener('DOMContentLoaded', init);
