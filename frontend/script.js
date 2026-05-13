const MODULUS = 5;
const BOT_CACHE_LIMIT = 10;
const REPETITION_LIMIT = 3;
const NO_BOT_MOVE = -1;

const state = {
  user: [1, 1],
  opponent: [1, 1],
};

let draggedHand = null;
let rearranging = false;
let rearrangeTotal = 0;
let rearrangeStart = [1, 1];
let userTurnActive = true;
let gameOver = null;
let toastTimer = null;

const REPETITION_MESSAGE = "That position has already appeared twice.";

const hands = Array.from(document.querySelectorAll(".hand"));
const rearrangeButton = document.querySelector(".rearrange");
const cancelButton = document.querySelector(".rearrange-cancel");
const actions = document.querySelector(".rearrange-actions");
const bannerWrapper = document.querySelector(".banner-wrapper");
const bannerTitle = document.querySelector(".banner-title");
const playAgainButton = document.querySelector(".play-again");
const toastEl = document.querySelector(".toast");
const botWasmPromise = loadBotWasm();
const prebuiltBotMoveCache = new Map(window.chopsticksPrebuiltBotCache ?? []);
const botMoveCache = new Map();
const botCacheLimit = Math.max(BOT_CACHE_LIMIT, prebuiltBotMoveCache.size);
const repetitionCounts = new Map();

function isGameOver() {
  return gameOver !== null;
}

const BANNER_TITLES = {
  "user-win": "You win!",
  "bot-win": "You lose.",
  draw: "Draw.",
};

async function loadBotWasm() {
  if (window.chopsticksBotWasmBase64) {
    const binary = atob(window.chopsticksBotWasmBase64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const { instance } = await WebAssembly.instantiate(bytes);
    return instance.exports;
  }

  const wasmUrl = new URL(
    "../target/wasm32-unknown-unknown/release/chopsticks.wasm",
    window.location.href,
  );

  try {
    const response = await fetch(wasmUrl);
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes);
    return instance.exports;
  } catch (error) {
    console.error(
      "Could not load Chopsticks WASM bot. Run `scripts/build-static-wasm.sh`.",
      error,
    );
    return null;
  }
}

function handValue(person, hand) {
  return state[person][hand];
}

function canDrag(handEl) {
  return (
    !isGameOver() &&
    userTurnActive &&
    !rearranging &&
    handEl.dataset.person === "user" &&
    handValue("user", Number(handEl.dataset.hand)) > 0
  );
}

function canDrop(targetEl) {
  if (isGameOver() || !userTurnActive || draggedHand === null) {
    return false;
  }
  if (targetEl.dataset.person !== "opponent") {
    return false;
  }
  return hitIssue(draggedHand, Number(targetEl.dataset.hand)) === "none";
}

function hitIssue(attacker, target) {
  if (state.user[attacker] === 0) {
    return "no-attacker";
  }
  if (state.opponent[target] === 0) {
    return "dead";
  }

  const candidate = currentState();
  candidate.opponent[target] =
    (state.opponent[target] + state.user[attacker]) % MODULUS;
  candidate.opponent = canonicalPair(candidate.opponent);

  return wouldRepeat("bot", candidate) ? "would-repeat" : "none";
}

function hasLiveHands(person) {
  return state[person].some((value) => value > 0);
}

function render() {
  for (const handEl of hands) {
    const person = handEl.dataset.person;
    const hand = Number(handEl.dataset.hand);
    const value = handValue(person, hand);
    const editable = rearranging && person === "user";
    const inactiveUserHand =
      person === "user" && (!userTurnActive || isGameOver());

    handEl.textContent = value;
    handEl.draggable =
      !isGameOver() &&
      !editable &&
      userTurnActive &&
      person === "user" &&
      value > 0;
    handEl.contentEditable = editable ? "true" : "false";
    handEl.spellcheck = false;
    handEl.classList.toggle("dead", value === 0);
    handEl.classList.toggle("draggable", handEl.draggable);
    handEl.classList.toggle("editing", editable);
    handEl.classList.toggle("inactive", inactiveUserHand);
    handEl.setAttribute("aria-label", `${person} hand ${hand + 1}: ${value}`);
  }

  rearrangeButton.textContent = rearranging ? "Confirm" : "Rearrange";
  rearrangeButton.disabled = rearranging
    ? rearrangeIssue() === "unchanged"
    : !userTurnActive || isGameOver();
  cancelButton.disabled = !rearranging;
  actions.classList.toggle("editing", rearranging);
  actions.classList.toggle(
    "inactive",
    (!userTurnActive || isGameOver()) && !rearranging,
  );

  if (isGameOver()) {
    bannerTitle.textContent = BANNER_TITLES[gameOver];
    bannerWrapper.hidden = false;
  } else {
    bannerWrapper.hidden = true;
  }
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("visible");
    toastTimer = null;
  }, 2500);
}

function currentState() {
  return {
    user: [...state.user],
    opponent: [...state.opponent],
  };
}

function canonicalPair(hands) {
  return [...hands].sort((left, right) => left - right);
}

function repetitionKey(turn, candidate = currentState()) {
  const user = canonicalPair(candidate.user);
  const opponent = canonicalPair(candidate.opponent);

  return `${turn}:${user[0]},${user[1]}:${opponent[0]},${opponent[1]}`;
}

function wouldRepeat(turn, candidate) {
  return (
    (repetitionCounts.get(repetitionKey(turn, candidate)) ?? 0) >=
    REPETITION_LIMIT - 1
  );
}

function recordPosition(turn, candidate = currentState()) {
  const key = repetitionKey(turn, candidate);
  repetitionCounts.set(key, (repetitionCounts.get(key) ?? 0) + 1);
}

function applyPackedHands(packed) {
  state.user[0] = packed & 0xf;
  state.user[1] = (packed >> 4) & 0xf;
  state.opponent[0] = (packed >> 8) & 0xf;
  state.opponent[1] = (packed >> 12) & 0xf;
}

function packedToState(packed) {
  return {
    user: canonicalPair([packed & 0xf, (packed >> 4) & 0xf]),
    opponent: canonicalPair([(packed >> 8) & 0xf, (packed >> 12) & 0xf]),
  };
}

function sortedHandPair(hands) {
  return [...hands].sort((left, right) => left - right);
}

function botCacheKey() {
  const user = sortedHandPair(state.user);
  const opponent = sortedHandPair(state.opponent);

  return `${user[0]},${user[1]}:${opponent[0]},${opponent[1]}`;
}

function historyFingerprint() {
  return [...repetitionCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join("|");
}

function botHistoryCacheKey() {
  return `${botCacheKey()}|${historyFingerprint()}`;
}

function cacheBotMove(key, packed) {
  if (botMoveCache.has(key)) {
    botMoveCache.delete(key);
  }

  botMoveCache.set(key, packed);

  while (botMoveCache.size > botCacheLimit) {
    botMoveCache.delete(botMoveCache.keys().next().value);
  }
}

function calculateBotMove(bot) {
  const historyKey = botHistoryCacheKey();
  const cached = botMoveCache.get(historyKey);

  if (cached !== undefined) {
    return cached;
  }

  const stateKey = botCacheKey();
  const prebuilt = prebuiltBotMoveCache.get(stateKey);

  if (prebuilt !== undefined && !wouldRepeat("user", packedToState(prebuilt))) {
    cacheBotMove(historyKey, prebuilt);
    return prebuilt;
  }

  const best = bot.chopsticks_bot_next_state(
    state.user[0],
    state.user[1],
    state.opponent[0],
    state.opponent[1],
  );

  if (!wouldRepeat("user", packedToState(best))) {
    cacheBotMove(historyKey, best);
    return best;
  }

  if (!bot.chopsticks_bot_ranked_next_state) {
    return null;
  }

  for (let rank = 0; rank < 32; rank += 1) {
    const next = bot.chopsticks_bot_ranked_next_state(
      state.user[0],
      state.user[1],
      state.opponent[0],
      state.opponent[1],
      rank,
    );

    if (next === NO_BOT_MOVE) {
      return null;
    }

    if (!wouldRepeat("user", packedToState(next))) {
      cacheBotMove(historyKey, next);
      return next;
    }
  }

  return null;
}

function finishUserTurn() {
  userTurnActive = false;
  clearDragState();

  if (!hasLiveHands("opponent")) {
    gameOver = "user-win";
    render();
    return;
  }

  recordPosition("bot");
  render();
  window.setTimeout(botTurn, 250);
}

function hasLegalUserMove() {
  if (!hasLiveHands("user") || !hasLiveHands("opponent")) {
    return false;
  }

  for (let attacker = 0; attacker < 2; attacker += 1) {
    const amount = state.user[attacker];
    if (amount === 0) {
      continue;
    }

    for (let target = 0; target < 2; target += 1) {
      const before = state.opponent[target];
      if (before === 0) {
        continue;
      }

      const candidate = currentState();
      candidate.opponent[target] = (before + amount) % MODULUS;
      candidate.opponent = canonicalPair(candidate.opponent);

      if (!wouldRepeat("bot", candidate)) {
        return true;
      }
    }
  }

  const total = state.user[0] + state.user[1];
  const before = canonicalPair(state.user);

  for (let left = 0; left < MODULUS; left += 1) {
    for (let right = left; right < MODULUS; right += 1) {
      const after = [left, right];
      if (
        left + right === total &&
        (after[0] !== before[0] || after[1] !== before[1]) &&
        !wouldRepeat("bot", {
          user: after,
          opponent: canonicalPair(state.opponent),
        })
      ) {
        return true;
      }
    }
  }

  return false;
}

async function botTurn() {
  const bot = await botWasmPromise;

  if (bot?.chopsticks_bot_next_state) {
    const next = calculateBotMove(bot);
    if (next === null) {
      gameOver = "draw";
      render();
      return;
    }
    applyPackedHands(next);
    recordPosition("user");
  } else {
    console.warn(
      "Chopsticks WASM bot is unavailable; returning control to the player.",
    );
  }

  if (!hasLiveHands("user")) {
    gameOver = "bot-win";
  } else if (!hasLegalUserMove()) {
    gameOver = "draw";
  } else {
    userTurnActive = true;
  }
  render();
}

function hitOpponent(targetEl) {
  if (!canDrop(targetEl)) {
    return;
  }

  const target = Number(targetEl.dataset.hand);
  const after = (state.opponent[target] + state.user[draggedHand]) % MODULUS;

  state.opponent[target] = after;
  state.opponent = canonicalPair(state.opponent);
  finishUserTurn();
}

function clearDragState() {
  draggedHand = null;
  document.body.classList.remove("dragging");
  for (const handEl of hands) {
    handEl.classList.remove("drag-source", "drop-target");
  }
}

function toggleRearrange() {
  clearDragState();

  if (isGameOver() || (!userTurnActive && !rearranging)) {
    return;
  }

  if (!rearranging) {
    rearrangeStart = [...state.user];
    rearrangeTotal = state.user[0] + state.user[1];
    rearranging = true;
    render();
    hands
      .find((h) => h.dataset.person === "user" && h.dataset.hand === "0")
      ?.focus();
    return;
  }

  const issue = rearrangeIssue();

  if (issue === "unchanged") {
    render();
    return;
  }

  if (issue === "would-repeat") {
    showToast(REPETITION_MESSAGE);
    return;
  }

  rearranging = false;
  state.user = canonicalPair(state.user);
  finishUserTurn();
}

function cancelRearrange() {
  if (!rearranging) {
    return;
  }

  clearDragState();
  state.user = [...rearrangeStart];
  rearranging = false;
  render();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function splitRange(total) {
  return {
    min: Math.max(0, total - (MODULUS - 1)),
    max: Math.min(MODULUS - 1, total),
  };
}

function sortedPair(values) {
  return [...values].sort((left, right) => left - right);
}

function rearrangeIssue() {
  if (!rearranging) {
    return "none";
  }

  const before = sortedPair(rearrangeStart);
  const after = sortedPair(state.user);

  if (before[0] === after[0] && before[1] === after[1]) {
    return "unchanged";
  }

  return wouldRepeat("bot", {
    user: after,
    opponent: canonicalPair(state.opponent),
  })
    ? "would-repeat"
    : "none";
}

function resetGame() {
  state.user = [1, 1];
  state.opponent = [1, 1];
  draggedHand = null;
  rearranging = false;
  rearrangeTotal = 0;
  rearrangeStart = [1, 1];
  userTurnActive = true;
  gameOver = null;
  repetitionCounts.clear();
  botMoveCache.clear();
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastEl.classList.remove("visible");
  clearDragState();
  recordPosition("user");
  render();
}

function placeCaretAtEnd(element) {
  const range = document.createRange();
  const selection = window.getSelection();

  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function updateSplitFromEdit(handEl) {
  if (!rearranging || handEl.dataset.person !== "user") {
    return;
  }

  const changedHand = Number(handEl.dataset.hand);
  const otherHand = 1 - changedHand;
  const digit = handEl.textContent.match(/[0-4]/)?.[0];
  const range = splitRange(rearrangeTotal);
  const value = clamp(Number(digit ?? range.min), range.min, range.max);

  state.user[changedHand] = value;
  state.user[otherHand] = rearrangeTotal - value;
  render();
  placeCaretAtEnd(handEl);
}

rearrangeButton.addEventListener("click", toggleRearrange);
cancelButton.addEventListener("click", cancelRearrange);
playAgainButton.addEventListener("click", resetGame);

for (const handEl of hands) {
  handEl.addEventListener("dragstart", (event) => {
    if (!canDrag(handEl)) {
      event.preventDefault();
      return;
    }

    draggedHand = Number(handEl.dataset.hand);
    handEl.classList.add("drag-source");
    document.body.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(draggedHand));
  });

  handEl.addEventListener("dragend", clearDragState);

  handEl.addEventListener("dragenter", () => {
    if (canDrop(handEl)) {
      handEl.classList.add("drop-target");
      return;
    }

    if (
      !isGameOver() &&
      userTurnActive &&
      draggedHand !== null &&
      handEl.dataset.person === "opponent" &&
      hitIssue(draggedHand, Number(handEl.dataset.hand)) === "would-repeat"
    ) {
      showToast(REPETITION_MESSAGE);
    }
  });

  handEl.addEventListener("dragleave", () => {
    handEl.classList.remove("drop-target");
  });

  handEl.addEventListener("dragover", (event) => {
    if (!canDrop(handEl)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  handEl.addEventListener("drop", (event) => {
    event.preventDefault();
    hitOpponent(handEl);
  });

  handEl.addEventListener("click", () => {
    if (rearranging) {
      return;
    }

    const person = handEl.dataset.person;

    if (person === "user") {
      if (!canDrag(handEl)) {
        return;
      }

      const hand = Number(handEl.dataset.hand);

      if (draggedHand === hand) {
        clearDragState();
        return;
      }

      clearDragState();
      draggedHand = hand;
      handEl.classList.add("drag-source");
      document.body.classList.add("dragging");
      return;
    }

    if (person === "opponent" && draggedHand !== null) {
      if (canDrop(handEl)) {
        hitOpponent(handEl);
      } else if (
        !isGameOver() &&
        userTurnActive &&
        hitIssue(draggedHand, Number(handEl.dataset.hand)) === "would-repeat"
      ) {
        showToast(REPETITION_MESSAGE);
      }
    }
  });

  handEl.addEventListener("input", () => updateSplitFromEdit(handEl));

  handEl.addEventListener("focus", () => {
    if (rearranging && handEl.dataset.person === "user") {
      placeCaretAtEnd(handEl);
    }
  });

  handEl.addEventListener("keydown", (event) => {
    if (!rearranging || handEl.dataset.person !== "user") {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      toggleRearrange();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelRearrange();
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const range = splitRange(rearrangeTotal);
      // ArrowLeft shifts value toward the left hand (hand 0 gains), ArrowRight toward the right.
      const delta = event.key === "ArrowLeft" ? 1 : -1;
      const newLeft = clamp(state.user[0] + delta, range.min, range.max);
      state.user[0] = newLeft;
      state.user[1] = rearrangeTotal - newLeft;
      render();
      placeCaretAtEnd(handEl);
      return;
    }

    const allowedControlKey = ["Backspace", "Delete", "Tab"].includes(
      event.key,
    );

    if (/^[0-4]$/.test(event.key)) {
      event.preventDefault();
      handEl.textContent = event.key;
      updateSplitFromEdit(handEl);
      return;
    }

    if (!allowedControlKey) {
      event.preventDefault();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "r" && !rearranging && !rearrangeButton.disabled) {
    event.preventDefault();
    toggleRearrange();
    return;
  }

  if (!rearranging || document.activeElement?.classList.contains("hand")) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    cancelRearrange();
  } else if (event.key === "Enter") {
    event.preventDefault();
    toggleRearrange();
  }
});

recordPosition("user");
render();
