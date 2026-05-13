const BANNER_TITLES = {
  "user-win": "You win!",
  "bot-win": "You lose.",
  draw: "Draw.",
};

export function createUi() {
  const hands = Array.from(document.querySelectorAll(".hand"));
  const rearrangeButton = document.querySelector(".rearrange");
  const cancelButton = document.querySelector(".rearrange-cancel");
  const actions = document.querySelector(".rearrange-actions");
  const bannerWrapper = document.querySelector(".banner-wrapper");
  const bannerTitle = document.querySelector(".banner-title");
  const playAgainButton = document.querySelector(".play-again");
  const toastEl = document.querySelector(".toast");
  const rulesButton = document.querySelector(".rules-open");
  const rulesDialog = document.querySelector(".rules-dialog");
  const rulesCloseButton = document.querySelector(".rules-close");
  let toastTimer = null;

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

  function clearToast() {
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastEl.classList.remove("visible");
  }

  function openRules() {
    clearToast();
    if (rulesDialog.open) {
      return;
    }

    rulesDialog.showModal();
  }

  function closeRules() {
    if (rulesDialog.open) {
      rulesDialog.close();
    }
  }

  function isRulesOpen() {
    return rulesDialog.open;
  }

  function clearDragState() {
    document.body.classList.remove("dragging");
    for (const handEl of hands) {
      handEl.classList.remove("drag-source", "drop-target");
    }
  }

  function blurActiveHand() {
    if (document.activeElement?.classList.contains("hand")) {
      document.activeElement.blur();
    }
  }

  function markDragSource(handEl) {
    handEl.classList.add("drag-source");
    document.body.classList.add("dragging");
  }

  function markDropTarget(handEl) {
    handEl.classList.add("drop-target");
  }

  function unmarkDropTarget(handEl) {
    handEl.classList.remove("drop-target");
  }

  function focusFirstUserHand() {
    hands
      .find((h) => h.dataset.person === "user" && h.dataset.hand === "0")
      ?.focus();
  }

  function focusFirstTargetHand() {
    hands
      .find((h) => h.dataset.person === "opponent" && h.tabIndex === 0)
      ?.focus();
  }

  function focusFirstPlayableUserHand() {
    hands.find((h) => h.dataset.person === "user" && h.tabIndex === 0)?.focus();
  }

  function focusLastPlayableUserHand() {
    hands
      .findLast((h) => h.dataset.person === "user" && h.tabIndex === 0)
      ?.focus();
  }

  function focusAdjacentHand(handEl, direction) {
    const rowHands = hands.filter(
      (h) => h.dataset.person === handEl.dataset.person && h.tabIndex === 0,
    );

    if (rowHands.length < 2) {
      return;
    }

    const currentIndex = rowHands.indexOf(handEl);
    const nextIndex =
      (currentIndex + direction + rowHands.length) % rowHands.length;

    rowHands[nextIndex].focus();
  }

  function placeCaretAtEnd(element) {
    const range = document.createRange();
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function render({
    state,
    rearranging,
    userTurnActive,
    gameOver,
    issue,
    selectedHand,
  }) {
    const gameIsOver = gameOver !== null;
    const canAct = !gameIsOver && userTurnActive && !rearranging;
    const hasSelectedHand = selectedHand !== null;

    for (const handEl of hands) {
      const person = handEl.dataset.person;
      const hand = Number(handEl.dataset.hand);
      const value = state[person][hand];
      const editable = rearranging && person === "user";
      const inactiveUserHand =
        person === "user" && (!userTurnActive || gameIsOver);
      const userHandCanAttack = canAct && person === "user" && value > 0;
      const targetCanBeChosen =
        canAct && hasSelectedHand && person === "opponent" && value > 0;

      handEl.textContent = value;
      handEl.draggable = userHandCanAttack;
      handEl.contentEditable = editable ? "true" : "false";
      handEl.spellcheck = false;
      handEl.tabIndex =
        editable || userHandCanAttack || targetCanBeChosen ? 0 : -1;
      handEl.classList.toggle("dead", value === 0);
      handEl.classList.toggle("draggable", handEl.draggable);
      handEl.classList.toggle("editing", editable);
      handEl.classList.toggle("inactive", inactiveUserHand);
      handEl.classList.toggle(
        "drag-source",
        userHandCanAttack && hand === selectedHand,
      );
      handEl.setAttribute("aria-label", `${person} hand ${hand + 1}: ${value}`);
    }

    document.body.classList.toggle("dragging", canAct && hasSelectedHand);
    if (
      document.activeElement?.classList.contains("hand") &&
      document.activeElement.tabIndex < 0
    ) {
      document.activeElement.blur();
    }

    rearrangeButton.textContent = rearranging ? "Confirm" : "Rearrange";
    rearrangeButton.disabled = rearranging
      ? issue === "unchanged"
      : !userTurnActive || gameIsOver;
    cancelButton.disabled = !rearranging;
    actions.classList.toggle("editing", rearranging);
    actions.classList.toggle(
      "inactive",
      (!userTurnActive || gameIsOver) && !rearranging,
    );

    if (gameIsOver) {
      bannerTitle.textContent = BANNER_TITLES[gameOver];
      bannerWrapper.hidden = false;
      playAgainButton.focus();
    } else {
      bannerWrapper.hidden = true;
    }
  }

  return {
    hands,
    rearrangeButton,
    cancelButton,
    playAgainButton,
    rulesButton,
    rulesCloseButton,
    rulesDialog,
    blurActiveHand,
    clearDragState,
    clearToast,
    closeRules,
    focusAdjacentHand,
    focusFirstPlayableUserHand,
    focusFirstTargetHand,
    focusFirstUserHand,
    focusLastPlayableUserHand,
    isRulesOpen,
    markDragSource,
    markDropTarget,
    openRules,
    placeCaretAtEnd,
    render,
    showToast,
    unmarkDropTarget,
  };
}
