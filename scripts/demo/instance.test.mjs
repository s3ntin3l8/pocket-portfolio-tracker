import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** A port nothing listens on right now, so assertPortsFree passes. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(String(port)));
    });
  });

const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

// The scratch dirs go under a private TMPDIR (os.tmpdir() reads it per call), and
// the ports are module-level constants, so both are set before the import.
const ENV_KEYS = ["TMPDIR", "DEMO_API_PORT", "DEMO_WEB_PORT", "DEMO_HEALTH_TIMEOUT_MS"];
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const scratchRoot = mkdtempSync(path.join(tmpdir(), "pocket-demo-instance-test-"));
let startDemo;
let strayPids;
let waitForHttp;
let healthTimeoutMs;

beforeAll(async () => {
  process.env.TMPDIR = scratchRoot;
  process.env.DEMO_API_PORT = await freePort();
  process.env.DEMO_WEB_PORT = await freePort();
  ({ startDemo, healthTimeoutMs, strayPids, waitForHttp } = await import("./instance.mjs"));
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  rmSync(scratchRoot, { recursive: true, force: true });
});

describe("startDemo startup failure", () => {
  it("kills the started process groups and removes the scratch dir", async () => {
    const listeners = process.listenerCount("SIGINT");
    let demoDir;
    let pid;
    const failure = new Error("Timed out waiting for http://127.0.0.1:3910/health");
    process.env.DEMO_HEALTH_TIMEOUT_MS = "4321";

    await expect(
      startDemo({
        quiet: true,
        boot: async (ctx) => {
          demoDir = ctx.demoDir;
          expect(ctx.timeoutMs).toBe(4321);
          // Stands in for the API: a long-lived server in its own process group.
          const child = ctx.spawnServer(
            "api",
            process.execPath,
            ["-e", "setInterval(() => {}, 1000)"],
            { cwd: ctx.runDir, env: ctx.apiEnv },
            true,
          );
          pid = child.pid;
          expect(existsSync(path.join(demoDir, "home"))).toBe(true);
          expect(groupAlive(pid)).toBe(true);
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    delete process.env.DEMO_HEALTH_TIMEOUT_MS;

    expect(demoDir.startsWith(scratchRoot)).toBe(true);
    expect(existsSync(demoDir)).toBe(false);
    expect(groupAlive(pid)).toBe(false);
    expect(readdirSync(scratchRoot)).toEqual([]);
    expect(process.listenerCount("SIGINT")).toBe(listeners);
  }, 20_000);

  it("refuses to start a server once a stop is in progress", async () => {
    let demoDir;
    await expect(
      startDemo({
        quiet: true,
        boot: async (ctx) => {
          demoDir = ctx.demoDir;
          // As if a SIGTERM arrived during the build: teardown has begun.
          const stopping = ctx.stop();
          expect(() =>
            ctx.spawnServer("api", process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
              cwd: ctx.runDir,
              env: ctx.apiEnv,
            }),
          ).toThrow(/stopping/);
          await stopping;
          throw new Error("build interrupted");
        },
      }),
    ).rejects.toThrow("build interrupted");
    expect(existsSync(demoDir)).toBe(false);
  }, 20_000);

  // Like Next's telemetry flush: spawned `detached` (its own group, so killGroup
  // misses it) with the scratch HOME, and it keeps recreating HOME/.config.
  it.skipIf(process.platform !== "linux")(
    "kills an escaped process still using the scratch HOME before deleting",
    async () => {
      let demoDir;
      let stray;
      try {
        await expect(
          startDemo({
            quiet: true,
            boot: async (ctx) => {
              demoDir = ctx.demoDir;
              stray = spawn(
                process.execPath,
                [
                  "-e",
                  `const fs = require("fs"), p = require("path");
                   setInterval(() => fs.mkdirSync(p.join(process.env.HOME, ".config/nextjs-nodejs"), { recursive: true }), 50);`,
                ],
                { detached: true, stdio: "ignore", env: ctx.webEnv },
              );
              // Wait (bounded) for it to start writing; node startup is slow under load.
              const config = path.join(demoDir, "home/.config/nextjs-nodejs");
              for (let i = 0; i < 100 && !existsSync(config); i++)
                await new Promise((r) => setTimeout(r, 50));
              expect(existsSync(config)).toBe(true);
              expect(strayPids(path.join(demoDir, "home"))).toContain(stray.pid);
              throw new Error("boot failed");
            },
          }),
        ).rejects.toThrow("boot failed");

        expect(existsSync(demoDir)).toBe(false);
        expect(groupAlive(stray.pid)).toBe(false);
        // Stays gone: nothing is left to recreate it.
        await new Promise((r) => setTimeout(r, 300));
        expect(existsSync(demoDir)).toBe(false);
      } finally {
        if (stray && groupAlive(stray.pid)) process.kill(-stray.pid, "SIGKILL");
      }
    },
    20_000,
  );

  it("refuses a bad DEMO_HEALTH_TIMEOUT_MS before creating anything", async () => {
    process.env.DEMO_HEALTH_TIMEOUT_MS = "soon";
    try {
      await expect(startDemo({ boot: () => {} })).rejects.toThrow(/DEMO_HEALTH_TIMEOUT_MS/);
    } finally {
      delete process.env.DEMO_HEALTH_TIMEOUT_MS;
    }
    expect(readdirSync(scratchRoot)).toEqual([]);
  });
});

describe("waitForHttp", () => {
  it("gives up at the deadline even if the server accepts but never answers", async () => {
    const sockets = new Set();
    const server = net.createServer((s) => sockets.add(s));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const start = Date.now();
    try {
      await expect(
        waitForHttp(`http://127.0.0.1:${server.address().port}/health`, 600),
      ).rejects.toThrow(/Timed out waiting/);
      expect(Date.now() - start).toBeLessThan(3_000);
    } finally {
      for (const s of sockets) s.destroy();
      server.close();
    }
  });
});

describe("healthTimeoutMs", () => {
  it("defaults to 90 s and accepts a positive integer", () => {
    expect(healthTimeoutMs(undefined)).toBe(90_000);
    expect(healthTimeoutMs("")).toBe(90_000);
    expect(healthTimeoutMs("240000")).toBe(240_000);
  });

  it.each(["0", "-5", "1.5", "abc", "1e400", String(2 ** 31)])("rejects %s", (value) => {
    expect(() => healthTimeoutMs(value)).toThrow(/positive integer/);
  });
});
