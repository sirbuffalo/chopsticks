import { expect, test as base } from "@playwright/test";

const FONT_HOST_PATTERN = /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//;
const NO_BOT_MOVE = -1;

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

async function chooseToGoFirst(page) {
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.locator(".start-overlay")).toBeHidden();
  await expect(page.locator(".rearrange")).toBeEnabled();
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
      };

      globalThis.__botCalls = [];
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
  await openBotHarness(page);

  const result = await page.evaluate(
    async ({ state, repeatingPacked }) => {
      const [{ createBotController }, { packedToState, repetitionKey }] =
        await Promise.all([import("/bot.js"), import("/rules.js")]);
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
    },
  );

  expect(result.next).toBe(rankTwoAllowed);
  expect(result.wouldRepeatCalls).toHaveLength(5);
  expect(result.wasmCalls.map((call) => call.fn)).toEqual([
    "next",
    "ranked",
    "ranked",
    "ranked",
  ]);
  expect(
    result.wasmCalls
      .filter((call) => call.fn === "ranked")
      .map((call) => call.args[4]),
  ).toEqual([0, 1, 2]);
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
  await chooseToGoFirst(page);

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
  await expect(page.locator(".turn-indicator")).toBeFocused();

  const wasmCalls = await page.evaluate(() => globalThis.__botCalls);
  expect(wasmCalls.map((call) => call.fn)).toEqual([
    "next",
    "next",
    "ranked",
    "ranked",
  ]);
});
