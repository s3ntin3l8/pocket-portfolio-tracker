import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The assistant panel's layout in a real browser: the dock beside the page on desktop, the
 * full-screen page on a phone, and the header controls sharing one centre line (#1248). The API
 * runs the scripted chat provider (`DEMO_CHAT_STUB`, see `e2e/stack-env.mjs`).
 */

const HOLDINGS = "/en/holdings";
const OVERVIEW = "How is my portfolio doing?";

async function gotoReady(page: Page) {
  await page.goto(HOLDINGS);
  const open = page.getByRole("button", { name: "Open the assistant" });
  await expect(open).toBeVisible();
  // Hydration: the button works only once React has attached handlers.
  await expect(async () => {
    await open.click();
    await expect(page.getByLabel("Message to the assistant")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}
const centreY = (b: { y: number; height: number }) => b.y + b.height / 2;

test.describe("assistant panel", () => {
  test("docks beside the page from xl and narrows it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(HOLDINGS);
    const main = page.locator("#main");
    await expect(main).toBeVisible();
    const before = (await box(main)).width;

    await gotoReady(page);
    const dock = page.getByRole("complementary", { name: "Assistant" });
    await expect(dock).toBeVisible();
    expect((await box(dock)).width).toBeCloseTo(400, 0);
    // In the flex row, not over the page: the page lost the dock's width.
    await expect.poll(async () => (await box(main)).width).toBeLessThan(before - 350);
    // Not a modal: the page behind stays reachable.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Close the assistant" }).click();
    await expect(dock).toBeHidden();
    await expect.poll(async () => (await box(main)).width).toBeCloseTo(before, 0);
  });

  test("floats over the page between md and xl instead of squeezing it", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(HOLDINGS);
    const main = page.locator("#main");
    const before = (await box(main)).width;
    await gotoReady(page);
    await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
    expect((await box(main)).width).toBeCloseTo(before, 0);
  });

  test("History, New chat, expand and × share one centre line", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await gotoReady(page);
    await page.getByRole("button", { name: OVERVIEW }).click();
    await expect(page.getByText("This is a demo answer")).toBeVisible();

    const dock = page.getByRole("complementary", { name: "Assistant" });
    const controls = [
      dock.getByRole("button", { name: "History" }),
      dock.getByRole("button", { name: "New chat" }),
      dock.getByRole("button", { name: "Widen the assistant" }),
      dock.getByRole("button", { name: "Close the assistant" }),
    ];
    const centres = [];
    for (const c of controls) centres.push(centreY(await box(c)));
    for (const y of centres) expect(Math.abs(y - centres[0]!)).toBeLessThanOrEqual(1);
    // ...and the title is on that line too.
    const title = centreY(await box(dock.getByRole("heading", { name: "Assistant" })));
    expect(Math.abs(title - centres[0]!)).toBeLessThanOrEqual(1);
  });

  test("widens at 2xl and remembers it", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await gotoReady(page);
    const dock = page.getByRole("complementary", { name: "Assistant" });
    await page.getByRole("button", { name: "Widen the assistant" }).click();
    expect((await box(dock)).width).toBeCloseTo(640, 0);

    await page.reload();
    await gotoReady(page);
    expect((await box(page.getByRole("complementary", { name: "Assistant" }))).width).toBeCloseTo(
      640,
      0,
    );
  });

  test("on a phone it is a full-screen page with the composer off the screen edge", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoReady(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const d = await box(dialog);
    expect(d.width).toBeCloseTo(390, 0);
    expect(d.height).toBeCloseTo(844, 0);

    // History sits in the header row beside the back arrow, not on a row of its own.
    const back = centreY(await box(dialog.getByRole("button", { name: "Back" })));
    const history = centreY(await box(dialog.getByRole("button", { name: "History" })));
    expect(Math.abs(back - history)).toBeLessThanOrEqual(1);

    // A real gap under the composer even with no home-indicator inset.
    const input = await box(page.getByLabel("Message to the assistant"));
    expect(844 - (input.y + input.height)).toBeGreaterThanOrEqual(12);
  });

  test("hands a drafted entry over from Add transaction without sending it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(HOLDINGS);
    const add = page.getByRole("button", { name: "Add transaction" }).first();
    await expect(add).toBeVisible();
    await expect(async () => {
      await add.click();
      await expect(page.getByRole("button", { name: "Describe it to the assistant" })).toBeVisible({
        timeout: 1000,
      });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Describe it to the assistant" }).click();

    const input = page.getByLabel("Message to the assistant");
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(/^Record this in .+: $/);
    await expect(input).toBeFocused();
    // Nothing was sent: the empty state is still showing.
    await expect(page.getByText("Ask a question about your portfolio")).toBeVisible();
  });
});
