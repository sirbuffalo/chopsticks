import { createBotController } from "./bot.js";
import {
  MODULUS,
  applyPackedHands,
  canonicalPair,
  clamp,
  cloneState,
  hasLegalUserMove,
  hasLiveHands,
  recordPosition as recordRepetitionPosition,
  sortedPair,
  splitRange,
  wouldRepeat as wouldRepeatPosition,
} from "./rules.js";
import { createUi } from "./ui.js";

const state = {
  user: [1, 1],
  opponent: [1, 1],
};

let selectedHand = null;
let rearranging = false;
let rearrangeTotal = 0;
let rearrangeStart = [1, 1];
let userTurnActive = false;
let gameOver = null;
let keyboardMode = false;
let choosingStart = true;
let startChoiceClosing = false;

const REPETITION_MESSAGE = "That position has already appeared twice.";
const ILLEGAL_MOVE_MESSAGES = {
  "no-attacker": "You need to use a live hand.",
  dead: "You cannot tap a dead hand.",
  unchanged: "Rearrange has to change your hands.",
  "would-repeat": REPETITION_MESSAGE,
};
const TURN_INDICATOR_GAME_OVER_TEXT = {
  "user-win": "You Win. Tap to Play Again.",
  "bot-win": "You Lose. Tap to Play Again.",
  draw: "Draw. Tap to Play Again.",
};
const ACTIVATION_KEYS = new Set(["Enter", " "]);

const repetitionCounts = new Map();
const ui = createUi();
const botController = createBotController({
  state,
  repetitionCounts,
  wouldRepeat,
});

function isGameOver() {
  return gameOver !== null;
}

function handValue(person, hand) {
  return state[person][hand];
}

function currentState() {
  return cloneState(state);
}

function wouldRepeat(turn, candidate) {
  return wouldRepeatPosition(repetitionCounts, turn, candidate);
}

function recordPosition(turn, candidate = currentState()) {
  recordRepetitionPosition(repetitionCounts, turn, candidate);
}

function preserveVisiblePairOrder(previous, next) {
  const orderedScore =
    Number(previous[0] === next[0]) + Number(previous[1] === next[1]);
  const reversedScore =
    Number(previous[0] === next[1]) + Number(previous[1] === next[0]);

  return reversedScore > orderedScore ? [next[1], next[0]] : [...next];
}

function render() {
  const legalTargets = new Set();

  if (
    !choosingStart &&
    !startChoiceClosing &&
    !rearranging &&
    !isGameOver() &&
    userTurnActive &&
    selectedHand !== null
  ) {
    for (let hand = 0; hand < 2; hand += 1) {
      if (hitIssue(selectedHand, hand) === "none") {
        legalTargets.add(hand);
      }
    }
  }

  let turnText;
  if (gameOver !== null) {
    turnText = TURN_INDICATOR_GAME_OVER_TEXT[gameOver];
  } else if (choosingStart || startChoiceClosing) {
    turnText = "";
  } else if (rearranging) {
    turnText = "Rearrange your hands";
  } else if (userTurnActive) {
    turnText =
      selectedHand === null ? "Your turn" : "Choose a highlighted target";
  } else {
    turnText = "Bot thinking";
  }

  ui.render({
    state,
    rearranging,
    userTurnActive,
    gameOver,
    issue: rearrangeIssue(),
    selectedHand,
    legalTargets,
    turnText,
    choosingStart,
    startChoiceClosing,
  });
}

function showIllegalMove(issue) {
  const message = ILLEGAL_MOVE_MESSAGES[issue];

  if (message !== undefined) {
    ui.showToast(message);
  }
}

function finishGame(result) {
  gameOver = result;
  render();
}

function beginStartChoice() {
  choosingStart = true;
  startChoiceClosing = false;
  userTurnActive = false;
  render();
}

function startGame(userGoesFirst) {
  if (!choosingStart || startChoiceClosing) {
    return;
  }

  startChoiceClosing = true;
  render();

  window.setTimeout(() => {
    choosingStart = false;
    startChoiceClosing = false;

    if (userGoesFirst) {
      userTurnActive = true;
      recordPosition("user");
      render();
      return;
    }

    userTurnActive = false;
    recordPosition("bot");
    render();
    window.setTimeout(botTurn, 250);
  }, 220);
}

function canDrag(handEl) {
  return (
    !isGameOver() &&
    !choosingStart &&
    !startChoiceClosing &&
    userTurnActive &&
    !rearranging &&
    handEl.dataset.person === "user" &&
    handValue("user", Number(handEl.dataset.hand)) > 0
  );
}

function canDrop(targetEl) {
  if (
    isGameOver() ||
    choosingStart ||
    startChoiceClosing ||
    !userTurnActive ||
    selectedHand === null
  ) {
    return false;
  }
  if (targetEl.dataset.person !== "opponent") {
    return false;
  }
  return hitIssue(selectedHand, Number(targetEl.dataset.hand)) === "none";
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

function clearDragState() {
  selectedHand = null;
  ui.clearDragState();
}

function exitKeyboardMode() {
  keyboardMode = false;
  clearDragState();
  render();
  ui.blurActiveHand();
}

function activateHand(handEl, { moveFocus = false } = {}) {
  if (choosingStart || startChoiceClosing || rearranging) {
    return;
  }

  const person = handEl.dataset.person;

  if (person === "user") {
    if (!canDrag(handEl)) {
      return;
    }

    const hand = Number(handEl.dataset.hand);

    if (selectedHand === hand) {
      clearDragState();
      render();
      return;
    }

    selectedHand = hand;
    render();

    if (moveFocus) {
      keyboardMode = true;
      ui.focusFirstTargetHand();
    }

    return;
  }

  if (person === "opponent" && selectedHand !== null) {
    const issue = hitIssue(selectedHand, Number(handEl.dataset.hand));

    if (issue === "none") {
      hitOpponent(handEl);
    } else if (!isGameOver() && userTurnActive) {
      showIllegalMove(issue);
    }
  }
}

function finishUserTurn() {
  userTurnActive = false;
  clearDragState();

  if (!hasLiveHands(state, "opponent")) {
    finishGame("user-win");
    return;
  }

  recordPosition("bot");
  render();
  window.setTimeout(botTurn, 250);
}

async function botTurn() {
  const next = await botController.nextMove();

  if (next === null) {
    finishGame("draw");
    return;
  }

  if (next !== undefined) {
    const previous = currentState();
    applyPackedHands(state, next);
    state.user = preserveVisiblePairOrder(previous.user, state.user);
    state.opponent = preserveVisiblePairOrder(
      previous.opponent,
      state.opponent,
    );
    recordPosition("user");
  }

  if (!hasLiveHands(state, "user")) {
    finishGame("bot-win");
    return;
  } else if (!hasLegalUserMove(state, wouldRepeat)) {
    finishGame("draw");
    return;
  } else {
    userTurnActive = true;
  }
  render();
  if (keyboardMode && userTurnActive) {
    ui.focusFirstPlayableUserHand();
  }
}

function hitOpponent(targetEl) {
  if (!canDrop(targetEl)) {
    if (!isGameOver() && userTurnActive && selectedHand !== null) {
      showIllegalMove(hitIssue(selectedHand, Number(targetEl.dataset.hand)));
    }
    return;
  }

  const target = Number(targetEl.dataset.hand);
  state.opponent[target] =
    (state.opponent[target] + state.user[selectedHand]) % MODULUS;
  finishUserTurn();
}

function toggleRearrange() {
  clearDragState();

  if (
    choosingStart ||
    startChoiceClosing ||
    isGameOver() ||
    (!userTurnActive && !rearranging)
  ) {
    return;
  }

  if (!rearranging) {
    rearrangeStart = [...state.user];
    rearrangeTotal = state.user[0] + state.user[1];
    rearranging = true;
    render();
    ui.focusFirstUserHand();
    return;
  }

  const issue = rearrangeIssue();

  if (issue === "unchanged") {
    showIllegalMove(issue);
    render();
    return;
  }

  if (issue === "would-repeat") {
    showIllegalMove(issue);
    return;
  }

  rearranging = false;
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
  selectedHand = null;
  rearranging = false;
  rearrangeTotal = 0;
  rearrangeStart = [1, 1];
  userTurnActive = false;
  gameOver = null;
  keyboardMode = false;
  choosingStart = true;
  startChoiceClosing = false;
  repetitionCounts.clear();
  botController.clearCache();
  ui.clearToast();
  clearDragState();
  render();
  beginStartChoice();
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
  ui.placeCaretAtEnd(handEl);
}

ui.rearrangeButton.addEventListener("click", toggleRearrange);
ui.cancelButton.addEventListener("click", cancelRearrange);
ui.startFirstButton.addEventListener("click", () => startGame(true));
ui.startSecondButton.addEventListener("click", () => startGame(false));
ui.turnIndicator.addEventListener("click", () => {
  if (isGameOver()) {
    resetGame();
  }
});
ui.rulesButton.addEventListener("click", ui.openRules);
ui.rulesCloseButton.addEventListener("click", ui.closeRules);
ui.rulesDialog.addEventListener("click", (event) => {
  if (event.target === ui.rulesDialog) {
    ui.closeRules();
  }
});

for (const handEl of ui.hands) {
  handEl.addEventListener("dragstart", (event) => {
    if (!canDrag(handEl)) {
      event.preventDefault();
      return;
    }

    selectedHand = Number(handEl.dataset.hand);
    ui.markDragSource(handEl);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(selectedHand));
  });

  handEl.addEventListener("dragend", () => {
    clearDragState();
    render();
  });

  handEl.addEventListener("dragenter", () => {
    if (canDrop(handEl)) {
      ui.markDropTarget(handEl);
      return;
    }

    if (
      !isGameOver() &&
      userTurnActive &&
      selectedHand !== null &&
      handEl.dataset.person === "opponent" &&
      hitIssue(selectedHand, Number(handEl.dataset.hand)) === "would-repeat"
    ) {
      showIllegalMove(hitIssue(selectedHand, Number(handEl.dataset.hand)));
    }
  });

  handEl.addEventListener("dragleave", () => {
    ui.unmarkDropTarget(handEl);
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
    activateHand(handEl);
  });

  handEl.addEventListener("input", () => updateSplitFromEdit(handEl));

  handEl.addEventListener("focus", () => {
    if (rearranging && handEl.dataset.person === "user") {
      ui.placeCaretAtEnd(handEl);
    }
  });

  handEl.addEventListener("keydown", (event) => {
    if (!rearranging || handEl.dataset.person !== "user") {
      if (ACTIVATION_KEYS.has(event.key)) {
        event.preventDefault();
        keyboardMode = true;
        activateHand(handEl, { moveFocus: true });
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        keyboardMode = true;
        ui.focusAdjacentHand(handEl, event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key === "Escape" && selectedHand !== null) {
        event.preventDefault();
        exitKeyboardMode();
      }
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
      ui.placeCaretAtEnd(handEl);
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
  if (ui.isRulesOpen()) {
    return;
  }

  if (choosingStart || startChoiceClosing) {
    return;
  }

  if (event.key === "Tab" && !rearranging) {
    keyboardMode = true;
  }

  const activeHandFocused = document.activeElement?.classList.contains("hand");

  if (
    (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
    !rearranging &&
    !activeHandFocused &&
    !isGameOver() &&
    userTurnActive
  ) {
    event.preventDefault();
    keyboardMode = true;
    render();
    if (event.key === "ArrowLeft") {
      ui.focusFirstPlayableUserHand();
    } else {
      ui.focusLastPlayableUserHand();
    }
    return;
  }

  if (
    event.key === "Escape" &&
    !rearranging &&
    (selectedHand !== null || activeHandFocused)
  ) {
    event.preventDefault();
    exitKeyboardMode();
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

render();
beginStartChoice();
