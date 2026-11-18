import { createHash } from "node:crypto";

// App hooks for visual-kit (see CONTRACT.md): log in as the seeded demo user, put the account on the
// currency each screen is shown in, and wait for the charts.

// Every scene states its settings, so none depends on the order or on a --routes filter. The tax
// screen is the one read in EUR; everything else in the seed's IDR.
// `assistantSaveHistory` is off everywhere but the saved-chats scene: turning it off deletes every stored
// conversation, so each scene starts from nothing and none depends on the order the scenes ran in.
// `assistantAttachments` is off everywhere but the two attachment scenes, for the same reason.
const SETTINGS = {
  displayCurrency: "IDR",
  taxRegime: "DE",
  assistantSaveHistory: false,
  assistantAttachments: false,
};
const SCENE_SETTINGS = {
  tax: { displayCurrency: "EUR" },
  "assistant-history-saved": { assistantSaveHistory: true },
  "assistant-attachment": { assistantAttachments: true },
  "settings-assistant-attachments": { assistantAttachments: true },
};

// Scenes have no upload step, so the paperclip's file chooser is answered here: the scene clicks it,
// this hands the chooser a tiny PNG. The scripted chat provider ignores the bytes.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const FILE_CHOOSER_SCENES = new Set(["assistant-attachment"]);

// The one question of the saved-chats scene, answered by the demo's scripted chat provider
// (services/api/src/services/chat/demo-stub.ts). Stored under the frozen DEMO_NOW clock.
const SAVED_CHAT_QUESTION = "How is my portfolio doing?";

// Charts that must be drawn before a screen is shot.
const MIN_CHARTS = { holdings: 2, "holdings-range": 1, insights: 2 };

// The same endpoints the app's own settings controls write, reached through the web app's proxy.
const ENDPOINTS = {
  displayCurrency: { method: "PATCH", path: "/api/backend/me" },
  taxRegime: { method: "PUT", path: "/api/backend/me/preferences" },
  assistantSaveHistory: { method: "PUT", path: "/api/backend/me/preferences" },
  assistantAttachments: { method: "PUT", path: "/api/backend/me/preferences" },
};

/** The demo as the browser reaches it (the launcher aliases the host when it has no host network). */
function demoOrigin(cfg) {
  const url = new URL(cfg.demo.url);
  if (process.env.VISUAL_KIT_HOST_ALIAS) url.hostname = process.env.VISUAL_KIT_HOST_ALIAS;
  return url.origin;
}

// A route's first loads on a cold `next dev` do not look alike: its chunks compile and its Suspense boundaries
// resolve over the first few requests, and the cards land a pixel off until they settle. Each route is therefore
// loaded, unshot, until two loads in a row render the same, once per demo and before its first shot. Keyed by the
// session too: the base and the head demo are different servers.
const warmed = new Set();

export async function beforeScene({ context, page, scene, cfg, host }) {
  // Not cached: the base and the head demo of a check have different secrets.
  const cookie = JSON.parse(await host("session"));
  const origin = demoOrigin(cfg);
  await context.addCookies([{ ...cookie, url: origin, httpOnly: true, sameSite: "Lax" }]);

  const settings = { ...SETTINGS, ...SCENE_SETTINGS[scene.name] };
  for (const [key, value] of Object.entries(settings)) {
    const { method, path } = ENDPOINTS[key];
    const res = await page.request.fetch(`${origin}${path}`, { method, data: { [key]: value } });
    if (!res.ok()) throw new Error(`${method} ${path} failed with HTTP ${res.status()}`);
    // String compare: the API may echo a coerced form.
    const echoed = (await res.json())[key];
    if (String(echoed) !== String(value))
      throw new Error(`setting ${key} to ${value} did not stick (API answered ${echoed})`);
  }

  if (FILE_CHOOSER_SCENES.has(scene.name)) {
    page.on("filechooser", (chooser) =>
      chooser.setFiles({ name: "statement.png", mimeType: "image/png", buffer: PNG_1X1 }),
    );
  }

  // A stored conversation to list: asked through the web proxy, read to the end so it is saved.
  if (settings.assistantSaveHistory) {
    const res = await page.request.fetch(`${origin}/api/backend/assistant/chat`, {
      method: "POST",
      data: { messages: [{ role: "user", content: SAVED_CHAT_QUESTION }], scope: "all" },
    });
    if (!res.ok()) throw new Error(`POST /assistant/chat failed with HTTP ${res.status()}`);
    if (!(await res.text()).includes("event: conversation"))
      throw new Error("the demo's chat turn was not saved (is the scripted provider on?)");
  }

  // Not in a loop's recording context: a second page there would be recorded and shift the trim.
  const key = `${cookie.value}${scene.path}`;
  if (scene.loop || warmed.has(key)) return;
  warmed.add(key);
  const url = new URL(scene.path, origin).toString();
  const warm = await context.newPage();
  let previous = "";
  for (let load = 0; load < 8; load++) {
    await warm.goto(url, { waitUntil: "load" });
    await warm.waitForLoadState("networkidle").catch(() => {});
    await warm.waitForTimeout(1500);
    const look = createHash("md5")
      .update(await warm.screenshot({ fullPage: true, animations: "disabled" }))
      .digest("hex");
    if (look === previous) break;
    previous = look;
  }
  await warm.close();
}

/** What is still pending on the page, as short reasons (empty when it is ready). */
function pending(min, path) {
  const reasons = [];
  // A dropped session cookie redirects every route to sign-in; say so instead of "0/2 charts drawn".
  if (location.pathname !== path) reasons.push(`redirected to ${location.pathname}, not ${path}`);
  if (document.querySelector('[aria-busy="true"], [data-chart-loading]'))
    reasons.push("chart or data still loading");
  const drawn = [...document.querySelectorAll(".recharts-wrapper")].filter((c) =>
    c.querySelector(".recharts-surface path[d]"),
  );
  if (drawn.length < min) reasons.push(`${drawn.length}/${min} expected charts drawn`);
  // The demo runs `next dev`: wait out a route compile.
  const portal = document.querySelector("nextjs-portal")?.shadowRoot;
  if (/Compiling|Building/.test(portal?.textContent ?? "")) reasons.push("dev server compiling");
  return reasons;
}

export async function settle({ page, scene }) {
  const min = MIN_CHARTS[scene.name] ?? 0;
  await page
    .waitForFunction(`(${pending})(${min}, ${JSON.stringify(scene.path)}).length === 0`, null, {
      timeout: 60_000,
      polling: 250,
    })
    .catch(async () => {
      const left = await page.evaluate(`(${pending})(${min}, ${JSON.stringify(scene.path)})`);
      throw new Error(`${scene.name}: not ready after 60s (${left.join(", ")})`);
    });
  // Recharts' entrance animation, late font swaps and client refetches are not covered by reduced motion
  // or by network idle: wait until every element has held its box (transforms included) for 1.5 s.
  await page
    .evaluate(async () => {
      const boxes = () =>
        [...document.querySelectorAll("body *")]
          .map((e) => {
            const r = e.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height].map((n) => n.toFixed(2)).join(",");
          })
          .join("|");
      let last = boxes();
      let steady = 0;
      for (let i = 0; i < 80; i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const now = boxes();
        steady = now === last ? steady + 1 : 0;
        if (steady >= 6) return;
        last = now;
      }
      throw new Error("the page keeps moving");
    })
    .catch((err) => {
      throw new Error(`${scene.name}: ${err.message.split("\n")[0]}`);
    });
  // An open Next dev overlay with issues means the page is broken; the indicator itself is hidden.
  const issues = await page.evaluate(() => {
    const root = document.querySelector("nextjs-portal")?.shadowRoot;
    return Boolean(
      root?.querySelector("[data-issues]") || /\bIssues?\b/.test(root?.textContent ?? ""),
    );
  });
  if (issues) throw new Error(`${scene.name}: the Next dev overlay reports issues`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}
