#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { startDemo } from "./demo/instance.mjs";
import { assertDemoEnv, demoEnv, playwrightBrowsersPath } from "./demo/env.mjs";

/**
 * Reproducible screenshot pipeline: boot an isolated demo instance (seeded
 * scratch PGlite + API + web, see scripts/demo/instance.mjs), capture, tear down.
 *
 *   npm run screenshots                                   # README + PWA manifest set
 *   npm run screenshots -- --profile landing --out DIR    # landing-page stills + loop
 *
 * Nothing here touches real user data, real Authentik, Docker or the repo .env:
 * see scripts/demo/env.mjs for how that is enforced.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { values } = parseArgs({
  options: {
    profile: { type: "string", default: "readme" },
    out: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});
if (values.profile === "landing" && !values.out)
  throw new Error("--profile landing needs --out <dir>");

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
    child.on("error", reject);
  });
}

async function main() {
  // Resolve the browser cache now: demo processes get HOME redirected into the
  // scratch dir, where Playwright would otherwise look for (and not find) them.
  const browsers = playwrightBrowsersPath();
  const demo = await startDemo({ quiet: true, keep: values.keep });
  try {
    const env = demoEnv(demo.demoDir, {
      SCREENSHOTS_PROFILE: values.profile,
      SCREENSHOTS_WEB_URL: demo.webUrl,
      SCREENSHOTS_PAT_FILE: demo.patFile,
      AUTH_SECRET: demo.authSecret,
      PLAYWRIGHT_BROWSERS_PATH: browsers,
      ...(values.out && { SCREENSHOTS_OUT_DIR: path.resolve(values.out) }),
    });
    assertDemoEnv(env, demo.demoDir);
    console.log(`[screenshots] capturing (${values.profile} profile)...`);
    await run(process.execPath, ["scripts/screenshots.mjs"], {
      cwd: path.join(REPO_ROOT, "apps/web"),
      env,
    });
    console.log(
      `[screenshots] done: ${values.out ? path.resolve(values.out) : "apps/web/public/screenshots/"}`,
    );
  } finally {
    console.log("[screenshots] tearing down the demo...");
    await demo.stop();
  }
}

main().catch((err) => {
  console.error("[screenshots] failed:", err);
  process.exitCode = 1;
});
