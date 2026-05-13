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

let draggedHand = null;
let rearranging = false;
let rearrangeTotal = 0;
let rearrangeStart = [1, 1];
let userTurnActive = true;
let gameOver = null;

const REPETITION_MESSAGE = "That position has already appeared twice.";

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
  ui.render({
    state,
    rearranging,
    userTurnActive,
    gameOver,
    issue: rearrangeIssue(),
  });
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

function clearDragState() {
  draggedHand = null;
  ui.clearDragState();
}

function finishUserTurn() {
  userTurnActive = false;
  clearDragState();

  if (!hasLiveHands(state, "opponent")) {
    gameOver = "user-win";
    render();
    return;
  }

  recordPosition("bot");
  render();
  window.setTimeout(botTurn, 250);
}

async function botTurn() {
  const next = await botController.nextMove();

  if (next === null) {
    gameOver = "draw";
    render();
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
    gameOver = "bot-win";
  } else if (!hasLegalUserMove(state, wouldRepeat)) {
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
  finishUserTurn();
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
    ui.focusFirstUserHand();
    return;
  }

  const issue = rearrangeIssue();

  if (issue === "unchanged") {
    render();
    return;
  }

  if (issue === "would-repeat") {
    ui.showToast(REPETITION_MESSAGE);
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
  draggedHand = null;
  rearranging = false;
  rearrangeTotal = 0;
  rearrangeStart = [1, 1];
  userTurnActive = true;
  gameOver = null;
  repetitionCounts.clear();
  botController.clearCache();
  ui.clearToast();
  clearDragState();
  recordPosition("user");
  render();
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
ui.playAgainButton.addEventListener("click", resetGame);

for (const handEl of ui.hands) {
  handEl.addEventListener("dragstart", (event) => {
    if (!canDrag(handEl)) {
      event.preventDefault();
      return;
    }

    draggedHand = Number(handEl.dataset.hand);
    ui.markDragSource(handEl);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(draggedHand));
  });

  handEl.addEventListener("dragend", clearDragState);

  handEl.addEventListener("dragenter", () => {
    if (canDrop(handEl)) {
      ui.markDropTarget(handEl);
      return;
    }

    if (
      !isGameOver() &&
      userTurnActive &&
      draggedHand !== null &&
      handEl.dataset.person === "opponent" &&
      hitIssue(draggedHand, Number(handEl.dataset.hand)) === "would-repeat"
    ) {
      ui.showToast(REPETITION_MESSAGE);
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
      ui.markDragSource(handEl);
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
        ui.showToast(REPETITION_MESSAGE);
      }
    }
  });

  handEl.addEventListener("input", () => updateSplitFromEdit(handEl));

  handEl.addEventListener("focus", () => {
    if (rearranging && handEl.dataset.person === "user") {
      ui.placeCaretAtEnd(handEl);
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
  if (event.key === "r" && !rearranging && !ui.rearrangeButton.disabled) {
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
