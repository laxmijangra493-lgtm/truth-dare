const socket = io({ transports: ['websocket', 'polling'] });

const $ = (id) => document.getElementById(id);
const lobbyView = $('lobbyView');
const gameView = $('gameView');
const nameInput = $('nameInput');
const roomInput = $('roomInput');
const joinBtn = $('joinBtn');
const lobbyError = $('lobbyError');
const roomCodeLabel = $('roomCodeLabel');
const playersRow = $('playersRow');
const onlineCount = $('onlineCount');
const spinBtn = $('spinBtn');
const bottleWrap = $('bottleWrap');
const playStage = document.querySelector('.play-stage');
const turnLabel = $('turnLabel');
const turnHeading = $('turnHeading');
const turnSubheading = $('turnSubheading');
const statusTitle = $('statusTitle');
const statusText = $('statusText');
const chatList = $('chatList');
const chatForm = $('chatForm');
const chatInput = $('chatInput');
const toast = $('toast');
const modalOverlay = $('modalOverlay');
const modalClose = $('modalClose');
const modalKicker = $('modalKicker');
const modalTitle = $('modalTitle');
const modalText = $('modalText');
const choiceGrid = $('choiceGrid');
const modalResult = $('modalResult');
const resultTag = $('resultTag');
const resultPrompt = $('resultPrompt');
const doneBtn = $('doneBtn');
const eventLog = $('eventLog');

let state = {
  roomId: getRoomFromPath(),
  playerId: localStorage.getItem('td:playerId') || crypto.randomUUID(),
  playerName: localStorage.getItem('td:playerName') || '',
  room: null,
  spinning: false,
};

nameInput.value = state.playerName;
if (state.roomId) roomInput.value = state.roomId;

function getRoomFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[0] === 'room' && parts[1] ? parts[1].toUpperCase() : '';
}

function setError(message) {
  lobbyError.textContent = message || '';
}

function setToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(setToast.timer);
  setToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function initials(name) {
  return name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
}

function safeColor(color) {
  return /^#[0-9A-F]{6}$/i.test(color || '') ? color : '#0d7b83';
}

function joinRoom() {
  setError('');
  const name = nameInput.value.trim();
  const roomId = roomInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (name.length < 2) return setError('Enter a name with at least 2 characters.');
  if (roomId.length < 4) return setError('Enter a 4–8 character room code.');

  state.roomId = roomId;
  state.playerName = name;
  localStorage.setItem('td:playerId', state.playerId);
  localStorage.setItem('td:playerName', state.playerName);
  socket.emit('room:join', { roomId, name, playerId: state.playerId }, (reply) => {
    if (!reply?.ok) return setError(reply?.error || 'Could not join the room.');
    state.room = reply.room;
    renderRoom(reply.room);
    window.history.replaceState({}, '', `/room/${roomId}`);
  });
}

joinBtn.addEventListener('click', joinRoom);
[nameInput, roomInput].forEach(input => input.addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
}));

socket.on('connect', () => {
  if (state.roomId && state.playerName) {
    socket.emit('room:join', { roomId: state.roomId, name: state.playerName, playerId: state.playerId }, (reply) => {
      if (reply?.ok) {
        state.room = reply.room;
        renderRoom(reply.room);
      }
    });
  }
});

socket.on('disconnect', () => {
  if (!gameView.classList.contains('hidden')) setToast('Connection paused — reconnecting…');
});

socket.on('room:state', (room) => {
  state.room = room;
  renderRoom(room);
});

socket.on('chat:new', addChatMessage);

socket.on('game:spin', (data) => {
  spinBtn.disabled = true;
  state.spinning = true;
  playStage.classList.add('spinning');
  bottleWrap.style.transform = `rotate(${data.rotation}deg)`;
  turnLabel.textContent = 'BOTTLE LANDED';
  turnHeading.textContent = `${data.targetName} gets the turn`;
  turnSubheading.textContent = `${data.spinnerName} spun for the room.`;
  statusTitle.textContent = `${data.targetName}, choose Truth or Dare`;
  statusText.textContent = 'Everyone is seeing the same turn on their phone.';

  window.setTimeout(() => {
    playStage.classList.remove('spinning');
    state.spinning = false;
    updateSpinAvailability();
    if (data.targetId === state.playerId) openChoiceModal(data.targetName);
    else showWatcherModal(data.targetName);
  }, 1500);
});

socket.on('game:chosen', (data) => {
  showResultModal(data);
  const isMe = data.targetId === state.playerId;
  turnLabel.textContent = isMe ? 'YOUR CHOICE' : 'THE ROOM CHOSE';
  turnHeading.textContent = `${data.targetName} picked ${data.mode === 'truth' ? 'Truth' : 'Dare'}`;
  turnSubheading.textContent = isMe ? 'Do your prompt, then mark the turn done.' : 'The prompt is shared with everyone in the room.';
  statusTitle.textContent = `${data.targetName}: ${data.mode.toUpperCase()}`;
  statusText.textContent = data.prompt;
});

socket.on('game:done', (data) => {
  closeModal();
  turnLabel.textContent = 'NEXT UP';
  turnHeading.textContent = 'Spin the bottle.';
  turnSubheading.textContent = `${data.by} finished. Keep the circle moving.`;
  statusTitle.textContent = 'Ready for another round';
  statusText.textContent = 'The next spin picks from the fair turn queue.';
  spinBtn.disabled = false;
  state.spinning = false;
});

function renderRoom(room) {
  lobbyView.classList.add('hidden');
  gameView.classList.remove('hidden');
  roomCodeLabel.textContent = room.id;
  const onlinePlayers = room.players.filter(p => p.online);
  onlineCount.textContent = onlinePlayers.length;
  playersRow.innerHTML = onlinePlayers.map(player => `
    <div class="player-pill ${player.id === state.playerId ? 'me' : ''}">
      <div class="player-avatar" style="background:${safeColor(player.color)}">${escapeHtml(initials(player.name))}</div>
      <div>
        <div class="player-name">${escapeHtml(player.name)}${player.id === state.playerId ? ' · you' : ''}</div>
        <div class="player-state">online</div>
      </div>
    </div>
  `).join('') || '<div class="player-state">Waiting for friends…</div>';

  if (room.chat?.length && chatList.dataset.hydrated !== '1') {
    chatList.innerHTML = '';
    room.chat.forEach(addChatMessage);
    chatList.dataset.hydrated = '1';
  }
  updateSpinAvailability();
  syncGameSummary(room);
}

function syncGameSummary(room) {
  const active = room.game.activeTargetId;
  if (!active) return;
  const player = room.players.find(p => p.id === active);
  if (!player) return;
  if (room.game.selectedMode) return;
  turnLabel.textContent = active === state.playerId ? 'YOU ARE UP' : 'WAITING ON';
  turnHeading.textContent = active === state.playerId ? 'Choose Truth or Dare.' : `${player.name} is choosing.`;
  turnSubheading.textContent = active === state.playerId ? 'Tap your choice in the popup.' : 'Their choice will appear here for everyone.';
  statusTitle.textContent = active === state.playerId ? 'Your turn' : `${player.name}'s turn`;
  statusText.textContent = 'Choose when ready.';
}

function updateSpinAvailability() {
  const onlinePlayers = state.room?.players?.filter(p => p.online) || [];
  const active = state.room?.game?.activeTargetId;
  spinBtn.disabled = state.spinning || onlinePlayers.length < 2 || Boolean(active);
  if (onlinePlayers.length < 2) {
    statusTitle.textContent = 'Invite a friend';
    statusText.textContent = 'You need at least two players to spin.';
  }
}

spinBtn.addEventListener('click', () => {
  if (spinBtn.disabled) return;
  socket.emit('game:spin', { roomId: state.roomId }, reply => {
    if (!reply?.ok) setToast(reply?.error || 'Could not spin.');
  });
});

function openChoiceModal(name) {
  modalOverlay.classList.remove('hidden');
  modalKicker.textContent = 'YOUR TURN';
  modalTitle.textContent = `${name}, pick one`;
  modalText.textContent = 'Your choice appears on every friend’s screen at the same time.';
  choiceGrid.classList.remove('hidden');
  modalResult.classList.add('hidden');
}

function showWatcherModal(name) {
  modalOverlay.classList.remove('hidden');
  modalKicker.textContent = 'TURN';
  modalTitle.textContent = `${name} is up`;
  modalText.textContent = 'Waiting for their Truth or Dare choice…';
  choiceGrid.classList.add('hidden');
  modalResult.classList.add('hidden');
}

function showResultModal(data) {
  modalOverlay.classList.remove('hidden');
  modalKicker.textContent = `${data.targetName.toUpperCase()}'S TURN`;
  modalTitle.textContent = `${data.targetName} chose ${data.mode === 'truth' ? 'Truth' : 'Dare'}`;
  modalText.textContent = data.targetId === state.playerId ? 'You are up. Keep it fun, and you can always skip.' : 'Shared with the whole room.';
  choiceGrid.classList.add('hidden');
  modalResult.classList.remove('hidden');
  resultTag.textContent = data.mode.toUpperCase();
  resultTag.style.background = data.mode === 'truth' ? '#0d7b83' : '#ef6c5b';
  resultPrompt.textContent = data.prompt;
  doneBtn.classList.toggle('hidden', data.targetId !== state.playerId);
}

$('choiceGrid').addEventListener('click', e => {
  const button = e.target.closest('.choice-card');
  if (!button) return;
  const mode = button.dataset.mode;
  button.disabled = true;
  socket.emit('game:choose', { roomId: state.roomId, mode }, reply => {
    button.disabled = false;
    if (!reply?.ok) setToast(reply?.error || 'Could not choose.');
  });
});

doneBtn.addEventListener('click', () => {
  socket.emit('game:done', { roomId: state.roomId }, reply => {
    if (!reply?.ok) setToast(reply?.error || 'Could not finish the turn.');
  });
});

function closeModal() {
  modalOverlay.classList.add('hidden');
  choiceGrid.classList.remove('hidden');
  modalResult.classList.add('hidden');
  doneBtn.classList.remove('hidden');
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay && !state.room?.game?.activeTargetId) closeModal(); });

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  socket.emit('chat:send', { roomId: state.roomId, text }, reply => {
    if (!reply?.ok) setToast(reply?.error || 'Message failed.');
  });
});

function addChatMessage(message) {
  const empty = chatList.querySelector('.chat-empty');
  if (empty) empty.remove();
  const mine = message.playerId === state.playerId;
  const el = document.createElement('div');
  el.className = `msg ${mine ? 'mine' : ''}`;
  el.innerHTML = `
    <div class="msg-avatar" style="background:${safeColor(message.color)}">${escapeHtml(initials(message.name))}</div>
    <div class="msg-bubble">
      <div class="msg-meta">${escapeHtml(message.name)} · ${formatTime(message.at)}</div>
      <div class="msg-text">${escapeHtml(message.text)}</div>
    </div>
  `;
  chatList.appendChild(el);
  chatList.scrollTop = chatList.scrollHeight;
}

function formatTime(iso) {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function inviteLink() { return `${window.location.origin}/room/${state.roomId}`; }

async function shareRoom() {
  if (!state.roomId) return setToast('Create or join a room first.');
  const url = inviteLink();
  try {
    if (navigator.share) await navigator.share({ title: 'Truth & Dare', text: `${state.playerName} invited you to play Truth & Dare.`, url });
    else await navigator.clipboard.writeText(url);
    setToast('Invite link ready to share.');
  } catch (error) {
    if (error?.name !== 'AbortError') setToast('Share was cancelled or unavailable.');
  }
}

async function copyRoom() {
  if (!state.roomId) return setToast('Create or join a room first.');
  try {
    await navigator.clipboard.writeText(inviteLink());
    setToast('Room link copied.');
  } catch {
    setToast(inviteLink());
  }
}

$('shareBtn').addEventListener('click', shareRoom);
$('copyBtn').addEventListener('click', copyRoom);
$('inviteBtn').addEventListener('click', shareRoom);

if (chatList.children.length === 0) chatList.innerHTML = '<div class="chat-empty">Say hi — messages in this room are saved.</div>';
