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

  function clearDragState() {
    document.body.classList.remove("dragging");
    for (const handEl of hands) {
      handEl.classList.remove("drag-source", "drop-target");
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

  function render({ state, rearranging, userTurnActive, gameOver, issue }) {
    const gameIsOver = gameOver !== null;

    for (const handEl of hands) {
      const person = handEl.dataset.person;
      const hand = Number(handEl.dataset.hand);
      const value = state[person][hand];
      const editable = rearranging && person === "user";
      const inactiveUserHand =
        person === "user" && (!userTurnActive || gameIsOver);

      handEl.textContent = value;
      handEl.draggable =
        !gameIsOver &&
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
    } else {
      bannerWrapper.hidden = true;
    }
  }

  return {
    hands,
    rearrangeButton,
    cancelButton,
    playAgainButton,
    clearDragState,
    clearToast,
    focusFirstUserHand,
    markDragSource,
    markDropTarget,
    placeCaretAtEnd,
    render,
    showToast,
    unmarkDropTarget,
  };
}
