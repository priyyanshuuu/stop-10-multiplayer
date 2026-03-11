const DECIMALS = 4;
const TARGET_SECONDS = 10;
const SINGLE_HISTORY_KEY = "stop10_single_paused_times_v1";

let socket = null;
let username = "";
let mode = "single";

const usernameInput = document.getElementById("usernameInput");
const singleModeBtn = document.getElementById("singleModeBtn");
const multiModeBtn = document.getElementById("multiModeBtn");
const multiplayerPanel = document.getElementById("multiplayerPanel");
const singleControls = document.getElementById("singleControls");
const multiControls = document.getElementById("multiControls");

const roomInput = document.getElementById("roomInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");
const startRoundBtn = document.getElementById("startRoundBtn");
const multiStopBtn = document.getElementById("multiStopBtn");

const singleStartBtn = document.getElementById("singleStartBtn");
const singleStopBtn = document.getElementById("singleStopBtn");
const singleResetBtn = document.getElementById("singleResetBtn");

const timerDisplay = document.getElementById("timerDisplay");
const feedback = document.getElementById("feedback");
const attemptsEl = document.getElementById("attempts");
const bestPausedEl = document.getElementById("bestPaused");
const leaderboardList = document.getElementById("leaderboardList");
const roundStatus = document.getElementById("roundStatus");

let singleRunning = false;
let singleStartAt = 0;
let timerRafId = 0;
let currentElapsed = 0;
let singleAttempts = 0;
let singlePausedTimes = loadSinglePausedTimes();

let roomCode = null;
let myPlayerId = null;
let multiRoundActive = false;
let multiStartAt = 0;
let isCounting = false;

let audioCtx = null;

function formatSeconds(value) {
  return Number(value).toFixed(DECIMALS);
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

function playStopSound() {
  playTone({ frequency: 760, duration: 0.1, type: "triangle", volume: 0.035 });
}

function setFeedback(message, mood = "") {
  feedback.className = `feedback ${mood}`.trim();
  feedback.textContent = message;
}

function loadSinglePausedTimes() {
  const raw = localStorage.getItem(SINGLE_HISTORY_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.slice(0, 12).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  } catch {
    return [];
  }
}

function saveSinglePausedTimes() {
  localStorage.setItem(SINGLE_HISTORY_KEY, JSON.stringify(singlePausedTimes.slice(0, 12)));
}

function renderSingleStats() {
  attemptsEl.textContent = String(singleAttempts);
  if (!singlePausedTimes.length) {
    bestPausedEl.textContent = "--";
    return;
  }
  const best = [...singlePausedTimes].sort(
    (a, b) => Math.abs(a - TARGET_SECONDS) - Math.abs(b - TARGET_SECONDS)
  )[0];
  bestPausedEl.textContent = `${formatSeconds(best)}s`;
}

function renderSingleLeaderboard() {
  leaderboardList.innerHTML = "";
  if (!singlePausedTimes.length) {
    const li = document.createElement("li");
    li.className = "board-empty";
    li.textContent = "No paused times yet.";
    leaderboardList.appendChild(li);
    return;
  }

  singlePausedTimes.forEach((pausedTime) => {
    const li = document.createElement("li");
    li.textContent = `${formatSeconds(pausedTime)}s`;
    leaderboardList.appendChild(li);
  });
}

function stopTicker() {
  cancelAnimationFrame(timerRafId);
  isCounting = false;
}

function updateLocalTimer() {
  if (!singleRunning) {
    return;
  }
  currentElapsed = (performance.now() - singleStartAt) / 1000;
  timerDisplay.textContent = formatSeconds(currentElapsed);
  timerRafId = requestAnimationFrame(updateLocalTimer);
}

function startSingleGame() {
  if (singleRunning || mode !== "single") {
    return;
  }
  singleRunning = true;
  singleStartAt = performance.now();
  currentElapsed = 0;
  timerDisplay.textContent = "0.0000";
  setFeedback("Singleplayer running. Stop at exactly 10.0000s.");
  singleStartBtn.disabled = true;
  singleStopBtn.disabled = false;
  playStartSound();
  cancelAnimationFrame(timerRafId);
  timerRafId = requestAnimationFrame(updateLocalTimer);
}

function stopSingleGame() {
  if (!singleRunning || mode !== "single") {
    return;
  }
  singleRunning = false;
  cancelAnimationFrame(timerRafId);
  singleAttempts += 1;
  singlePausedTimes.unshift(Number(currentElapsed.toFixed(DECIMALS)));
  singlePausedTimes = singlePausedTimes.slice(0, 12);
  saveSinglePausedTimes();
  renderSingleStats();
  renderSingleLeaderboard();
  setFeedback(`Paused at ${formatSeconds(currentElapsed)}s.`);
  singleStartBtn.disabled = false;
  singleStopBtn.disabled = true;
  playStopSound();
}

function resetSingleGame() {
  singleRunning = false;
  cancelAnimationFrame(timerRafId);
  currentElapsed = 0;
  singleAttempts = 0;
  singlePausedTimes = [];
  saveSinglePausedTimes();
  timerDisplay.textContent = "0.0000";
  renderSingleStats();
  renderSingleLeaderboard();
  setFeedback("Singleplayer reset.");
  singleStartBtn.disabled = false;
  singleStopBtn.disabled = true;
}

function renderMultiplayerLeaderboard(players) {
  leaderboardList.innerHTML = "";
  if (!players.length) {
    const li = document.createElement("li");
    li.className = "board-empty";
    li.textContent = "Waiting for players...";
    leaderboardList.appendChild(li);
    return;
  }

  players.forEach((player) => {
    const marker = player.id === myPlayerId ? " (You)" : "";
    const paused = Number.isFinite(player.lastTime) ? `${formatSeconds(player.lastTime)}s` : "--";
    const li = document.createElement("li");
    li.textContent = `${player.name}${marker}: ${paused}`;
    leaderboardList.appendChild(li);
  });
}

function setMode(nextMode) {
  mode = nextMode;
  const singleSelected = mode === "single";
  singleModeBtn.classList.toggle("active-mode", singleSelected);
  multiModeBtn.classList.toggle("active-mode", !singleSelected);
  singleModeBtn.classList.toggle("btn-primary", singleSelected);
  singleModeBtn.classList.toggle("btn-ghost", !singleSelected);
  multiModeBtn.classList.toggle("btn-primary", !singleSelected);
  multiModeBtn.classList.toggle("btn-ghost", singleSelected);

  multiplayerPanel.classList.toggle("hidden", singleSelected);
  singleControls.classList.toggle("hidden", !singleSelected);
  multiControls.classList.toggle("hidden", singleSelected);

  timerDisplay.textContent = "0.0000";
  stopTicker();
  singleRunning = false;
  multiRoundActive = false;
  singleStartBtn.disabled = false;
  singleStopBtn.disabled = true;
  multiStopBtn.disabled = true;

  if (singleSelected) {
    roundStatus.textContent = "Paused times only";
    setFeedback("Singleplayer mode: press Start to begin.");
    renderSingleStats();
    renderSingleLeaderboard();
  } else {
    roundStatus.textContent = "Multiplayer paused times";
    setFeedback("Multiplayer mode: create or join a room.");
    attemptsEl.textContent = "--";
    bestPausedEl.textContent = "--";
    leaderboardList.innerHTML = "";
    ensureSocket();
    startRoundBtn.disabled = !roomCode;
  }
}

function ensureSocket() {
  if (socket) {
    return;
  }

  socket = io();

  socket.on("joined", ({ roomCode: joinedCode, playerId }) => {
    roomCode = joinedCode;
    myPlayerId = playerId;
    roomCodeDisplay.textContent = joinedCode;
    roomInput.value = joinedCode;
    startRoundBtn.disabled = false;
    setFeedback(`Connected to room ${joinedCode}.`);
  });

  socket.on("joinError", ({ message }) => {
    setFeedback(message, "bad");
  });

  socket.on("roomState", (state) => {
    if (!state || mode !== "multi") {
      return;
    }
    roundStatus.textContent = state.round.active
      ? `Round running (${state.round.stoppedCount}/${state.round.totalPlayers} stopped)`
      : "Multiplayer paused times";
    renderMultiplayerLeaderboard(state.players);

    if (!state.round.active) {
      multiRoundActive = false;
      stopTicker();
      multiStopBtn.disabled = true;
      if (roomCode) {
        startRoundBtn.disabled = false;
      }
    }
  });

  socket.on("roundStarted", ({ startAt: serverStartAt, target }) => {
    if (mode !== "multi") {
      return;
    }
    startRoundBtn.disabled = true;
    timerDisplay.textContent = "0.0000";
    setFeedback(`New round. Target ${target.toFixed(DECIMALS)}s.`);

    const waitMs = Math.max(0, serverStartAt - Date.now());
    setTimeout(() => {
      multiRoundActive = true;
      multiStartAt = serverStartAt;
      multiStopBtn.disabled = false;
      isCounting = true;
      playStartSound();
      setFeedback("Round live. Hit STOP.");
      tickMultiTimer();
    }, waitMs);
  });

  socket.on("attemptAccepted", ({ time }) => {
    if (mode !== "multi") {
      return;
    }
    setFeedback(`Paused at ${formatSeconds(time)}s.`, "good");
    playStopSound();
  });

  socket.on("roundEnded", () => {
    if (mode !== "multi") {
      return;
    }
    multiRoundActive = false;
    stopTicker();
    multiStopBtn.disabled = true;
    if (roomCode) {
      startRoundBtn.disabled = false;
    }
    setFeedback("Round complete.");
  });
}

function tickMultiTimer() {
  if (!isCounting || mode !== "multi") {
    return;
  }
  const elapsed = Math.max(0, (Date.now() - multiStartAt) / 1000);
  timerDisplay.textContent = formatSeconds(elapsed);
  timerRafId = requestAnimationFrame(tickMultiTimer);
}

singleModeBtn.addEventListener("click", () => {
  setMode("single");
});

multiModeBtn.addEventListener("click", () => {
  setMode("multi");
});

usernameInput.addEventListener("input", () => {
  username = usernameInput.value.trim();
});

singleStartBtn.addEventListener("click", startSingleGame);
singleStopBtn.addEventListener("click", stopSingleGame);
singleResetBtn.addEventListener("click", resetSingleGame);

createRoomBtn.addEventListener("click", () => {
  if (mode !== "multi") {
    return;
  }
  ensureSocket();
  const name = usernameInput.value.trim();
  socket.emit("createRoom", { name });
});

joinRoomBtn.addEventListener("click", () => {
  if (mode !== "multi") {
    return;
  }
  ensureSocket();
  const name = usernameInput.value.trim();
  const joinCode = roomInput.value.trim().toUpperCase();
  socket.emit("joinRoom", { name, roomCode: joinCode });
});

startRoundBtn.addEventListener("click", () => {
  if (mode !== "multi" || !roomCode || !socket) {
    return;
  }
  socket.emit("startRound", {});
});

multiStopBtn.addEventListener("click", () => {
  if (mode !== "multi" || !multiRoundActive || !socket) {
    return;
  }
  multiStopBtn.disabled = true;
  socket.emit("stopAttempt");
});

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space") {
    return;
  }
  event.preventDefault();
  if (mode === "single") {
    if (singleRunning) {
      stopSingleGame();
    } else {
      startSingleGame();
    }
    return;
  }
  if (mode === "multi" && multiRoundActive && !multiStopBtn.disabled) {
    multiStopBtn.click();
  }
});

renderSingleStats();
renderSingleLeaderboard();
setMode("single");
