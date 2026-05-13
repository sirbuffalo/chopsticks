export function createUi() {
  const { Toastify } = window;
  const game = document.querySelector(".game");
  const hands = Array.from(document.querySelectorAll(".hand"));
  const rearrangeButton = document.querySelector(".rearrange");
  const cancelButton = document.querySelector(".rearrange-cancel");
  const actions = document.querySelector(".rearrange-actions");
  const turnIndicator = document.querySelector(".turn-indicator");
  const startOverlay = document.querySelector(".start-overlay");
  const startFirstButton = document.querySelector(".start-first");
  const startSecondButton = document.querySelector(".start-second");
  const rulesButton = document.querySelector(".rules-open");
  const rulesDialog = document.querySelector(".rules-dialog");
  const rulesCloseButton = document.querySelector(".rules-close");
  let activeToast = null;

  function showToast(message, options = {}) {
    if (activeToast !== null) {
      activeToast.hideToast();
    }

    const toast = Toastify({
      text: message,
      duration: options.duration ?? 2500,
      gravity: "bottom",
      position: "center",
      className: ["game-toast", options.className].filter(Boolean).join(" "),
      node: options.node,
      stopOnFocus: false,
      onClick: Object.hasOwn(options, "onClick") ? options.onClick : clearToast,
      callback() {
        if (activeToast === toast) {
          activeToast = null;
        }
      },
    });
    activeToast = toast;
    activeToast.showToast();
  }

  function clearToast() {
    if (activeToast !== null) {
      activeToast.hideToast();
      activeToast = null;
    }
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

  function blurStartChoice() {
    if (
      document.activeElement === startFirstButton ||
      document.activeElement === startSecondButton
    ) {
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

  function focusPlayAgainPrompt() {
    turnIndicator.focus();
  }

  function focusStartChoice(userGoesFirst) {
    (userGoesFirst ? startFirstButton : startSecondButton).focus();
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
    legalTargets,
    turnText,
    choosingStart,
    startChoiceClosing,
  }) {
    const gameIsOver = gameOver !== null;
    const canAct = !gameIsOver && userTurnActive && !rearranging;
    const hasSelectedHand = selectedHand !== null;

    for (const handEl of hands) {
      const person = handEl.dataset.person;
      const hand = Number(handEl.dataset.hand);
      const value = state[person][hand];
      const editable = rearranging && person === "user";
      const inactiveUserHand = person === "user" && gameIsOver;
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
      handEl.classList.toggle(
        "legal-target",
        person === "opponent" && legalTargets.has(hand),
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
    actions.classList.toggle("inactive", gameIsOver && !rearranging);
    turnIndicator.textContent = turnText;
    turnIndicator.hidden = turnText.length === 0;
    turnIndicator.classList.toggle("game-over", gameIsOver);
    turnIndicator.tabIndex = gameIsOver ? 0 : -1;
    if (gameIsOver) {
      turnIndicator.setAttribute("role", "button");
    } else {
      turnIndicator.removeAttribute("role");
    }
    turnIndicator.setAttribute(
      "aria-label",
      gameIsOver ? `${turnText}. Play again.` : turnText,
    );
    const startOverlayVisible = choosingStart || startChoiceClosing;
    startOverlay.hidden = !startOverlayVisible;
    startOverlay.classList.toggle("visible", startOverlayVisible);
    startOverlay.classList.toggle("closing", startChoiceClosing);
    game.classList.toggle("start-active", startOverlayVisible);

    return gameIsOver;
  }

  return {
    game,
    hands,
    rearrangeButton,
    cancelButton,
    turnIndicator,
    startFirstButton,
    startSecondButton,
    rulesButton,
    rulesCloseButton,
    rulesDialog,
    blurActiveHand,
    blurStartChoice,
    clearDragState,
    clearToast,
    closeRules,
    focusAdjacentHand,
    focusFirstPlayableUserHand,
    focusFirstTargetHand,
    focusFirstUserHand,
    focusLastPlayableUserHand,
    focusPlayAgainPrompt,
    focusStartChoice,
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
