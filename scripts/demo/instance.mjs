#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDemoNow } from "./clock.mjs";
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
 * propagates. A stop mid-build or mid-seed kills that step's process group first,
 * and a SIGKILL also takes down the groups the step spawned (turbo's per-task groups).
 * DEMO_HEALTH_TIMEOUT_MS (default 90000) bounds each readiness probe.
 *
 * DEMO_NOW=<ISO instant> moves the clock of the seed, the API and Next to that
 * instant (see ./freeze-time.mjs), so relative dates read the same on any day.
 *
 * `make demo` (handoff) prints `DEMO_READY url=<web url>` once ready and, while it
 * runs, keeps `.demo/instance.json` with a session cookie for the seeded user, for
 * the visual-kit host hook (visual/host-hooks.sh). The file is removed on stop.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BIN = (name) => path.join(REPO_ROOT, "node_modules", ".bin", name);
const API_TSCONFIG = path.join(REPO_ROOT, "services/api/tsconfig.json");
const WEB_DIR = path.join(REPO_ROOT, "apps/web");
const FREEZE_TIME = path.join(REPO_ROOT, "scripts/demo/freeze-time.mjs");
export const HANDOFF_FILE = path.join(REPO_ROOT, ".demo/instance.json");
/** The seeded user's Auth.js subject (DEMO_AUTH_SUB in seed-demo.ts). */
const DEMO_AUTH_SUB = "demo|pocket";

export const DEMO_API_PORT = process.env.DEMO_API_PORT ?? "3910";
export const DEMO_WEB_PORT = process.env.DEMO_WEB_PORT ?? "3915";

const DEFAULT_HEALTH_TIMEOUT_MS = 90_000;
// Node timers (and AbortSignal.timeout) overflow above this and fire at once.
const MAX_TIMER_MS = 2 ** 31 - 1;

/** DEMO_HEALTH_TIMEOUT_MS, validated: how long each readiness probe may take. */
export function healthTimeoutMs(value = process.env.DEMO_HEALTH_TIMEOUT_MS) {
  if (value === undefined || value === "") return DEFAULT_HEALTH_TIMEOUT_MS;
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > MAX_TIMER_MS)
    throw new Error(
      `DEMO_HEALTH_TIMEOUT_MS must be a positive integer (ms) up to ${MAX_TIMER_MS}, got "${value}"`,
    );
  return ms;
}

// Dummy issuer: satisfies the auth plugins' boot guards; never contacted.
const ISSUER = "https://demo.invalid/application/o/pocket-demo/";

/**
 * Run one build/seed step to completion. Own process group (`detached`) so teardown
 * can kill it together with everything it forks (turbo runs tsc per package); a
 * terminal Ctrl-C no longer reaches it directly and goes through onSignal instead.
 * stdin is ignored: a background group reading the terminal would be stopped.
 * `onSpawn` hands the child to the caller for tracking.
 */
function run(cmd, args, opts, onSpawn) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "inherit", "inherit"],
      detached: true,
      ...opts,
    });
    onSpawn?.(child);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${cmd} ${args.join(" ")} ${code === null ? `killed by ${signal}` : `exited ${code}`}`,
            ),
          ),
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

/** Parse `ps -A -o pid=,ppid=,pgid=` output; lines that are not three integers are skipped. */
export function parsePsRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]) });
  }
  return rows;
}

/**
 * The process groups that descend from the `roots` groups in a `ps` snapshot: the
 * groups of every process reachable via parent links from a member of a root group.
 * turbo runs each task (sh, then tsc) in a group of its own, so killing turbo's group
 * misses them. Only finds what is still linked: a task whose parent already exited
 * was reparented and is out of reach (on Linux the /proc HOME sweep covers that).
 * Never returns a root, the caller's own group (`self`'s), or a pgid <= 1:
 * `kill(-0)` would hit the caller's group and `kill(-1)` every process it may signal.
 */
export function descendantGroups(rows, roots, self = process.pid) {
  const rootSet = new Set(roots.filter((pgid) => pgid > 1));
  // pid 0 and init are never anyone's descendant, and a self-parented entry (the
  // kernel's pid 0, some kernel threads) would be its own child. Cycles beyond that
  // are cut by `seen` below: each pid is expanded at most once.
  rows = rows.filter((row) => row.pid > 1 && row.pid !== row.ppid);
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row);
  }
  const ownGroup = rows.find((row) => row.pid === self)?.pgid;
  const seen = new Set();
  const queue = rows.filter((row) => rootSet.has(row.pgid));
  const groups = new Set();
  while (queue.length > 0) {
    const row = queue.pop();
    if (seen.has(row.pid)) continue;
    seen.add(row.pid);
    if (row.pgid > 1 && !rootSet.has(row.pgid) && row.pgid !== ownGroup) groups.add(row.pgid);
    queue.push(...(children.get(row.pid) ?? []));
  }
  return [...groups];
}

/**
 * Descendant groups of `roots` from a live `ps` snapshot. Portable (macOS has no
 * /proc). Synchronous, since the second-Ctrl-C path runs in a signal handler. Fails
 * soft: without a usable `ps`, there is nothing extra to kill.
 */
function snapshotDescendantGroups(roots) {
  try {
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      // It runs inside the second-Ctrl-C handler, ahead of every SIGKILL: a wedged
      // ps must not hold those up for long. 1 s still leaves a loaded host room.
      timeout: 1_000,
    });
    return descendantGroups(parsePsRows(out), roots);
  } catch {
    return [];
  }
}

/**
 * Signal a whole process group. Refuses pgid <= 1 (and anything not a number):
 * `kill(-1)` reaches every process this user may signal, `kill(-0)` the caller's
 * own group, so the guard sits here rather than only in the callers.
 */
export const signalGroup = (pgid, sig) => {
  if (!(Number.isSafeInteger(pgid) && pgid > 1)) return false;
  try {
    process.kill(-pgid, sig);
    return true;
  } catch {
    return false; // Group already gone.
  }
};

/**
 * SIGKILL the given groups plus every group descending from them. The snapshot
 * comes first, while e.g. turbo is still alive and its tasks still list it as their
 * parent. Returns the descendant groups, so the caller can wait for them too.
 */
function hardKillTree(pgids) {
  const descendants = snapshotDescendantGroups(pgids);
  for (const pgid of pgids) signalGroup(pgid, "SIGKILL");
  for (const pgid of descendants) signalGroup(pgid, "SIGKILL");
  if (descendants.length > 0)
    console.log(`[demo] killed descendant process group(s) ${descendants.join(", ")}`);
  return descendants;
}

/**
 * SIGTERM the whole group, wait for it to go, SIGKILL whatever is left, together
 * with the groups it spawned (turbo's per-task groups), which the SIGTERM may not
 * have reached if turbo did not shut them down itself.
 */
async function killGroup(child, graceMs = 5_000) {
  if (!child) return;
  if (!signalGroup(child.pid, "SIGTERM")) return;
  // Done when the direct child has exited and no process in its group remains
  // (signal 0 only probes). next dev writes its config store on the way out.
  const alive = () => child.exitCode === null || signalGroup(child.pid, 0);
  const waitGone = async (ms, done) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !done()) await new Promise((r) => setTimeout(r, 100));
  };
  await waitGone(graceMs, () => !alive());
  if (!alive()) return;
  const descendants = hardKillTree([child.pid]);
  // Let the killed groups actually exit, so the scratch-dir delete does not race them.
  await waitGone(2_000, () => !alive() && !descendants.some((pgid) => signalGroup(pgid, 0)));
}

/**
 * Processes that escaped their process group but still run with this demo's
 * scratch HOME (unique per run), found via /proc on Linux. `next dev` spawns its
 * telemetry flush `detached` on exit, even with NEXT_TELEMETRY_DISABLED, and that
 * process recreates HOME/.config/nextjs-nodejs after the scratch dir is deleted.
 */
export function strayPids(home) {
  if (process.platform !== "linux") return [];
  const marker = `\0HOME=${home}\0`;
  const pids = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      if (`\0${readFileSync(`/proc/${entry}/environ`, "latin1")}`.includes(marker))
        pids.push(Number(entry));
    } catch {
      // Gone already, or not ours to read.
    }
  }
  return pids;
}

/** Whether any process in the child's process group is still alive (signal 0 only probes). */
const groupAlive = (child) => signalGroup(child.pid, 0);

const signalPid = (pid, sig) => {
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false; // Already gone.
  }
};

/** SIGTERM the strays, wait for them to go, SIGKILL whatever is left. */
async function killStrays(home, graceMs = 2_000) {
  const pids = strayPids(home);
  if (pids.length === 0) return;
  console.log(`[demo] stopping ${pids.length} process(es) left outside the server groups`);
  for (const pid of pids) signalPid(pid, "SIGTERM");
  const waitGone = async (ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && pids.some((pid) => signalPid(pid, 0)))
      await new Promise((r) => setTimeout(r, 50));
  };
  await waitGone(graceMs);
  for (const pid of pids) signalPid(pid, "SIGKILL");
  await waitGone(1_000);
}

export async function waitForHttp(url, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      // Bound each request too: a server that accepts but never answers would
      // otherwise hold the loop past the deadline (undici's own limit is 5 min).
      const remaining = Math.max(1, timeoutMs - (Date.now() - start));
      const res = await fetch(url, { signal: AbortSignal.timeout(remaining) });
      if (res.status < 500) return;
    } catch (err) {
      lastError = err;
    }
    const left = timeoutMs - (Date.now() - start);
    if (left > 0) await new Promise((r) => setTimeout(r, Math.min(500, left)));
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError}` : ""}`);
}

/**
 * The real startup sequence: build, seed, start both servers, wait until ready.
 * `run` is startDemo's tracked step runner, so a stop mid-build or mid-seed kills
 * the step's process group instead of deleting the scratch dir under it.
 */
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
  run,
}) {
  // The API and web import the workspace packages from their dist/ builds, the
  // same as `turbo dev` (dependsOn ^build). Cached by turbo, so this is quick.
  console.log("[demo] building workspace packages...");
  await run(BIN("turbo"), ["run", "build", "--filter=./packages/*", "--output-logs=errors-only"], {
    cwd: REPO_ROOT,
    env: demoEnv(demoDir, { TURBO_TELEMETRY_DISABLED: "1" }),
  });
  // One real base for every process, taken just before the seed: they all read the
  // same "now" (DEMO_NOW at seed start, ticking), and the seed's data is never in
  // the API's future.
  if (seedEnv.DEMO_NOW) {
    const base = String(Date.now());
    for (const env of [seedEnv, apiEnv, webEnv]) env.DEMO_CLOCK_BASE = base;
  }
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
 * Write `.demo/instance.json`: the web URL and a session cookie minted from the
 * demo's own PAT and AUTH_SECRET, the same forged cookie the old capture script
 * used. Private (0600), and gone when the demo stops.
 */
async function writeHandoff({ webUrl, patFile, authSecret }) {
  const { mintSessionCookie } = await import("../../apps/web/scripts/mint-session.mjs");
  const cookie = await mintSessionCookie({
    patSecret: (await readFile(patFile, "utf8")).trim(),
    authSub: DEMO_AUTH_SUB,
    secret: authSecret,
  });
  await mkdir(path.dirname(HANDOFF_FILE), { recursive: true });
  await writeFile(HANDOFF_FILE, `${JSON.stringify({ webUrl, cookie }, null, 2)}\n`, {
    mode: 0o600,
  });
}

/**
 * Start the demo. `login: true` also seeds a local-password user (throwaway
 * credentials, generated per run) so a human can sign in from a browser.
 *
 * `handoff` keeps `.demo/instance.json` (web URL and a session cookie) while the
 * demo runs. `demoNow` (default $DEMO_NOW) fixes the clock of the seed and servers.
 *
 * `boot` replaces the build/seed/spawn/wait sequence; tests use it to fail
 * startup without running the real servers.
 */
export async function startDemo({
  login = false,
  quiet = false,
  keep = false,
  handoff = false,
  boot,
  demoNow = process.env.DEMO_NOW,
} = {}) {
  // Refused before anything is created: nothing to tear down yet.
  const timeoutMs = healthTimeoutMs();
  parseDemoNow(demoNow);
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
  /**
   * Build/seed steps (each its own process group) whose group is still alive: the
   * running one, plus any whose direct child exited while a subprocess lingers.
   */
  const steps = new Set();
  /** Servers plus live step groups: every group a stop has to take down. */
  const groups = () => [...children, ...steps];
  const home = path.join(demoDir, "home");
  let stopping;
  const teardown = async () => {
    // Wait for every process to exit first: dying next dev workers otherwise
    // recreate files under the scratch HOME after it was deleted.
    // That includes an in-flight build/seed step (turbo, tsx and their children):
    // tracked explicitly, so this works without the Linux-only /proc sweep below.
    await Promise.all(groups().map((child) => killGroup(child)));
    // Then anything they spawned outside their groups (Next's telemetry flush).
    await killStrays(home);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (handoff) rmSync(HANDOFF_FILE, { force: true });
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
  // Installed before anything is spawned: the build/seed steps and the servers run
  // in their own process groups, out of reach of the terminal's Ctrl-C, so without
  // this a Ctrl-C during the build or boot would orphan them.
  // They stay registered until all groups are gone; a second Ctrl-C during the
  // grace period skips it and SIGKILLs the groups instead of leaving them behind.
  function onSignal() {
    if (stopping) {
      // Snapshot, so the wait below covers every group signalled here, including
      // the groups they spawned (turbo's per-task groups).
      const tracked = groups().map((child) => child.pid);
      const targets = [...tracked, ...hardKillTree(tracked)];
      // Give the killed groups a moment to exit, or a dying next dev worker
      // recreates its config store under HOME right after the delete.
      const deadline = Date.now() + 2_000;
      let attempts = 0;
      const finish = () => {
        if (targets.some((pgid) => signalGroup(pgid, 0)) && Date.now() < deadline)
          return setTimeout(finish, 50);
        if (handoff) rmSync(HANDOFF_FILE, { force: true });
        if (keep) process.exit(130);
        // As in teardown: a dying worker can recreate files just after the
        // delete, so repeat it a few times before exiting.
        for (const pid of strayPids(home)) signalPid(pid, "SIGKILL");
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

  /**
   * run() with the step's group tracked, so a stop kills it; refuses once stopping.
   * Untracked once the whole group is gone (only then can its id be reused), so a
   * subprocess that outlives the direct child is still hard-killed by a second
   * Ctrl-C.
   */
  const runStep = async (cmd, args, opts) => {
    if (stopping) throw new Error("demo is stopping; not starting more steps");
    let child;
    try {
      await run(cmd, args, opts, (spawned) => steps.add((child = spawned)));
    } finally {
      if (child && !groupAlive(child)) steps.delete(child);
    }
  };

  const webUrl = `http://localhost:${DEMO_WEB_PORT}`;
  // A leftover from a run that was SIGKILLed: its cookie belongs to a dead instance.
  if (handoff) rmSync(HANDOFF_FILE, { force: true });

  // Everything from here on runs under the same teardown as a normal stop, so a
  // failure at any step (env guard, build, seed, boot, readiness) leaves no
  // scratch dir or process group behind.
  try {
    console.log(`[demo] scratch dir ${demoDir}`);
    for (const dir of ["home", "tmp", "run"])
      await mkdir(path.join(demoDir, dir), { recursive: true });

    // The preload is applied through NODE_OPTIONS so it reaches tsx's and Next's
    // child processes too.
    const clock = demoNow
      ? { DEMO_NOW: demoNow, NODE_OPTIONS: `--import ${pathToFileURL(FREEZE_TIME).href}` }
      : {};
    const seedEnv = demoEnv(demoDir, {
      DATABASE_URL: databaseUrl,
      FX_PROVIDER: "none",
      ...clock,
      ...local,
    });
    const apiEnv = demoEnv(demoDir, {
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
      AUTHENTIK_ISSUER: ISSUER,
      AUTHENTIK_AUDIENCE: "pocket-demo",
      // Never stale, so prices come from the seeded cache, never a live provider.
      MARKET_DATA_TTL_MS: "999999999",
      // Same for FX: the seeded daily rates are the whole table; never fetch live ones.
      FX_PROVIDER: "none",
      // Playwright plus Next's background polling exceed the default 100 req/min.
      RATE_LIMIT_MAX: "100000",
      PORT: DEMO_API_PORT,
      HOST: "127.0.0.1",
      LOG_LEVEL: "warn",
      // Local folder storage: the default S3 backend would try to reach (and,
      // outside production, create a bucket on) an object store.
      STORAGE_PROVIDER: "folder",
      STORAGE_FOLDER_PATH: path.join(demoDir, "storage"),
      ...clock,
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
      ...clock,
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
      run: runStep,
      stop,
    });
    if (handoff) await writeHandoff({ webUrl, patFile, authSecret });
  } catch (err) {
    // A stop (Ctrl-C/SIGTERM) mid-step fails the step it killed; that is no startup failure.
    if (!stopping) console.error(`[demo] startup failed, tearing down: ${err?.message ?? err}`);
    await stop();
    throw err;
  }

  return {
    webUrl,
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
    demo = await startDemo({ login: true, keep, handoff: true });
    // The throwaway login goes to a private file in the scratch dir (deleted on
    // exit) rather than to the terminal, so it never lands in scrollback or logs.
    const loginFile = path.join(demo.demoDir, "login.txt");
    await writeFile(loginFile, `email    ${demo.login.email}\npassword ${demo.login.password}\n`, {
      mode: 0o600,
    });
    console.log(`
[demo] Pocket demo is up: ${demo.webUrl}
[demo] Throwaway local login (generated for this run): ${loginFile}
[demo] Ctrl-C stops it and deletes all demo data.
DEMO_READY url=${demo.webUrl}`);
  } catch (err) {
    // startDemo has already torn down on a startup failure; this covers a
    // failure after it returned. stop() is idempotent either way.
    console.error(`[demo] ${err?.stack ?? err}`);
    await demo?.stop();
    process.exit(1);
  }
}
