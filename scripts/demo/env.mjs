import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Environment isolation for the demo instance and the screenshot pipeline.
 *
 * The demo must never see production or developer secrets. Two things on a dev
 * box would otherwise leak them in:
 *  - the API's @fastify/env loads `.env` from its working directory (the repo
 *    root holds the real one), and
 *  - Next.js loads `apps/web/.env.local`, which `make web-env` symlinks to the
 *    same file.
 * So every demo process gets an environment built from scratch (nothing is
 * inherited except a short allowlist), the API runs from a scratch directory
 * with no `.env`, and Next is told its env is already processed. `assertDemoEnv`
 * then refuses to start if anything still points outside the scratch directory.
 */

/** Inherited from the caller; everything else is dropped. */
const PASSTHROUGH = ["PATH", "LANG", "LC_ALL", "TERM", "TZ"];

/** Secret-looking keys the demo is allowed to set, always with generated values. */
const GENERATED_SECRETS = new Set([
  "AUTH_SECRET",
  "AUTH_LOCAL_SECRET",
  "AUTHENTIK_CLIENT_SECRET",
  "SEED_DEMO_PASSWORD",
]);

const SECRET_KEY = /(SECRET|PASSWORD|_KEY|_TOKEN|_PAT)$|ENCRYPTION/;
const PATH_KEY = /(_DIR|_PATH|_FILE)$/;
/** Path-ish keys that legitimately point outside the scratch dir. */
const PATH_ALLOW = new Set(["PLAYWRIGHT_BROWSERS_PATH", "SCREENSHOTS_OUT_DIR"]);

/** Where Playwright keeps its browsers, resolved before HOME is redirected. */
export function playwrightBrowsersPath(parent = process.env) {
  return parent.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), ".cache", "ms-playwright");
}

/**
 * A clean environment for a demo child process. HOME and TMPDIR point into the
 * scratch dir so no tool falls back to a real config directory.
 */
export function demoEnv(demoDir, vars = {}, parent = process.env) {
  const env = {};
  for (const key of PASSTHROUGH) if (parent[key] !== undefined) env[key] = parent[key];
  return {
    ...env,
    HOME: path.join(demoDir, "home"),
    TMPDIR: path.join(demoDir, "tmp"),
    // Tells Next.js the env is already loaded, so it skips every .env* file
    // (including the apps/web/.env.local symlink). Harmless for other processes.
    __NEXT_PROCESSED_ENV: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    ...vars,
  };
}

const inside = (dir, p) => {
  const rel = path.relative(dir, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * Throws if `env` could reach anything outside `demoDir`. Returns the list of
 * problems instead when `collect` is true (used by the tests).
 */
export function assertDemoEnv(env, demoDir, { cwd, collect = false } = {}) {
  const problems = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith("MULLION_")) problems.push(`${key} must not reach the demo`);
    if (SECRET_KEY.test(key) && !GENERATED_SECRETS.has(key))
      problems.push(`${key} looks like a real secret; the demo never sets it`);
    if (
      PATH_KEY.test(key) &&
      !PATH_ALLOW.has(key) &&
      path.isAbsolute(value) &&
      !inside(demoDir, value)
    )
      problems.push(`${key}=${value} is outside the demo dir`);
  }
  const db = env.DATABASE_URL;
  if (db !== undefined) {
    const local = db.startsWith("pglite://") ? db.slice("pglite://".length) : null;
    if (!local || !inside(demoDir, path.resolve(local)))
      problems.push("DATABASE_URL must be a pglite:// path inside the demo dir");
  }
  for (const key of ["HOME", "TMPDIR"])
    if (!env[key] || !inside(demoDir, env[key]))
      problems.push(`${key} must be inside the demo dir`);
  if (cwd && existsSync(path.join(cwd, ".env")))
    problems.push(`${cwd} contains a .env that the API would load`);

  if (collect) return problems;
  if (problems.length > 0)
    throw new Error(`demo environment refused:\n  - ${problems.join("\n  - ")}`);
  return [];
}

/** Rejects if something already listens on one of the ports (likely a real instance). */
export async function assertPortsFree(ports, host = "127.0.0.1") {
  for (const port of ports) {
    const busy = await new Promise((resolve) => {
      const socket = net.connect({ port: Number(port), host });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (busy) throw new Error(`port ${port} is already in use; refusing to start the demo`);
  }
}
