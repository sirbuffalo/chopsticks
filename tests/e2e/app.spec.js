import { expect, test as base } from "@playwright/test";

const FONT_HOST_PATTERN = /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//;
const EXPECTED_WASM_MOVE = 0x1020;

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

function hand(page, person, index) {
  return page.locator(`.hand[data-person="${person}"][data-hand="${index}"]`);
}

async function expectHands(page, person, values) {
  await expect(hand(page, person, 0)).toHaveText(String(values[0]));
  await expect(hand(page, person, 1)).toHaveText(String(values[1]));
}

test("app boots with the main UI and no console errors", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Chopsticks");
  await expect(page.locator(".hand")).toHaveCount(4);
  await expectHands(page, "opponent", [1, 1]);
  await expectHands(page, "user", [1, 1]);

  await expect(hand(page, "user", 0)).toHaveJSProperty("draggable", true);
  await expect(hand(page, "user", 1)).toHaveJSProperty("draggable", true);
  await expect(hand(page, "opponent", 0)).toHaveJSProperty("draggable", false);
  await expect(hand(page, "opponent", 1)).toHaveJSProperty("draggable", false);
  await expect(page.locator(".rearrange")).toBeEnabled();
  await expect(page.locator(".rearrange-cancel")).toBeDisabled();
  await expect(page.locator(".banner-wrapper")).toBeHidden();
});

test("user can hit an opponent hand and see the deterministic bot reply", async ({
  page,
}) => {
  await page.goto("/");

  await hand(page, "user", 0).click();
  await expect(hand(page, "user", 0)).toHaveClass(/drag-source/);

  await hand(page, "opponent", 0).click();
  await expect(page.locator(".rearrange")).toBeDisabled();

  await expectHands(page, "user", [1, 2]);
  await expectHands(page, "opponent", [2, 1]);
  await expect(page.locator(".rearrange")).toBeEnabled();
});

test("user hit preserves the visible opponent hand that was clicked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay === 250) {
        return 0;
      }

      return originalSetTimeout(callback, delay, ...args);
    };
  });
  await page.goto("/");

  await hand(page, "user", 0).click();
  await hand(page, "opponent", 0).click();

  await expectHands(page, "opponent", [2, 1]);

  await page.reload();

  await hand(page, "user", 0).click();
  await hand(page, "opponent", 1).click();

  await expectHands(page, "opponent", [1, 2]);
});

test("rearrange mode edits in-memory state and cancel restores it", async ({
  page,
}) => {
  await page.goto("/");

  await page.locator(".rearrange").click();

  await expect(page.locator(".rearrange")).toHaveText("Confirm");
  await expect(page.locator(".rearrange")).toBeDisabled();
  await expect(page.locator(".rearrange-cancel")).toBeEnabled();
  await expect(hand(page, "user", 0)).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(hand(page, "user", 1)).toHaveAttribute(
    "contenteditable",
    "true",
  );

  await page.keyboard.press("0");

  await expectHands(page, "user", [0, 2]);
  await expect(page.locator(".rearrange")).toBeEnabled();

  await page.locator(".rearrange-cancel").click();

  await expectHands(page, "user", [1, 1]);
  await expect(page.locator(".rearrange")).toHaveText("Rearrange");
  await expect(hand(page, "user", 0)).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(hand(page, "user", 1)).toHaveAttribute(
    "contenteditable",
    "false",
  );
});

test("invalid rearrange input is ignored while unchanged confirmation stays disabled", async ({
  page,
}) => {
  await page.goto("/");

  await page.locator(".rearrange").click();
  await page.keyboard.press("x");

  await expectHands(page, "user", [1, 1]);
  await expect(page.locator(".rearrange")).toHaveText("Confirm");
  await expect(page.locator(".rearrange")).toBeDisabled();
});

test("browser JS can instantiate the WASM bot and call the solver", async ({
  page,
}) => {
  await page.goto("/");

  const nextMove = await page.evaluate(async () => {
    const { createBotController } = await import("/bot.js");
    const state = { user: [0, 1], opponent: [0, 1] };
    const controller = createBotController({
      state,
      repetitionCounts: new Map(),
      wouldRepeat: () => false,
    });

    return controller.nextMove();
  });

  expect(nextMove).toBe(EXPECTED_WASM_MOVE);
});
