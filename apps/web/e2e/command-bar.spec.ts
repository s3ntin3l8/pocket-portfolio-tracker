import { expect, test, type Page } from "@playwright/test";

/**
 * Real-browser pass over the command bar (#935): palette, single-key shortcuts, g-chords,
 * the `?` help sheet, focus restore, group semantics, the `?entry=` deep links and the
 * Android-back (`useBackToClose`) behaviour after an action that `router.replace`s.
 * Runs against the demo dataset served by `playwright.config.ts`.
 */

const HOLDINGS = "/en/holdings";
const mod = process.platform === "darwin" ? "Meta" : "Control";

const palette = (page: Page) => page.getByRole("dialog", { name: "Search" });
const help = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });

/** Navigate and wait until the command bar's keydown listener is certainly mounted. */
async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole("button", { name: "Search" }).first()).toBeVisible();
  // Hydration: the trigger works only once React has attached handlers.
  await expect(async () => {
    await page.keyboard.press("?");
    await expect(help(page)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(help(page)).toBeHidden();
}

/** Put focus on a neutral, focusable page element and return its handle id. */
async function focusMarker(page: Page) {
  await page.evaluate(() => {
    const b = document.createElement("button");
    b.id = "e2e-focus-marker";
    b.textContent = "marker";
    b.style.cssText = "position:fixed;bottom:0;left:0;z-index:1";
    document.body.appendChild(b);
    b.focus();
  });
  await expect(page.locator("#e2e-focus-marker")).toBeFocused();
}

test.describe("command bar", () => {
  test.beforeEach(async ({ page }) => {
    await gotoReady(page, HOLDINGS);
  });

  test("Ctrl/Cmd-K toggles the palette, even from a text field", async ({ page }) => {
    await page.keyboard.press(`${mod}+k`);
    await expect(palette(page)).toBeVisible();
    await expect(page.getByPlaceholder(/Search or run a command/)).toBeFocused();
    // From inside the palette's own input it toggles it closed again.
    await page.keyboard.press(`${mod}+k`);
    await expect(palette(page)).toBeHidden();
  });

  test("/ opens the palette and Escape closes it", async ({ page }) => {
    await page.keyboard.press("/");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
  });

  test("? opens the shortcuts help and Escape closes it", async ({ page }) => {
    await page.keyboard.press("?");
    await expect(help(page)).toBeVisible();
    await expect(help(page).getByRole("region", { name: "Go to" })).toBeVisible();
    await expect(help(page).getByRole("region", { name: "General" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help(page)).toBeHidden();
  });

  for (const [chord, path] of [
    ["h", "/en/holdings"],
    ["a", "/en/transactions"],
    ["r", "/en/reports"],
    ["i", "/en/insights"],
    ["s", "/en/settings"],
  ] as const) {
    test(`g ${chord} navigates to ${path}`, async ({ page }) => {
      // Start somewhere else so `g h` is a real navigation too.
      if (path === "/en/holdings") {
        await page.keyboard.press("g");
        await page.keyboard.press("a");
        await expect(page).toHaveURL(/\/en\/transactions/);
        await expect(page.getByRole("button", { name: "Search" }).first()).toBeVisible();
      }
      await page.keyboard.press("g");
      await page.keyboard.press(chord);
      await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`));
    });
  }

  test("g <unknown> and a lone g do nothing", async ({ page }) => {
    await page.keyboard.press("g");
    await page.keyboard.press("z");
    await expect(page).toHaveURL(/\/en\/holdings/);
    await expect(palette(page)).toBeHidden();
  });

  test("shortcuts are ignored while typing in a field", async ({ page }) => {
    await page.keyboard.press("/");
    const input = page.getByPlaceholder(/Search or run a command/);
    await input.fill("");
    await page.keyboard.type("?ng");
    await expect(input).toHaveValue("?ng");
    await expect(help(page)).toBeHidden();
    await expect(page).toHaveURL(/\/en\/holdings/);
  });

  test("n opens the add-transaction sheet and Escape closes it", async ({ page }) => {
    await page.keyboard.press("n");
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(/transaction/i);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("focus returns to the previously focused element after closing the palette", async ({
    page,
  }) => {
    await focusMarker(page);
    await page.keyboard.press(`${mod}+k`);
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await expect(page.locator("#e2e-focus-marker")).toBeFocused();
  });

  test("focus returns to the previously focused element after closing the help sheet", async ({
    page,
  }) => {
    await focusMarker(page);
    await page.keyboard.press("?");
    await expect(help(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help(page)).toBeHidden();
    await expect(page.locator("#e2e-focus-marker")).toBeFocused();
  });

  test("palette command groups are exposed as labelled groups", async ({ page }) => {
    await page.keyboard.press(`${mod}+k`);
    const dlg = palette(page);
    await expect(dlg.getByRole("listbox")).toBeVisible();
    for (const name of ["Go to", "Actions", "Chart range"]) {
      await expect(dlg.getByRole("group", { name })).toBeVisible();
    }
    // Items are options inside their group, with the page name as the accessible name
    // (the decorative chord hint is aria-hidden so it is not read out).
    const goTo = dlg.getByRole("group", { name: "Go to" });
    await expect(goTo.getByRole("option", { name: "Holdings", exact: true })).toBeVisible();
    await expect(goTo.locator('[aria-hidden="true"]', { hasText: "G H" })).toHaveCount(1);
    // The input is a combobox wired to the listbox for screen readers.
    const input = dlg.getByRole("combobox");
    await expect(input).toHaveAttribute("aria-controls", /.+/);
    // Filtering narrows to the matching group only.
    await input.fill("theme");
    await expect(dlg.getByRole("group", { name: "Actions" })).toBeVisible();
    await expect(dlg.getByRole("group", { name: "Go to" })).toHaveCount(0);
  });

  test("selecting a palette page navigates there and closes the palette", async ({ page }) => {
    await page.keyboard.press(`${mod}+k`);
    await palette(page).getByRole("option", { name: "Reports", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/reports/);
    await expect(palette(page)).toBeHidden();
  });
});

test.describe("add-entry deep links", () => {
  test("?entry=transaction opens the sheet and keeps ?scope= while dropping ?entry=", async ({
    page,
  }) => {
    await page.goto(`${HOLDINGS}?scope=all&entry=transaction`);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/entry=/);
    await expect(page).toHaveURL(/scope=all/);
  });

  test("?entry=import opens the import flow and keeps ?scope=", async ({ page }) => {
    await page.goto(`${HOLDINGS}?scope=all&entry=import`);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/entry=/);
    await expect(page).toHaveURL(/scope=all/);
  });

  test("palette 'Add transaction' action keeps ?scope= and opens the sheet", async ({ page }) => {
    await gotoReady(page, `${HOLDINGS}?scope=all`);
    await page.keyboard.press(`${mod}+k`);
    await palette(page).getByRole("option", { name: "Add transaction" }).click();
    await expect(palette(page)).toBeHidden();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/scope=all/);
    await expect(page).not.toHaveURL(/entry=/);
  });
});

test.describe("Android back (useBackToClose)", () => {
  test("back closes an open palette without leaving the page", async ({ page }) => {
    await gotoReady(page, HOLDINGS);
    await page.keyboard.press(`${mod}+k`);
    await expect(palette(page)).toBeVisible();
    await page.goBack();
    await expect(palette(page)).toBeHidden();
    await expect(page).toHaveURL(/\/en\/holdings/);
  });

  test("after a palette action that router.replaces (chart range), back is sane", async ({
    page,
  }) => {
    await gotoReady(page, HOLDINGS);
    const startUrl = page.url();
    await page.keyboard.press(`${mod}+k`);
    await palette(page)
      .getByRole("option", { name: /^Range: / })
      .first()
      .click();
    await expect(palette(page)).toBeHidden();
    await expect(page).toHaveURL(/range=/);
    const rangedUrl = page.url();
    expect(rangedUrl).not.toBe(startUrl);

    // A hardware back must not re-open the palette, must not blow up, and must stay in
    // the app on the holdings page.
    await page.goBack();
    await expect(palette(page)).toBeHidden();
    await expect(page).toHaveURL(/\/en\/holdings/);
    await expect(page.getByRole("button", { name: "Search" }).first()).toBeVisible();

    // Exactly the one stale marker the replace left behind is consumed by that back;
    // the app is still interactive afterwards.
    await page.keyboard.press("?");
    await expect(help(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help(page)).toBeHidden();
  });
});
