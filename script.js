const DECIMALS = 4;

const LEVELS = {
  easy: { name: "Easy" },
  pro: { name: "Pro" },
  insane: { name: "Insane" }
};

const socket = io();

const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");

const timerDisplay = document.getElementById("timerDisplay");
const feedback = document.getElementById("feedback");
const myScoreEl = document.getElementById("myScore");
const myBestEl = document.getElementById("myBest");
const leaderboardList = document.getElementById("leaderboardList");
const roundList = document.getElementById("roundList");
const roundStatus = document.getElementById("roundStatus");

const startRoundBtn = document.getElementById("startRoundBtn");
const stopBtn = document.getElementById("stopBtn");
const levelButtons = [...document.querySelectorAll(".level-btn")];

let myPlayerId = null;
let roomCode = null;
let roundActive = false;
let startAt = 0;
let rafId = 0;
let selectedLevel = "easy";
let isCounting = false;
let audioCtx = null;

function formatSeconds(value) {
  return Number(value).toFixed(DECIMALS);
}

function setFeedback(message, mood = "") {
  feedback.className = `feedback ${mood}`.trim();
  feedback.textContent = message;
}

function ensureAudioContext() {
  if (audioCtx) {
    return audioCtx;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    return null;
  }
  audioCtx = new Ctx();
  return audioCtx;
}

function playTone({ frequency, duration, type = "sine", volume = 0.03 }) {
  const ctx = ensureAudioContext();
  if (!ctx) {
    return;
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.value = volume;

  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  osc.start(now);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.stop(now + duration);
}

function playStartSound() {
  playTone({ frequency: 440, duration: 0.08, type: "triangle", volume: 0.03 });
}

function playPerfectSound() {
  playTone({ frequency: 760, duration: 0.1, type: "triangle", volume: 0.04 });
  setTimeout(() => {
    playTone({ frequency: 980, duration: 0.12, type: "triangle", volume: 0.04 });
  }, 90);
}

function playMissSound() {
  playTone({ frequency: 250, duration: 0.12, type: "sawtooth", volume: 0.02 });
}

function stopLocalTicker() {
  cancelAnimationFrame(rafId);
  isCounting = false;
}

function tickTimer() {
  if (!isCounting) {
    return;
  }

  const elapsed = Math.max(0, (Date.now() - startAt) / 1000);
  timerDisplay.textContent = formatSeconds(elapsed);
  rafId = requestAnimationFrame(tickTimer);
}

function beginRoundClock(serverStartAt) {
  startAt = serverStartAt;
  stopLocalTicker();
  timerDisplay.textContent = "0.0000";

  const waitMs = Math.max(0, serverStartAt - Date.now());
  setFeedback(`Round starts in ${(waitMs / 1000).toFixed(1)}s...`);

  setTimeout(() => {
    roundActive = true;
    stopBtn.disabled = false;
    isCounting = true;
    playStartSound();
    setFeedback("Round live. Hit STOP at exactly 10.0000s.");
    tickTimer();
  }, waitMs);
}

function renderLeaderboard(players) {
  leaderboardList.innerHTML = "";
  if (!players.length) {
    const li = document.createElement("li");
    li.className = "board-empty";
    li.textContent = "Waiting for players...";
    leaderboardList.appendChild(li);
    return;
  }

  players.forEach((player) => {
    const li = document.createElement("li");
    const best = Number.isFinite(player.bestDelta) ? formatSeconds(player.bestDelta) : "--";
    const marker = player.id === myPlayerId ? " (You)" : "";
    li.textContent = `${player.name}${marker} | Score ${player.totalScore} | Best ${best}s`;
    leaderboardList.appendChild(li);
  });
}

function renderRoundScores(roundScores) {
  roundList.innerHTML = "";
  if (!roundScores || !roundScores.length) {
    const li = document.createElement("li");
    li.className = "board-empty";
    li.textContent = "No round finished yet.";
    roundList.appendChild(li);
    return;
  }

  roundScores.forEach((row) => {
    const li = document.createElement("li");
    li.textContent = `${row.name} | time ${formatSeconds(row.time)}s | delta ${formatSeconds(row.delta)}s | +${row.points}`;
    roundList.appendChild(li);
  });
}

function setRoomConnected(value) {
  startRoundBtn.disabled = !value || roundActive;
  levelButtons.forEach((btn) => {
    btn.disabled = !value || roundActive;
  });
}

createRoomBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  socket.emit("createRoom", { name });
});

joinRoomBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const joinCode = roomInput.value.trim().toUpperCase();
  socket.emit("joinRoom", { name, roomCode: joinCode });
});

startRoundBtn.addEventListener("click", () => {
  if (!roomCode) {
    return;
  }
  socket.emit("startRound", { level: selectedLevel });
});

stopBtn.addEventListener("click", () => {
  if (!roundActive) {
    return;
  }
  stopBtn.disabled = true;
  socket.emit("stopAttempt");
});

levelButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (roundActive) {
      return;
    }
    selectedLevel = btn.dataset.level;
    levelButtons.forEach((b) => b.classList.toggle("active", b === btn));
    setFeedback(`Selected level: ${LEVELS[selectedLevel].name}`);
  });
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    if (roundActive && !stopBtn.disabled) {
      stopBtn.click();
    }
  }
});

socket.on("joined", ({ roomCode: joinedCode, playerId }) => {
  roomCode = joinedCode;
  myPlayerId = playerId;
  roomCodeDisplay.textContent = joinedCode;
  roomInput.value = joinedCode;
  setFeedback(`Connected to room ${joinedCode}. Start or wait for a round.`);
  setRoomConnected(true);
});

socket.on("joinError", ({ message }) => {
  setFeedback(message, "bad");
});

socket.on("roomState", (state) => {
  if (!state) {
    return;
  }

  roundStatus.textContent = state.round.active
    ? `Round running (${state.round.stoppedCount}/${state.round.totalPlayers} stopped)`
    : "Waiting for round";

  renderLeaderboard(state.players);

  const me = state.players.find((p) => p.id === myPlayerId);
  if (me) {
    myScoreEl.textContent = String(me.totalScore);
    myBestEl.textContent = Number.isFinite(me.bestDelta) ? `${formatSeconds(me.bestDelta)}s` : "--";
  }

  renderRoundScores(state.round.roundScores);

  if (!state.round.active) {
    roundActive = false;
    stopLocalTicker();
    stopBtn.disabled = true;
    if (roomCode) {
      startRoundBtn.disabled = false;
      levelButtons.forEach((btn) => {
        btn.disabled = false;
      });
    }
  }
});

socket.on("roundStarted", ({ startAt: serverStartAt, levelName, target }) => {
  startRoundBtn.disabled = true;
  levelButtons.forEach((btn) => {
    btn.disabled = true;
  });
  renderRoundScores([]);
  setFeedback(`New ${levelName} round. Target ${target.toFixed(DECIMALS)}s.`);
  beginRoundClock(serverStartAt);
});

socket.on("attemptAccepted", ({ time, delta, points }) => {
  const isPerfect = delta <= 0.01;
  setFeedback(`Locked: ${formatSeconds(time)}s | delta ${formatSeconds(delta)}s | +${points}`, isPerfect ? "good" : "warn");
  if (isPerfect) {
    playPerfectSound();
  } else {
    playMissSound();
  }
});

socket.on("roundEnded", ({ roundScores }) => {
  roundActive = false;
  stopLocalTicker();
  stopBtn.disabled = true;
  startRoundBtn.disabled = false;
  levelButtons.forEach((btn) => {
    btn.disabled = false;
  });

  renderRoundScores(roundScores);

  if (roundScores && roundScores.length) {
    setFeedback(`Round complete. Winner: ${roundScores[0].name} (${formatSeconds(roundScores[0].delta)}s delta).`, "good");
  } else {
    setFeedback("Round complete.");
  }
});

setRoomConnected(false);
renderLeaderboard([]);
renderRoundScores([]);
