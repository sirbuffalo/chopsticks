import { readFileSync, writeFileSync } from "node:fs";

const MAX_DEPTH = Number(process.env.MAX_CACHE_DEPTH ?? 12);
const RESET_CACHE = process.env.RESET_CACHE === "1";
const NO_BOT_MOVE = -1;
const PROGRESS_INTERVAL_MS = Number(
  process.env.CACHE_PROGRESS_INTERVAL_MS ?? 2_000,
);
const startedAt = performance.now();
const outputPath = new URL("../frontend/bot_cache.js", import.meta.url);
const cachePath = new URL("../frontend/bot_cache.json", import.meta.url);
const wasmPath = new URL("../frontend/chopsticks.wasm", import.meta.url);
const wasmBytes = readFileSync(wasmPath);

const { instance } = await WebAssembly.instantiate(wasmBytes);
const bot = instance.exports;
const cache = new Map(
  (RESET_CACHE ? [] : loadExistingCache()).map(([stateKey, value]) => [
    stateKey,
    normalizePackedList(value),
  ]),
);
const startingCacheSize = cache.size;
const expanded = new Map();
let computedEntries = 0;
let lastProgressAt = 0;

console.log(
  `${RESET_CACHE ? "Rebuilding" : "Expanding"} cache from ${startingCacheSize} entries through depth ${MAX_DEPTH}...`,
);

function elapsedSeconds() {
  return ((performance.now() - startedAt) / 1000).toFixed(1);
}

function logProgress(message, { force = false } = {}) {
  const now = performance.now();
  if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) {
    return;
  }

  lastProgressAt = now;
  console.log(
    `[${elapsedSeconds()}s] ${message}; visited ${expanded.size} states, ` +
      `${cache.size} cache entries (${computedEntries} computed this run)`,
  );
}

function loadExistingCache() {
  try {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function normalizePackedList(value) {
  if (value === undefined) {
    return [];
  }

  return [
    ...new Set(
      (Array.isArray(value) ? value : [value]).filter(
        (packed) => packed !== NO_BOT_MOVE,
      ),
    ),
  ];
}

function sortedPair(left, right) {
  return [left, right].sort((a, b) => a - b);
}

function key(state) {
  return `${state.user[0]},${state.user[1]}:${state.opponent[0]},${state.opponent[1]}`;
}

function repetitionKey(turn, state) {
  return `${turn}:${key(state)}`;
}

function packedToState(packed) {
  return {
    user: sortedPair(packed & 0xf, (packed >> 4) & 0xf),
    opponent: sortedPair((packed >> 8) & 0xf, (packed >> 12) & 0xf),
  };
}

function liveHands(hands) {
  return hands.some((value) => value > 0);
}

function cloneCounts(counts) {
  return new Map(counts);
}

function recordPosition(counts, turn, state) {
  const stateKey = repetitionKey(turn, state);
  counts.set(stateKey, (counts.get(stateKey) ?? 0) + 1);
}

function wouldRepeat(counts, turn, state) {
  return (counts.get(repetitionKey(turn, state)) ?? 0) >= 2;
}

function currentSearchDepth(state) {
  const liveHands =
    state.user.filter((value) => value > 0).length +
    state.opponent.filter((value) => value > 0).length;
  const totalFingers =
    state.user[0] + state.user[1] + state.opponent[0] + state.opponent[1];

  if (liveHands <= 3 || totalFingers <= 5) {
    return 20;
  }

  return 20;
}

function userMoves(state) {
  const moves = [];

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

      const opponent = [...state.opponent];
      opponent[target] = (before + amount) % 5;
      moves.push({
        user: [...state.user],
        opponent: sortedPair(opponent[0], opponent[1]),
      });
    }
  }

  const total = state.user[0] + state.user[1];
  for (let left = 0; left < 5; left += 1) {
    for (let right = left; right < 5; right += 1) {
      if (left + right !== total) {
        continue;
      }

      const nextUser = [left, right];
      const same =
        nextUser[0] === state.user[0] && nextUser[1] === state.user[1];
      const swapped =
        nextUser[0] === state.user[1] && nextUser[1] === state.user[0];

      if (!same && !swapped) {
        moves.push({ user: nextUser, opponent: [...state.opponent] });
      }
    }
  }

  return dedupe(moves);
}

function dedupe(states) {
  const deduped = [];
  const keys = new Set();

  for (const state of states) {
    const stateKey = key(state);
    if (!keys.has(stateKey)) {
      keys.add(stateKey);
      deduped.push(state);
    }
  }

  return deduped;
}

function candidateRawScore(state, packed, searchDepth) {
  const nextState = packedToState(packed);

  if (!bot.chopsticks_depth_limited_score) {
    return Number.NEGATIVE_INFINITY;
  }

  return -bot.chopsticks_depth_limited_score(
    0,
    nextState.user[0],
    nextState.user[1],
    nextState.opponent[0],
    nextState.opponent[1],
    Math.max(0, searchDepth - 1),
  );
}

function computeBotReplies(state) {
  const searchDepth = currentSearchDepth(state);

  if (bot.chopsticks_bot_depth_limited_ranked_next_state) {
    const ranked = [];

    for (let rank = 0; rank < 32; rank += 1) {
      const packed = bot.chopsticks_bot_depth_limited_ranked_next_state(
        state.user[0],
        state.user[1],
        state.opponent[0],
        state.opponent[1],
        searchDepth,
        rank,
      );

      if (packed === NO_BOT_MOVE) {
        break;
      }

      ranked.push(packed);
    }

    if (ranked.length > 0) {
      const topScore = candidateRawScore(state, ranked[0], searchDepth);
      return ranked.filter(
        (packed) => candidateRawScore(state, packed, searchDepth) === topScore,
      );
    }
  }

  if (bot.chopsticks_bot_depth_limited_random_tied_next_state) {
    const packed = bot.chopsticks_bot_depth_limited_random_tied_next_state(
      state.user[0],
      state.user[1],
      state.opponent[0],
      state.opponent[1],
      searchDepth,
      0,
    );

    if (packed !== NO_BOT_MOVE) {
      return [packed];
    }
  }

  const packed = bot.chopsticks_bot_next_state(
    state.user[0],
    state.user[1],
    state.opponent[0],
    state.opponent[1],
  );
  return packed === NO_BOT_MOVE ? [] : [packed];
}

function botReplies(state) {
  const stateKey = key(state);

  if (!cache.has(stateKey)) {
    logProgress(`computing bot reply for ${stateKey}`, {
      force: computedEntries === 0,
    });
    cache.set(stateKey, computeBotReplies(state));
    computedEntries += 1;
  }

  return normalizePackedList(cache.get(stateKey)).map((packed) =>
    packedToState(packed),
  );
}

function explorePlayerTurn(state, depth, repetitionCounts) {
  logProgress(`exploring depth ${depth}`);

  if (
    depth >= MAX_DEPTH ||
    !liveHands(state.user) ||
    !liveHands(state.opponent)
  ) {
    return;
  }

  const stateKey = key(state);
  const remainingDepth = MAX_DEPTH - depth;
  const previousRemainingDepth = expanded.get(stateKey);

  if (
    previousRemainingDepth !== undefined &&
    previousRemainingDepth >= remainingDepth
  ) {
    return;
  }
  expanded.set(stateKey, remainingDepth);

  for (const afterUserMove of userMoves(state)) {
    if (!liveHands(afterUserMove.opponent)) {
      continue;
    }

    if (wouldRepeat(repetitionCounts, "bot", afterUserMove)) {
      continue;
    }

    const afterUserCounts = cloneCounts(repetitionCounts);
    recordPosition(afterUserCounts, "bot", afterUserMove);

    for (const afterBotMove of botReplies(afterUserMove)) {
      if (wouldRepeat(afterUserCounts, "user", afterBotMove)) {
        continue;
      }

      const afterBotCounts = cloneCounts(afterUserCounts);
      recordPosition(afterBotCounts, "user", afterBotMove);
      explorePlayerTurn(afterBotMove, depth + 2, afterBotCounts);
    }
  }
}

const initialState = { user: [1, 1], opponent: [1, 1] };
const userFirstCounts = new Map();
recordPosition(userFirstCounts, "user", initialState);

logProgress("seeding cache from user-first opening", { force: true });
explorePlayerTurn(initialState, 0, userFirstCounts);

const botFirstCounts = new Map();
recordPosition(botFirstCounts, "bot", initialState);
const afterBotOpenings = botReplies(initialState);

logProgress("seeding cache from bot-first opening", { force: true });
for (const afterBotOpening of afterBotOpenings) {
  const counts = cloneCounts(botFirstCounts);
  recordPosition(counts, "user", afterBotOpening);
  explorePlayerTurn(afterBotOpening, 1, counts);
}

const entries = [...cache.entries()].sort(([left], [right]) =>
  left.localeCompare(right),
);
const entriesJson = JSON.stringify(entries);
const source = `// Generated by scripts/prebuild-cache.mjs. Do not edit by hand.\nexport const chopsticksPrebuiltBotCacheDepth = ${MAX_DEPTH};\n// prettier-ignore\nexport const chopsticksPrebuiltBotCache = ${entriesJson};\n`;

writeFileSync(outputPath, source);
writeFileSync(cachePath, entriesJson);
const reused = cache.size - computedEntries;
const action = RESET_CACHE ? "Rebuilt" : "Expanded";
console.log(
  `${action} cache from ${startingCacheSize} to ${entries.length} entries through depth ${MAX_DEPTH} ` +
    `(${reused} reused, ${computedEntries} computed) at ${outputPath.pathname} in ${elapsedSeconds()}s`,
);
