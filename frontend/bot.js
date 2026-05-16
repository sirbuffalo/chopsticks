import { chopsticksPrebuiltBotCache } from "./bot_cache.js";
import { packedToState, sortedPair } from "./rules.js";

const BOT_CACHE_LIMIT = 100;
const NO_BOT_MOVE = -1;
const DEFAULT_SEARCH_DEPTH = 50;
const ENDGAME_SEARCH_DEPTH = 50;

async function loadBotWasm() {
  const wasmUrl = new URL("chopsticks.wasm", window.location.href);

  async function instantiateFromBytes() {
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`WASM request failed with status ${response.status}`);
    }

    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes);
    return instance.exports;
  }

  try {
    if (WebAssembly.instantiateStreaming) {
      try {
        const { instance } = await WebAssembly.instantiateStreaming(
          fetch(wasmUrl),
        );
        return instance.exports;
      } catch (error) {
        console.warn(
          "Streaming WASM instantiation failed; falling back to ArrayBuffer.",
          error,
        );
      }
    }

    return await instantiateFromBytes();
  } catch (error) {
    console.error(
      "Could not load Chopsticks WASM bot. Run `scripts/build-static-wasm.sh`.",
      error,
    );
    return null;
  }
}

export function createBotController({ state, repetitionCounts, wouldRepeat }) {
  const botWasmPromise = loadBotWasm();
  const prebuiltBotMoveCache = new Map(chopsticksPrebuiltBotCache ?? []);
  const botMoveCache = new Map();
  const botCacheLimit = Math.max(BOT_CACHE_LIMIT, prebuiltBotMoveCache.size);

  function botCacheKey() {
    const user = sortedPair(state.user);
    const opponent = sortedPair(state.opponent);

    return `${user[0]},${user[1]}:${opponent[0]},${opponent[1]}`;
  }

  function historyFingerprint(counts = repetitionCounts) {
    return [...counts.entries()]
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

  function randomSeed() {
    return Math.floor(Math.random() * 0x1_0000_0000);
  }

  function currentSearchDepth() {
    const liveHands =
      state.user.filter((value) => value > 0).length +
      state.opponent.filter((value) => value > 0).length;
    const totalFingers =
      state.user[0] + state.user[1] + state.opponent[0] + state.opponent[1];

    if (liveHands <= 3 || totalFingers <= 5) {
      return ENDGAME_SEARCH_DEPTH;
    }

    return DEFAULT_SEARCH_DEPTH;
  }

  function candidateScore(bot, packed, searchDepth) {
    const nextState = packedToState(packed);

    if (wouldRepeat("user", nextState)) {
      return 0;
    }

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

  function pickRandom(values) {
    return values[Math.floor(Math.random() * values.length)];
  }

  function prebuiltCandidates(entry) {
    if (entry === undefined) {
      return [];
    }

    return Array.isArray(entry) ? entry : [entry];
  }

  function exactOutcomeScore(bot, packed) {
    const nextState = packedToState(packed);

    if (bot.chopsticks_outcome) {
      return -bot.chopsticks_outcome(
        0,
        nextState.user[0],
        nextState.user[1],
        nextState.opponent[0],
        nextState.opponent[1],
      );
    }

    if (bot.chopsticks_bot_outcome) {
      return -bot.chopsticks_bot_outcome(
        nextState.user[0],
        nextState.user[1],
        nextState.opponent[0],
        nextState.opponent[1],
      );
    }

    return null;
  }

  function gatherExactRankedCandidates(bot) {
    if (
      !bot.chopsticks_bot_ranked_next_state ||
      (!bot.chopsticks_outcome && !bot.chopsticks_bot_outcome)
    ) {
      return [];
    }

    const ranked = [];

    for (let rank = 0; rank < 32; rank += 1) {
      const next = bot.chopsticks_bot_ranked_next_state(
        state.user[0],
        state.user[1],
        state.opponent[0],
        state.opponent[1],
        rank,
      );

      if (next === NO_BOT_MOVE) {
        break;
      }

      ranked.push(next);
    }

    return ranked;
  }

  function calculateBotMove(bot) {
    const historyKey = botHistoryCacheKey();
    const cached = botMoveCache.get(historyKey);

    if (cached !== undefined) {
      return cached;
    }

    const stateKey = botCacheKey();
    const prebuilt = prebuiltCandidates(prebuiltBotMoveCache.get(stateKey));
    const searchDepth = currentSearchDepth();
    const prebuiltAllowed = prebuilt.filter(
      (packed) =>
        packed !== NO_BOT_MOVE && !wouldRepeat("user", packedToState(packed)),
    );

    const exactRanked = gatherExactRankedCandidates(bot).filter(
      (packed) =>
        packed !== NO_BOT_MOVE && !wouldRepeat("user", packedToState(packed)),
    );
    const exactCandidates = [...new Set([...prebuiltAllowed, ...exactRanked])];

    if (exactCandidates.length > 0) {
      let bestExactScore = Number.NEGATIVE_INFINITY;
      let bestExactCandidates = [];

      for (const packed of exactCandidates) {
        const score = exactOutcomeScore(bot, packed);
        if (score === null) {
          continue;
        }

        if (score > bestExactScore) {
          bestExactScore = score;
          bestExactCandidates = [packed];
        } else if (score === bestExactScore) {
          bestExactCandidates.push(packed);
        }
      }

      if (bestExactCandidates.length > 0) {
        const choice = pickRandom(bestExactCandidates);
        cacheBotMove(historyKey, choice);
        return choice;
      }
    }

    if (prebuiltAllowed.length > 0) {
      const choice = pickRandom(prebuiltAllowed);
      cacheBotMove(historyKey, choice);
      return choice;
    }

    const best =
      bot.chopsticks_bot_depth_limited_random_tied_next_state?.(
        state.user[0],
        state.user[1],
        state.opponent[0],
        state.opponent[1],
        searchDepth,
        randomSeed(),
      ) ??
      bot.chopsticks_bot_depth_limited_next_state?.(
        state.user[0],
        state.user[1],
        state.opponent[0],
        state.opponent[1],
        searchDepth,
      ) ??
      bot.chopsticks_bot_next_state(
        state.user[0],
        state.user[1],
        state.opponent[0],
        state.opponent[1],
      );

    const bestAllowed =
      best !== undefined &&
      best !== null &&
      best !== NO_BOT_MOVE &&
      !wouldRepeat("user", packedToState(best));

    if (bestAllowed) {
      cacheBotMove(historyKey, best);
      return best;
    }

    const seenPacked = new Set();
    let bestPacked = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let tiedBestPacked = [];

    function consider(packed) {
      if (packed === undefined || packed === null || packed === NO_BOT_MOVE) {
        return false;
      }
      if (seenPacked.has(packed)) {
        return true;
      }

      seenPacked.add(packed);
      const score = candidateScore(bot, packed, searchDepth);

      if (bestPacked === null || score > bestScore) {
        bestScore = score;
        bestPacked = packed;
        tiedBestPacked = [packed];
      } else if (score === bestScore) {
        tiedBestPacked.push(packed);
      }

      return true;
    }

    for (const packed of prebuilt) {
      consider(packed);
    }
    consider(best);

    if (bot.chopsticks_bot_depth_limited_ranked_next_state) {
      for (let rank = 0; rank < 32; rank += 1) {
        const next = bot.chopsticks_bot_depth_limited_ranked_next_state(
          state.user[0],
          state.user[1],
          state.opponent[0],
          state.opponent[1],
          searchDepth,
          rank,
        );

        if (next === NO_BOT_MOVE) {
          break;
        }

        consider(next);
      }
    } else if (bot.chopsticks_bot_ranked_next_state) {
      for (let rank = 0; rank < 32; rank += 1) {
        const next = bot.chopsticks_bot_ranked_next_state(
          state.user[0],
          state.user[1],
          state.opponent[0],
          state.opponent[1],
          rank,
        );

        if (next === NO_BOT_MOVE) {
          break;
        }

        consider(next);
      }
    }

    if (bestPacked !== null) {
      const choice = pickRandom(tiedBestPacked);
      cacheBotMove(historyKey, choice);
      return choice;
    }

    return bestPacked;
  }

  return {
    async nextMove() {
      const bot = await botWasmPromise;

      if (!bot?.chopsticks_bot_next_state) {
        console.warn(
          "Chopsticks WASM bot is unavailable; returning control to the player.",
        );
        return undefined;
      }

      const next = calculateBotMove(bot);
      if (next === null || next === undefined) {
        return null;
      }

      return next;
    },
    clearCache() {
      botMoveCache.clear();
    },
  };
}
