const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const TARGET_SECONDS = 10;
const DECIMALS = 4;

const LEVELS = {
  easy: { name: "Easy", perfect: 0.03, close: 0.12 },
  pro: { name: "Pro", perfect: 0.01, close: 0.05 },
  insane: { name: "Insane", perfect: 0.003, close: 0.02 }
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

const rooms = new Map();

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function makeUniqueRoomCode() {
  let code = randomRoomCode();
  while (rooms.has(code)) {
    code = randomRoomCode();
  }
  return code;
}

function createRoomIfMissing(roomCode) {
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      players: new Map(),
      round: {
        active: false,
        startAt: 0,
        level: "easy",
        stopped: new Set(),
        roundScores: []
      }
    });
  }
  return rooms.get(roomCode);
}

function scoreForDelta(delta) {
  const raw = 10000 - delta * 100000;
  return Math.max(0, Math.round(raw));
}

function roomSnapshot(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return null;
  }

  const players = [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    totalScore: player.totalScore,
    attempts: player.attempts,
    bestDelta: player.bestDelta,
    lastDelta: player.lastDelta,
    lastTime: player.lastTime
  }));

  players.sort((a, b) => b.totalScore - a.totalScore || a.bestDelta - b.bestDelta);

  return {
    roomCode,
    players,
    round: {
      active: room.round.active,
      startAt: room.round.startAt,
      level: room.round.level,
      target: TARGET_SECONDS,
      stoppedCount: room.round.stopped.size,
      totalPlayers: room.players.size,
      roundScores: room.round.roundScores
    }
  };
}

function broadcastRoom(roomCode) {
  io.to(roomCode).emit("roomState", roomSnapshot(roomCode));
}

function cleanupRoomIfEmpty(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }
  if (room.players.size === 0) {
    rooms.delete(roomCode);
  }
}

io.on("connection", (socket) => {
  socket.data.roomCode = null;
  socket.data.playerName = null;

  socket.on("createRoom", ({ name }) => {
    const playerName = String(name || "").trim().slice(0, 20);
    if (!playerName) {
      socket.emit("joinError", { message: "Enter a name first." });
      return;
    }

    const roomCode = makeUniqueRoomCode();
    const room = createRoomIfMissing(roomCode);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      totalScore: 0,
      attempts: 0,
      bestDelta: Infinity,
      lastDelta: null,
      lastTime: null
    });

    socket.emit("joined", { roomCode, playerId: socket.id });
    broadcastRoom(roomCode);
  });

  socket.on("joinRoom", ({ name, roomCode }) => {
    const playerName = String(name || "").trim().slice(0, 20);
    const cleanRoomCode = String(roomCode || "").trim().toUpperCase();

    if (!playerName) {
      socket.emit("joinError", { message: "Enter a name first." });
      return;
    }
    if (!cleanRoomCode || !rooms.has(cleanRoomCode)) {
      socket.emit("joinError", { message: "Room not found." });
      return;
    }

    const room = rooms.get(cleanRoomCode);

    socket.join(cleanRoomCode);
    socket.data.roomCode = cleanRoomCode;
    socket.data.playerName = playerName;

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      totalScore: 0,
      attempts: 0,
      bestDelta: Infinity,
      lastDelta: null,
      lastTime: null
    });

    socket.emit("joined", { roomCode: cleanRoomCode, playerId: socket.id });
    broadcastRoom(cleanRoomCode);
  });

  socket.on("startRound", ({ level }) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode || !rooms.has(roomCode)) {
      return;
    }

    const room = rooms.get(roomCode);
    if (room.round.active) {
      return;
    }

    const levelKey = LEVELS[level] ? level : "easy";
    room.round.active = true;
    room.round.level = levelKey;
    room.round.startAt = Date.now() + 3000;
    room.round.stopped = new Set();
    room.round.roundScores = [];

    io.to(roomCode).emit("roundStarted", {
      startAt: room.round.startAt,
      level: levelKey,
      levelName: LEVELS[levelKey].name,
      target: TARGET_SECONDS
    });

    broadcastRoom(roomCode);
  });

  socket.on("stopAttempt", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode || !rooms.has(roomCode)) {
      return;
    }

    const room = rooms.get(roomCode);
    const player = room.players.get(socket.id);

    if (!room.round.active || !player || room.round.stopped.has(socket.id)) {
      return;
    }

    const elapsed = Math.max(0, (Date.now() - room.round.startAt) / 1000);
    const delta = Math.abs(elapsed - TARGET_SECONDS);
    const points = scoreForDelta(delta);

    player.totalScore += points;
    player.attempts += 1;
    player.bestDelta = Math.min(player.bestDelta, delta);
    player.lastDelta = delta;
    player.lastTime = elapsed;

    room.round.stopped.add(socket.id);

    const roundRow = {
      playerId: player.id,
      name: player.name,
      time: Number(elapsed.toFixed(DECIMALS)),
      delta: Number(delta.toFixed(DECIMALS)),
      points
    };

    room.round.roundScores.push(roundRow);

    socket.emit("attemptAccepted", {
      time: roundRow.time,
      delta: roundRow.delta,
      points,
      level: room.round.level
    });

    const everyoneStopped = room.round.stopped.size === room.players.size;

    if (everyoneStopped) {
      room.round.active = false;
      io.to(roomCode).emit("roundEnded", {
        roundScores: room.round.roundScores
          .slice()
          .sort((a, b) => a.delta - b.delta || b.points - a.points)
      });
    }

    broadcastRoom(roomCode);
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode || !rooms.has(roomCode)) {
      return;
    }

    const room = rooms.get(roomCode);
    room.players.delete(socket.id);
    room.round.stopped.delete(socket.id);

    if (room.players.size === 0) {
      rooms.delete(roomCode);
      return;
    }

    if (room.round.active && room.round.stopped.size === room.players.size) {
      room.round.active = false;
      io.to(roomCode).emit("roundEnded", {
        roundScores: room.round.roundScores
          .slice()
          .sort((a, b) => a.delta - b.delta || b.points - a.points)
      });
    }

    broadcastRoom(roomCode);
    cleanupRoomIfEmpty(roomCode);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${PORT}`);
});
