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

/** Every file `next dev` would read from its working directory. */
export const NEXT_ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"];

const inside = (dir, p) => {
  const rel = path.relative(dir, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * Throws if `env` could reach anything outside `demoDir`. Returns the list of
 * problems instead when `collect` is true (used by the tests).
 *
 * `api` marks the API server's env, which must use folder storage.
 * `cwd` is where the process will run. A plain process must not find a `.env`
 * there. For `nextApp`, the `.env*` files are expected on a dev box (the
 * `make web-env` symlink), so finding one is only a warning, as long as
 * `__NEXT_PROCESSED_ENV` is set: @next/env then skips merging them. Without it
 * they are refused. `scripts/demo/env.test.mjs` fails if the installed
 * @next/env stops honouring that flag.
 */
export function assertDemoEnv(
  env,
  demoDir,
  { cwd, nextApp = false, api = false, collect = false } = {},
) {
  const problems = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith("MULLION_")) problems.push(`${key} must not reach the demo`);
    if (SECRET_KEY.test(key) && !GENERATED_SECRETS.has(key))
      problems.push(`${key} looks like a real secret; the demo never sets it`);
    if (
      PATH_KEY.test(key) &&
      !PATH_ALLOW.has(key) &&
      // Relative values resolve against the process's working directory.
      !inside(demoDir, path.resolve(cwd ?? demoDir, value))
    )
      problems.push(`${key}=${value} is outside the demo dir`);
  }
  const db = env.DATABASE_URL;
  if (db !== undefined) {
    const local = db.startsWith("pglite://") ? db.slice("pglite://".length) : null;
    if (!local || !inside(demoDir, path.resolve(local)))
      problems.push("DATABASE_URL must be a pglite:// path inside the demo dir");
  }
  // The API's default storage backend is S3; anything but the local folder
  // would reach an object store. This checks the env only: a storage_settings
  // row would override it, but the scratch DB is created fresh on every run and
  // the demo seed never writes one. (STORAGE_FOLDER_PATH must be inside the demo
  // dir like every other *_PATH, checked above.)
  if (api && env.STORAGE_PROVIDER !== "folder")
    problems.push("the API must use STORAGE_PROVIDER=folder (inside the demo dir)");
  for (const key of ["HOME", "TMPDIR"])
    if (!env[key] || !inside(demoDir, env[key]))
      problems.push(`${key} must be inside the demo dir`);
  if (cwd && !nextApp && existsSync(path.join(cwd, ".env")))
    problems.push(`${cwd} contains a .env that the process would load`);
  const nextFiles =
    cwd && nextApp ? NEXT_ENV_FILES.filter((f) => existsSync(path.join(cwd, f))) : [];
  if (nextFiles.length > 0) {
    if (env.__NEXT_PROCESSED_ENV !== "true")
      problems.push(`${cwd} has ${nextFiles.join(", ")} and Next is not told to skip them`);
    else if (!collect)
      console.warn(
        `[demo] ignoring ${nextFiles.join(", ")} in ${cwd} (__NEXT_PROCESSED_ENV is set)`,
      );
  }

  if (collect) return problems;
  if (problems.length > 0)
    throw new Error(`demo environment refused:\n  - ${problems.join("\n  - ")}`);
  return [];
}

/**
 * Rejects if something already listens on one of the ports (likely a real
 * instance). Probes IPv4 and IPv6 loopback, so a server bound to either is seen.
 */
export async function assertPortsFree(ports, hosts = ["127.0.0.1", "::1"]) {
  const listening = (port, host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port: Number(port), host });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
  for (const port of ports)
    for (const host of hosts)
      if (await listening(port, host))
        throw new Error(`port ${port} is already in use on ${host}; refusing to start the demo`);
}
