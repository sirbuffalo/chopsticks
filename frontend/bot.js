import { chopsticksPrebuiltBotCache } from "./bot_cache.js";
import { packedToState, sortedPair } from "./rules.js";

const BOT_CACHE_LIMIT = 10;
const NO_BOT_MOVE = -1;

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

    if (
      prebuilt !== undefined &&
      !wouldRepeat("user", packedToState(prebuilt))
    ) {
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

  return {
    async nextMove() {
      const bot = await botWasmPromise;

      if (!bot?.chopsticks_bot_next_state) {
        console.warn(
          "Chopsticks WASM bot is unavailable; returning control to the player.",
        );
        return undefined;
      }

      return calculateBotMove(bot);
    },

    clearCache() {
      botMoveCache.clear();
    },
  };
}
