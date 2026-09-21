const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6,
});

const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'rooms.json');

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify({ rooms: {} }, null, 2));

let store = loadStore();
const sockets = new Map(); // socket.id -> { roomId, playerId }

app.use(express.json({ limit: '32kb' }));
app.use(express.static(publicDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'truth-or-dare-fun', time: new Date().toISOString() });
});

app.get('/room/:roomId', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch {
    return { rooms: {} };
  }
}

function persist() {
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, dataFile);
}

function now() {
  return new Date().toISOString();
}

function roomSafe(room) {
  return {
    id: room.id,
    createdAt: room.createdAt,
    players: Object.values(room.players).map(player => ({
      id: player.id,
      name: player.name,
      online: player.online,
      joinedAt: player.joinedAt,
      color: player.color,
    })),
    chat: room.chat.slice(-120),
    events: room.events.slice(-80),
    game: room.game,
  };
}

function makeRoom(id) {
  const room = {
    id,
    createdAt: now(),
    players: {},
    chat: [],
    events: [],
    game: {
      activeTargetId: null,
      selectedMode: null,
      round: 0,
      spinCount: 0,
      queue: [],
      lastResult: null,
    },
  };
  store.rooms[id] = room;
  persist();
  return room;
}

function roomFor(id) {
  return store.rooms[id] || makeRoom(id);
}

function cleanRoomId(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function cleanName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function cleanMessage(raw) {
  return String(raw || '').trim().slice(0, 500);
}

function playerColor(id) {
  const palette = ['#ef6c5b', '#147d92', '#d5a126', '#6b59a8', '#2f8f5b', '#b94a6a', '#7f6a45', '#315f94'];
  let sum = 0;
  for (const char of id) sum = (sum + char.charCodeAt(0)) % palette.length;
  return palette[sum];
}

function rebuildQueue(room) {
  const ids = Object.keys(room.players);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  room.game.queue = ids;
}

function nextTarget(room) {
  const activeIds = Object.values(room.players).filter(p => p.online).map(p => p.id);
  if (activeIds.length < 2) return null;
  room.game.queue = room.game.queue.filter(id => activeIds.includes(id));
  if (!room.game.queue.length) rebuildQueue(room);
  return room.game.queue.shift();
}

function addEvent(room, type, payload) {
  room.events.push({ id: crypto.randomUUID(), type, payload, at: now() });
  if (room.events.length > 160) room.events = room.events.slice(-160);
}

function addChat(room, message) {
  room.chat.push(message);
  if (room.chat.length > 300) room.chat = room.chat.slice(-300);
}

function broadcastRoom(roomId) {
  const room = store.rooms[roomId];
  if (room) io.to(roomId).emit('room:state', roomSafe(room));
}

function ensureMember(socket, roomId) {
  const meta = sockets.get(socket.id);
  if (!meta || meta.roomId !== roomId) return null;
  const room = store.rooms[roomId];
  return room && room.players[meta.playerId] ? { room, player: room.players[meta.playerId] } : null;
}

io.on('connection', socket => {
  socket.on('room:join', (payload = {}, ack = () => {}) => {
    const roomId = cleanRoomId(payload.roomId);
    const name = cleanName(payload.name);
    const playerId = String(payload.playerId || '').trim().slice(0, 64) || crypto.randomUUID();

    if (!/^[A-Z0-9]{4,8}$/.test(roomId)) return ack({ ok: false, error: 'Room code is invalid.' });
    if (name.length < 2) return ack({ ok: false, error: 'Please enter a name.' });

    const room = roomFor(roomId);
    const existing = room.players[playerId];
    if (existing) {
      existing.name = name;
      existing.online = true;
      existing.lastSeen = now();
    } else {
      const onlineCount = Object.values(room.players).filter(p => p.online).length;
      if (onlineCount >= 8) return ack({ ok: false, error: 'This room is full (8 players).' });
      room.players[playerId] = {
        id: playerId,
        name,
        online: true,
        joinedAt: now(),
        lastSeen: now(),
        color: playerColor(playerId),
      };
      if (!room.game.queue.includes(playerId)) room.game.queue.push(playerId);
      addEvent(room, 'join', { playerId, name });
    }

    sockets.set(socket.id, { roomId, playerId });
    socket.join(roomId);
    persist();

    ack({ ok: true, playerId, room: roomSafe(room) });
    broadcastRoom(roomId);
  });

  socket.on('chat:send', (payload = {}, ack = () => {}) => {
    const roomId = cleanRoomId(payload.roomId);
    const membership = ensureMember(socket, roomId);
    const text = cleanMessage(payload.text);
    if (!membership) return ack({ ok: false, error: 'Join the room first.' });
    if (!text) return ack({ ok: false, error: 'Message is empty.' });

    const message = {
      id: crypto.randomUUID(),
      playerId: membership.player.id,
      name: membership.player.name,
      color: membership.player.color,
      text,
      at: now(),
    };
    addChat(membership.room, message);
    persist();
    io.to(roomId).emit('chat:new', message);
    ack({ ok: true });
  });

  socket.on('game:spin', (payload = {}, ack = () => {}) => {
    const roomId = cleanRoomId(payload.roomId);
    const membership = ensureMember(socket, roomId);
    if (!membership) return ack({ ok: false, error: 'Join the room first.' });
    const room = membership.room;
    const onlineCount = Object.values(room.players).filter(p => p.online).length;
    if (onlineCount < 2) return ack({ ok: false, error: 'Invite at least one friend before spinning.' });
    if (room.game.activeTargetId) return ack({ ok: false, error: 'Finish the current turn first.' });

    const targetId = nextTarget(room);
    if (!targetId) return ack({ ok: false, error: 'No player is available for a turn.' });

    room.game.activeTargetId = targetId;
    room.game.selectedMode = null;
    room.game.spinCount += 1;
    room.game.lastResult = { targetId, spinnerId: membership.player.id, at: now() };

    const order = Object.values(room.players).filter(p => p.online).map(p => p.id);
    const targetIndex = Math.max(0, order.indexOf(targetId));
    const rotations = 5 + crypto.randomInt(3);
    const degree = rotations * 360 + targetIndex * (360 / Math.max(order.length, 1));

    addEvent(room, 'spin', {
      spinnerId: membership.player.id,
      spinnerName: membership.player.name,
      targetId,
      targetName: room.players[targetId].name,
      targetIndex,
      playerCount: order.length,
    });
    persist();

    io.to(roomId).emit('game:spin', {
      targetId,
      targetName: room.players[targetId].name,
      spinnerName: membership.player.name,
      rotation: degree,
      spinId: crypto.randomUUID(),
      at: now(),
    });
    ack({ ok: true });
  });

  socket.on('game:choose', (payload = {}, ack = () => {}) => {
    const roomId = cleanRoomId(payload.roomId);
    const membership = ensureMember(socket, roomId);
    const mode = payload.mode === 'truth' || payload.mode === 'dare' ? payload.mode : null;
    if (!membership) return ack({ ok: false, error: 'Join the room first.' });
    if (!mode) return ack({ ok: false, error: 'Choose Truth or Dare.' });
    const room = membership.room;
    if (room.game.activeTargetId !== membership.player.id) {
      return ack({ ok: false, error: 'Only the selected player can choose.' });
    }
    if (room.game.selectedMode) return ack({ ok: false, error: 'A mode is already selected.' });

    room.game.selectedMode = mode;
    room.game.round += 1;
    const target = membership.player;
    const prompt = getPrompt(mode, room.game.round);
    const result = {
      round: room.game.round,
      mode,
      targetId: target.id,
      targetName: target.name,
      prompt,
      at: now(),
    };
    addEvent(room, 'choice', result);
    persist();

    io.to(roomId).emit('game:chosen', result);
    ack({ ok: true });
  });

  socket.on('game:done', (payload = {}, ack = () => {}) => {
    const roomId = cleanRoomId(payload.roomId);
    const membership = ensureMember(socket, roomId);
    if (!membership) return ack({ ok: false, error: 'Join the room first.' });
    const room = membership.room;
    if (room.game.activeTargetId !== membership.player.id) {
      return ack({ ok: false, error: 'Only the selected player can finish this turn.' });
    }
    room.game.activeTargetId = null;
    room.game.selectedMode = null;
    room.game.lastResult = null;
    addEvent(room, 'done', { playerId: membership.player.id, playerName: membership.player.name });
    persist();
    io.to(roomId).emit('game:done', { by: membership.player.name });
    ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const meta = sockets.get(socket.id);
    if (!meta) return;
    const room = store.rooms[meta.roomId];
    if (room?.players[meta.playerId]) {
      room.players[meta.playerId].online = false;
      room.players[meta.playerId].lastSeen = now();
      if (room.game.activeTargetId === meta.playerId) {
        room.game.activeTargetId = null;
        room.game.selectedMode = null;
      }
      persist();
      broadcastRoom(meta.roomId);
    }
    sockets.delete(socket.id);
  });
});

function getPrompt(mode, round) {
  const truths = [
    'What is a tiny thing that instantly improves your mood?',
    'What is one skill you wish you were naturally good at?',
    'What is the funniest misunderstanding you have ever had?',
    'What is one song you can listen to on repeat?',
    'What is a hobby you would try if time were unlimited?',
    'What is the most random thing in your camera roll?',
    'What is a food combination you secretly like?',
    'What is one movie or show you would happily watch again?',
    'What is your most-used emoji lately?',
    'What is one small goal you want to hit this month?',
  ];
  const dares = [
    'Do your best 10-second impression of a famous character.',
    'Speak in a dramatic movie-trailer voice for the next 20 seconds.',
    'Make up a brand-new slogan for a random object near you.',
    'Do a 10-second dance with only your hands.',
    'Try to say the alphabet backwards as far as you can.',
    'Describe your day like a sports commentator for 15 seconds.',
    'Create a funny nickname for everyone in the room.',
    'Pretend you are a cooking show host and explain how to make water.',
    'Make your best superhero pose and hold it for five seconds.',
    'Tell a two-sentence story using the words “banana” and “rocket”.',
  ];
  const list = mode === 'truth' ? truths : dares;
  return list[(round - 1) % list.length];
}

server.listen(PORT, () => {
  console.log(`Truth & Dare listening on http://localhost:${PORT}`);
});
