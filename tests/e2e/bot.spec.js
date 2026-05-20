import { expect, test as base } from "@playwright/test";

const FONT_HOST_PATTERN = /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//;
const NO_BOT_MOVE = -1;
const BOT_MODULE_PATH = "/bot.js";
const RULES_MODULE_PATH = "/rules.js";

const test = base.extend({
  page: async ({ page }, use) => {
    const browserErrors = [];

    await page.route(FONT_HOST_PATTERN, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: route.request().url().includes("googleapis")
          ? "text/css"
          : "font/woff2",
        body: "",
      });
    });

    page.on("pageerror", (error) => {
      browserErrors.push(error.message);
    });

    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });

    await use(page);

    expect(browserErrors).toEqual([]);
  },
});

function pack(user, opponent) {
  return user[0] | (user[1] << 4) | (opponent[0] << 8) | (opponent[1] << 12);
}

function hand(page, person, index) {
  return page.locator(`.hand[data-person="${person}"][data-hand="${index}"]`);
}

async function expectHands(page, person, values) {
  await expect(hand(page, person, 0)).toHaveText(String(values[0]));
  await expect(hand(page, person, 1)).toHaveText(String(values[1]));
}

async function mockBotCache(page, entries) {
  await page.route("**/bot_cache.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `export const chopsticksPrebuiltBotCache = ${JSON.stringify(entries)};`,
    });
  });
}

async function installFakeBot(page, { nextStates, rankedByRank = {} }) {
  await page.route("**/chopsticks.wasm", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/wasm",
      body: "",
    });
  });

  await page.addInitScript(
    ({ nextStates, rankedByRank, noMove }) => {
      let nextIndex = 0;
      const fakeBot = {
        chopsticks_bot_next_state: (...args) => {
          const result =
            nextStates[Math.min(nextIndex, nextStates.length - 1)] ?? noMove;
          nextIndex += 1;
          globalThis.__botCalls.push({ fn: "next", args, result });
          return result;
        },
        chopsticks_bot_ranked_next_state: (...args) => {
          const rank = args[4];
          const result = Object.hasOwn(rankedByRank, String(rank))
            ? rankedByRank[String(rank)]
            : noMove;
          globalThis.__botCalls.push({ fn: "ranked", args, result });
          return result;
        },
        chopsticks_bot_depth_limited_ranked_next_state: (...args) => {
          const rank = args[5];
          const result = Object.hasOwn(rankedByRank, String(rank))
            ? rankedByRank[String(rank)]
            : noMove;
          globalThis.__botCalls.push({ fn: "depth-ranked", args, result });
          return result;
        },
        chopsticks_depth_limited_score: (...args) => {
          const packed =
            args[1] | (args[2] << 4) | (args[3] << 8) | (args[4] << 12);
          const result = globalThis.__botScores[String(packed)] ?? 0;
          globalThis.__botCalls.push({ fn: "score", args, result });
          return result;
        },
        chopsticks_outcome: (...args) => {
          const packed =
            args[1] | (args[2] << 4) | (args[3] << 8) | (args[4] << 12);
          const result = globalThis.__botExactScores[String(packed)] ?? 0;
          globalThis.__botCalls.push({ fn: "outcome", args, result });
          return result;
        },
      };

      globalThis.__botCalls = [];
      globalThis.__botScores = {};
      globalThis.__botExactScores = {};
      globalThis.WebAssembly.instantiateStreaming = async () => ({
        instance: { exports: fakeBot },
      });
      globalThis.WebAssembly.instantiate = async () => ({
        instance: { exports: fakeBot },
      });
    },
    { nextStates, rankedByRank, noMove: NO_BOT_MOVE },
  );
}

async function installBotScores(page, scoresByPacked) {
  await page.addInitScript(
    ({ scoresByPacked }) => {
      globalThis.__botScores = scoresByPacked;
    },
    { scoresByPacked },
  );
}

async function installBotExactScores(page, scoresByPacked) {
  await page.addInitScript(
    ({ scoresByPacked }) => {
      globalThis.__botExactScores = scoresByPacked;
    },
    { scoresByPacked },
  );
}

async function openBotHarness(page) {
  await page.route("**/bot-harness", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Bot harness</title>",
    });
  });
  await page.goto("/bot-harness");
}

test("bot skips repeating prebuilt and ranked moves, then uses the first non-repeating rank", async ({
  page,
}) => {
  const state = { user: [1, 1], opponent: [1, 2] };
  const prebuiltRepeat = pack([1, 3], [1, 2]);
  const bestRepeat = pack([2, 2], [1, 2]);
  const rankZeroRepeat = pack([0, 4], [1, 2]);
  const rankOneRepeat = pack([2, 3], [1, 2]);
  const rankTwoAllowed = pack([1, 4], [1, 2]);

  await mockBotCache(page, [["1,1:1,2", prebuiltRepeat]]);
  await installFakeBot(page, {
    nextStates: [bestRepeat],
    rankedByRank: {
      0: rankZeroRepeat,
      1: rankOneRepeat,
      2: rankTwoAllowed,
    },
  });
  await installBotScores(page, {
    [rankTwoAllowed]: -1,
  });
  await openBotHarness(page);

  const result = await page.evaluate(
    async ({ state, repeatingPacked, botModulePath, rulesModulePath }) => {
      const [{ createBotController }, { packedToState, repetitionKey }] =
        await Promise.all([import(botModulePath), import(rulesModulePath)]);
      const repeatingKeys = new Set(
        repeatingPacked.map((packed) =>
          repetitionKey("user", packedToState(packed)),
        ),
      );
      const wouldRepeatCalls = [];
      const controller = createBotController({
        state,
        repetitionCounts: new Map(),
        wouldRepeat: (turn, candidate) => {
          const key = repetitionKey(turn, candidate);
          wouldRepeatCalls.push({ turn, key });
          return repeatingKeys.has(key);
        },
      });

      return {
        next: await controller.nextMove(),
        wasmCalls: globalThis.__botCalls,
        wouldRepeatCalls,
      };
    },
    {
      state,
      repeatingPacked: [
        prebuiltRepeat,
        bestRepeat,
        rankZeroRepeat,
        rankOneRepeat,
      ],
      botModulePath: BOT_MODULE_PATH,
      rulesModulePath: RULES_MODULE_PATH,
    },
  );

  expect(result.next).toBe(rankTwoAllowed);
  expect(result.wouldRepeatCalls.length).toBeGreaterThanOrEqual(4);
  expect(result.wasmCalls.map((call) => call.fn)).toContain("ranked");
  const rankedIndexes = result.wasmCalls
    .filter((call) => call.fn === "ranked")
    .map((call) => call.args[4]);

  expect(rankedIndexes.slice(0, 3)).toEqual([0, 1, 2]);
  expect(rankedIndexes).toContain(3);
});

test("bot can randomize among cached tied moves without invoking wasm search", async ({
  page,
}) => {
  const state = { user: [1, 1], opponent: [1, 2] };
  const prebuiltDraw = pack([1, 4], [1, 2]);
  const alternateDraw = pack([2, 3], [1, 2]);

  await mockBotCache(page, [["1,1:1,2", [prebuiltDraw, alternateDraw]]]);
  await installFakeBot(page, {
    nextStates: [pack([0, 4], [1, 2])],
    rankedByRank: {
      0: pack([2, 3], [1, 2]),
    },
  });
  await openBotHarness(page);

  const result = await page.evaluate(
    async ({ state, botModulePath }) => {
      const realRandom = Math.random;
      Math.random = () => 0.99;

      try {
        const [{ createBotController }] = await Promise.all([
          import(botModulePath),
        ]);
        const controller = createBotController({
          state,
          repetitionCounts: new Map(),
          wouldRepeat: () => false,
        });

        return {
          next: await controller.nextMove(),
          wasmCalls: globalThis.__botCalls,
        };
      } finally {
        Math.random = realRandom;
      }
    },
    { state, botModulePath: BOT_MODULE_PATH },
  );

  expect(result.next).toBe(alternateDraw);
  expect(result.wasmCalls.map((call) => call.fn)).toEqual([
    "ranked",
    "ranked",
    "outcome",
    "score",
    "outcome",
    "score",
  ]);
});

test("bot avoids a user-winning ranked branch when exact draw outcomes exist", async ({
  page,
}) => {
  const state = { user: [1, 1], opponent: [1, 2] };
  const drawA = pack([1, 1], [0, 3]);
  const drawB = pack([1, 2], [1, 2]);
  const losingMove = pack([1, 3], [1, 2]);

  await mockBotCache(page, []);
  await installFakeBot(page, {
    nextStates: [drawA],
    rankedByRank: {
      0: drawA,
      1: drawB,
      2: losingMove,
    },
  });
  await installBotExactScores(page, {
    [drawA]: 0,
    [drawB]: 0,
    [losingMove]: 1,
  });
  await openBotHarness(page);

  const result = await page.evaluate(
    async ({ state, botModulePath }) => {
      const realRandom = Math.random;
      Math.random = () => 0.99;

      try {
        const [{ createBotController }] = await Promise.all([
          import(botModulePath),
        ]);
        const controller = createBotController({
          state,
          repetitionCounts: new Map(),
          wouldRepeat: () => false,
        });

        return {
          next: await controller.nextMove(),
          wasmCalls: globalThis.__botCalls,
        };
      } finally {
        Math.random = realRandom;
      }
    },
    { state, botModulePath: BOT_MODULE_PATH },
  );

  expect(result.next).toBe(drawB);
  expect(result.next).not.toBe(losingMove);
  expect(result.wasmCalls.map((call) => call.fn)).toContain("outcome");
});

test("bot prefers an exact winning move over an exact drawing move", async ({
  page,
}) => {
  const state = { user: [0, 1], opponent: [0, 3] };
  const winningMove = pack([0, 0], [0, 4]);
  const drawingMove = pack([0, 1], [0, 3]);

  await mockBotCache(page, [["0,1:0,3", [drawingMove, winningMove]]]);
  await installFakeBot(page, {
    nextStates: [drawingMove],
    rankedByRank: {
      0: drawingMove,
      1: winningMove,
    },
  });
  await installBotScores(page, {
    [winningMove]: 50,
    [drawingMove]: 0,
  });
  await installBotExactScores(page, {
    [winningMove]: -1,
    [drawingMove]: 0,
  });
  await openBotHarness(page);

  const result = await page.evaluate(
    async ({ state, botModulePath }) => {
      const realRandom = Math.random;
      Math.random = () => 0;

      try {
        const [{ createBotController }] = await Promise.all([
          import(botModulePath),
        ]);
        const controller = createBotController({
          state,
          repetitionCounts: new Map(),
          wouldRepeat: () => false,
        });

        return {
          next: await controller.nextMove(),
          wasmCalls: globalThis.__botCalls,
        };
      } finally {
        Math.random = realRandom;
      }
    },
    { state, botModulePath: BOT_MODULE_PATH },
  );

  expect(result.next).toBe(winningMove);
  expect(result.next).not.toBe(drawingMove);
  expect(result.wasmCalls.map((call) => call.fn)).toContain("outcome");
});

test("app declares a draw when no ranked bot move avoids repetition", async ({
  page,
}) => {
  const initialState = pack([1, 1], [1, 1]);

  await mockBotCache(page, []);
  await installFakeBot(page, {
    nextStates: [initialState, initialState],
    rankedByRank: {
      0: initialState,
      1: NO_BOT_MOVE,
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Yes" }).click();

  await hand(page, "user", 0).click();
  await hand(page, "opponent", 0).click();
  await expect(page.locator(".rearrange")).toBeEnabled();
  await expectHands(page, "user", [1, 1]);
  await expectHands(page, "opponent", [1, 1]);

  await hand(page, "user", 0).click();
  await hand(page, "opponent", 0).click();

  await expect(page.locator(".turn-indicator")).toHaveText(
    "Draw. Tap to Play Again.",
  );

  const wasmCalls = await page.evaluate(() => globalThis.__botCalls);
  expect(wasmCalls.map((call) => call.fn)).toContain("depth-ranked");
});
