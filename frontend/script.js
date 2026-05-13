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
let gameDraw = false;

const hands = Array.from(document.querySelectorAll(".hand"));
const rearrangeButton = document.querySelector(".rearrange");
const cancelButton = document.querySelector(".rearrange-cancel");
const actions = document.querySelector(".rearrange-actions");
const botWasmPromise = loadBotWasm();
const prebuiltBotMoveCache = new Map(window.chopsticksPrebuiltBotCache ?? []);
const botMoveCache = new Map();
const botCacheLimit = Math.max(BOT_CACHE_LIMIT, prebuiltBotMoveCache.size);
const repetitionCounts = new Map();

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

    const wasmUrl = new URL("../target/wasm32-unknown-unknown/release/chopsticks.wasm", window.location.href);

    try {
        const response = await fetch(wasmUrl);
        const bytes = await response.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(bytes);
        return instance.exports;
    } catch (error) {
        console.error("Could not load Chopsticks WASM bot. Run `scripts/build-static-wasm.sh`.", error);
        return null;
    }
}

function handValue(person, hand) {
    return state[person][hand];
}

function canDrag(handEl) {
    return (
        !gameDraw &&
        userTurnActive &&
        !rearranging &&
        handEl.dataset.person === "user" &&
        handValue("user", Number(handEl.dataset.hand)) > 0
    );
}

function canDrop(targetEl) {
    return (
        !gameDraw &&
        userTurnActive &&
        draggedHand !== null &&
        targetEl.dataset.person === "opponent" &&
        handValue("opponent", Number(targetEl.dataset.hand)) > 0 &&
        legalHitState(targetEl) !== null
    );
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
        const inactiveUserHand = person === "user" && (!userTurnActive || gameDraw);

        handEl.textContent = value;
        handEl.draggable = !gameDraw && !editable && userTurnActive && person === "user" && value > 0;
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
        ? !isValidRearrange()
        : !userTurnActive || gameDraw;
    cancelButton.disabled = !rearranging;
    actions.classList.toggle("editing", rearranging);
    actions.classList.toggle("inactive", (!userTurnActive || gameDraw) && !rearranging);
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
    return (repetitionCounts.get(repetitionKey(turn, candidate)) ?? 0) >= REPETITION_LIMIT - 1;
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
    recordPosition("bot");
    clearDragState();
    render();

    if (hasLiveHands("opponent")) {
        window.setTimeout(botTurn, 250);
    }
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
                !wouldRepeat("bot", { user: after, opponent: canonicalPair(state.opponent) })
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
            gameDraw = true;
            render();
            return;
        }
        applyPackedHands(next);
        recordPosition("user");
    } else {
        console.warn("Chopsticks WASM bot is unavailable; returning control to the player.");
    }

    userTurnActive = hasLiveHands("user") && hasLegalUserMove();
    gameDraw = !userTurnActive;
    render();
}

function legalHitState(targetEl) {
    const attacker = draggedHand;
    const target = Number(targetEl.dataset.hand);
    const amount = state.user[attacker];
    const before = state.opponent[target];
    const after = (before + amount) % MODULUS;
    const candidate = currentState();

    candidate.opponent[target] = after;
    candidate.opponent = canonicalPair(candidate.opponent);

    return wouldRepeat("bot", candidate) ? null : candidate;
}

function hitOpponent(targetEl) {
    const candidate = legalHitState(targetEl);
    if (!canDrop(targetEl) || candidate === null) {
        return;
    }

    state.opponent = candidate.opponent;
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

    if (gameDraw || (!userTurnActive && !rearranging)) {
        return;
    }

    if (!rearranging) {
        rearrangeStart = [...state.user];
        rearrangeTotal = state.user[0] + state.user[1];
        rearranging = true;
        render();
        return;
    }

    if (!isValidRearrange()) {
        render();
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

function isValidRearrange() {
    if (!rearranging) {
        return true;
    }

    const before = sortedPair(rearrangeStart);
    const after = sortedPair(state.user);

    if (before[0] === after[0] && before[1] === after[1]) {
        return false;
    }

    return !wouldRepeat("bot", {
        user: after,
        opponent: canonicalPair(state.opponent),
    });
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

        if (person === "opponent" && draggedHand !== null && canDrop(handEl)) {
            hitOpponent(handEl);
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

        const allowedControlKey = [
            "Backspace",
            "Delete",
            "ArrowLeft",
            "ArrowRight",
            "Tab",
        ].includes(event.key);

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

recordPosition("user");
render();
