#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDemoEnv, assertPortsFree, demoEnv } from "./env.mjs";

/**
 * An isolated, throwaway Pocket instance with the demo dataset: seed a scratch
 * PGlite database, boot the API and web app against it, tear it all down on stop.
 *
 *   make demo          # interactive: prints a URL and a throwaway login
 *   make screenshots   # uses startDemo() from scripts/screenshots.mjs
 *
 * Isolation is enforced, not just documented (see ./env.mjs): a clean env with no
 * inherited secrets, all state under one mkdtemp dir, loopback-only dedicated
 * ports that must be free, and the API started from a directory without a .env.
 * It never touches Docker, so the production compose project is out of reach.
 *
 * Any startup failure runs the same teardown as a normal stop before the error
 * propagates. DEMO_HEALTH_TIMEOUT_MS (default 90000) bounds each readiness probe.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BIN = (name) => path.join(REPO_ROOT, "node_modules", ".bin", name);
const API_TSCONFIG = path.join(REPO_ROOT, "services/api/tsconfig.json");
const WEB_DIR = path.join(REPO_ROOT, "apps/web");

export const DEMO_API_PORT = process.env.DEMO_API_PORT ?? "3910";
export const DEMO_WEB_PORT = process.env.DEMO_WEB_PORT ?? "3915";

const DEFAULT_HEALTH_TIMEOUT_MS = 90_000;

/** DEMO_HEALTH_TIMEOUT_MS, validated: how long each readiness probe may take. */
export function healthTimeoutMs(value = process.env.DEMO_HEALTH_TIMEOUT_MS) {
  if (value === undefined || value === "") return DEFAULT_HEALTH_TIMEOUT_MS;
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms <= 0)
    throw new Error(`DEMO_HEALTH_TIMEOUT_MS must be a positive integer (ms), got "${value}"`);
  return ms;
}

// Dummy issuer: satisfies the auth plugins' boot guards; never contacted.
const ISSUER = "https://demo.invalid/application/o/pocket-demo/";

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
    child.on("error", reject);
  });
}

/**
 * Own process group (`detached`) so stop() can kill everything a server forks
 * (next dev spawns workers); a plain child.kill() would leak them.
 */
function spawnServer(name, cmd, args, opts, quiet) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true, ...opts });
  const out = (d) => !quiet && process.stdout.write(`[${name}] ${d}`);
  child.stdout.on("data", out);
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  return child;
}

/** SIGTERM the whole group, wait for it to go, SIGKILL whatever is left. */
async function killGroup(child, graceMs = 5_000) {
  if (!child) return;
  const signal = (sig) => {
    try {
      process.kill(-child.pid, sig);
      return true;
    } catch {
      return false; // Group already gone.
    }
  };
  if (!signal("SIGTERM")) return;
  // Done when the direct child has exited and no process in its group remains
  // (signal 0 only probes). next dev writes its config store on the way out.
  const alive = () => child.exitCode === null || signal(0);
  const waitGone = async (ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && alive()) await new Promise((r) => setTimeout(r, 100));
  };
  await waitGone(graceMs);
  if (!signal("SIGKILL")) return;
  // Let the killed group actually exit, so the scratch-dir delete does not race it.
  await waitGone(2_000);
}

async function waitForHttp(url, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError}` : ""}`);
}

/** The real startup sequence: build, seed, start both servers, wait until ready. */
async function bootDemo({
  demoDir,
  runDir,
  patFile,
  seedEnv,
  apiEnv,
  webEnv,
  quiet,
  timeoutMs,
  spawnServer,
}) {
  // The API and web import the workspace packages from their dist/ builds, the
  // same as `turbo dev` (dependsOn ^build). Cached by turbo, so this is quick.
  console.log("[demo] building workspace packages...");
  await run(BIN("turbo"), ["run", "build", "--filter=./packages/*", "--output-logs=errors-only"], {
    cwd: REPO_ROOT,
    env: demoEnv(demoDir, { TURBO_TELEMETRY_DISABLED: "1" }),
  });
  console.log("[demo] seeding demo data...");
  await run(
    BIN("tsx"),
    ["--tsconfig", API_TSCONFIG, path.join(REPO_ROOT, "services/api/src/db/seed-demo.ts"), patFile],
    { cwd: runDir, env: seedEnv },
  );

  console.log("[demo] starting API and web...");
  spawnServer(
    "api",
    BIN("tsx"),
    ["--tsconfig", API_TSCONFIG, path.join(REPO_ROOT, "services/api/src/server.ts")],
    { cwd: runDir, env: apiEnv },
    quiet,
  );
  spawnServer(
    "web",
    BIN("next"),
    ["dev", "-p", DEMO_WEB_PORT, "-H", "127.0.0.1"],
    { cwd: WEB_DIR, env: webEnv },
    quiet,
  );

  await waitForHttp(`http://127.0.0.1:${DEMO_API_PORT}/health`, timeoutMs);
  await waitForHttp(`http://localhost:${DEMO_WEB_PORT}/en`, timeoutMs);
}

/**
 * Start the demo. `login: true` also seeds a local-password user (throwaway
 * credentials, generated per run) so a human can sign in from a browser.
 *
 * `boot` replaces the build/seed/spawn/wait sequence; tests use it to fail
 * startup without running the real servers.
 */
export async function startDemo({ login = false, quiet = false, keep = false, boot } = {}) {
  // Refused before anything is created: nothing to tear down yet.
  const timeoutMs = healthTimeoutMs();
  await assertPortsFree([DEMO_API_PORT, DEMO_WEB_PORT]);

  const demoDir = await mkdtemp(path.join(tmpdir(), "pocket-demo-"));
  const runDir = path.join(demoDir, "run"); // API cwd: no .env here, logs/storage land here
  const databaseUrl = `pglite://${path.join(demoDir, "db")}`;
  const patFile = path.join(demoDir, "pat.txt");
  const authSecret = randomBytes(32).toString("base64url");
  const local = login
    ? {
        AUTH_LOCAL_SECRET: randomBytes(32).toString("base64url"),
        SEED_DEMO_PASSWORD: randomBytes(12).toString("base64url"),
      }
    : {};

  /** Every server process group started so far; teardown kills them all. */
  const children = [];
  let stopping;
  const hardKill = () => {
    for (const child of children)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Group already gone.
      }
  };
  const teardown = async () => {
    // Wait for every process to exit first: dying next dev workers otherwise
    // recreate files under the scratch HOME after it was deleted.
    await Promise.all(children.map((child) => killGroup(child)));
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (keep) return console.log(`[demo] kept ${demoDir}`);
    // Next's server worker can still write its config store under HOME just after
    // it is signalled, so delete until the directory stays gone.
    for (let attempt = 0; attempt < 5; attempt++) {
      await rm(demoDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(
        (err) => console.warn(`[demo] cleanup attempt failed: ${err}`),
      );
      await new Promise((r) => setTimeout(r, 1_000));
      if (!existsSync(demoDir)) return;
    }
    console.warn(`[demo] could not fully remove ${demoDir}`);
  };
  const stop = () => (stopping ??= teardown());
  // Installed before anything is spawned: the servers run in their own process
  // groups, so a Ctrl-C during the build or boot would otherwise orphan them.
  // They stay registered until all groups are gone; a second Ctrl-C during the
  // grace period skips it and SIGKILLs the groups instead of leaving them behind.
  function onSignal() {
    if (stopping) {
      hardKill();
      // Give the killed groups a moment to exit, or a dying next dev worker
      // recreates its config store under HOME right after the delete.
      const gone = (child) => {
        try {
          return (process.kill(-child.pid, 0), false);
        } catch {
          return true;
        }
      };
      const deadline = Date.now() + 2_000;
      let attempts = 0;
      const finish = () => {
        if (!children.every(gone) && Date.now() < deadline) return setTimeout(finish, 50);
        if (keep) process.exit(130);
        // As in teardown: a dying worker can recreate files just after the
        // delete, so repeat it a few times before exiting.
        rmSync(demoDir, { recursive: true, force: true });
        // Re-check after a beat; exit as soon as the directory stays gone.
        if (++attempts < 5)
          return setTimeout(() => (existsSync(demoDir) ? finish() : process.exit(130)), 500);
        if (existsSync(demoDir)) console.warn(`[demo] hard stop: remove ${demoDir} by hand`);
        process.exit(130);
      };
      return finish();
    }
    stop().then(() => process.exit(0));
  }
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  /** spawnServer that registers the group for teardown; refuses once stopping. */
  const startServer = (...args) => {
    if (stopping) throw new Error("demo is stopping; not starting more servers");
    const child = spawnServer(...args);
    children.push(child);
    return child;
  };

  // Everything from here on runs under the same teardown as a normal stop, so a
  // failure at any step (env guard, build, seed, boot, readiness) leaves no
  // scratch dir or process group behind.
  try {
    console.log(`[demo] scratch dir ${demoDir}`);
    for (const dir of ["home", "tmp", "run"])
      await mkdir(path.join(demoDir, dir), { recursive: true });

    const seedEnv = demoEnv(demoDir, { DATABASE_URL: databaseUrl, ...local });
    const apiEnv = demoEnv(demoDir, {
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
      AUTHENTIK_ISSUER: ISSUER,
      AUTHENTIK_AUDIENCE: "pocket-demo",
      // Never stale, so prices come from the seeded cache, never a live provider.
      MARKET_DATA_TTL_MS: "999999999",
      // Playwright plus Next's background polling exceed the default 100 req/min.
      RATE_LIMIT_MAX: "100000",
      PORT: DEMO_API_PORT,
      HOST: "127.0.0.1",
      LOG_LEVEL: "warn",
      // Local folder storage: the default S3 backend would try to reach (and,
      // outside production, create a bucket on) an object store.
      STORAGE_PROVIDER: "folder",
      STORAGE_FOLDER_PATH: path.join(demoDir, "storage"),
      ...(local.AUTH_LOCAL_SECRET && { AUTH_LOCAL_SECRET: local.AUTH_LOCAL_SECRET }),
    });
    const webEnv = demoEnv(demoDir, {
      AUTH_SECRET: authSecret,
      // Sets the unprefixed (http) session-cookie name mint-session.mjs targets.
      AUTH_URL: `http://localhost:${DEMO_WEB_PORT}`,
      AUTHENTIK_ISSUER: ISSUER,
      AUTHENTIK_CLIENT_ID: "demo",
      AUTHENTIK_CLIENT_SECRET: "demo", // pragma: allowlist secret
      API_URL: `http://localhost:${DEMO_API_PORT}`,
      PORT: DEMO_WEB_PORT,
      ...(local.AUTH_LOCAL_SECRET && { AUTH_LOCAL_SECRET: local.AUTH_LOCAL_SECRET }),
    });

    assertDemoEnv(seedEnv, demoDir, { cwd: runDir });
    assertDemoEnv(apiEnv, demoDir, { cwd: runDir, api: true });
    assertDemoEnv(webEnv, demoDir, { cwd: WEB_DIR, nextApp: true });

    await (boot ?? bootDemo)({
      demoDir,
      runDir,
      patFile,
      seedEnv,
      apiEnv,
      webEnv,
      quiet,
      timeoutMs,
      spawnServer: startServer,
    });
  } catch (err) {
    console.error(`[demo] startup failed, tearing down: ${err?.message ?? err}`);
    await stop();
    throw err;
  }

  return {
    webUrl: `http://localhost:${DEMO_WEB_PORT}`,
    patFile,
    authSecret,
    demoDir,
    login: login ? { email: "demo@pocket.invalid", password: local.SEED_DEMO_PASSWORD } : null,
    stop,
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const keep = process.argv.includes("--keep");
  let demo;
  try {
    demo = await startDemo({ login: true, keep });
    // The throwaway login goes to a private file in the scratch dir (deleted on
    // exit) rather than to the terminal, so it never lands in scrollback or logs.
    const loginFile = path.join(demo.demoDir, "login.txt");
    await writeFile(loginFile, `email    ${demo.login.email}\npassword ${demo.login.password}\n`, {
      mode: 0o600,
    });
    console.log(`
[demo] Pocket demo is up: ${demo.webUrl}
[demo] Throwaway local login (generated for this run): ${loginFile}
[demo] Ctrl-C stops it and deletes all demo data.`);
  } catch (err) {
    // startDemo has already torn down on a startup failure; this covers a
    // failure after it returned. stop() is idempotent either way.
    console.error(`[demo] ${err?.stack ?? err}`);
    await demo?.stop();
    process.exit(1);
  }
}
