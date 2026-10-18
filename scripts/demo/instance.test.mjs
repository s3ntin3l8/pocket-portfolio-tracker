import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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
// Created in beforeAll, not at import: a file that fails to collect runs no
// afterAll, so a module-level mkdtemp would leak the directory.
let scratchRoot;
let startDemo;
let strayPids;
let waitForHttp;
let healthTimeoutMs;
let parsePsRows;
let descendantGroups;
let signalGroup;

beforeAll(async () => {
  scratchRoot = mkdtempSync(path.join(tmpdir(), "pocket-demo-instance-test-"));
  process.env.TMPDIR = scratchRoot;
  process.env.DEMO_API_PORT = await freePort();
  // Each probe listener closes before the next binds, so the OS may hand back the same one.
  for (let attempt = 0; ; attempt++) {
    process.env.DEMO_WEB_PORT = await freePort();
    if (process.env.DEMO_WEB_PORT !== process.env.DEMO_API_PORT) break;
    if (attempt >= 10) throw new Error("could not get two distinct free ports");
  }
  ({
    startDemo,
    healthTimeoutMs,
    strayPids,
    waitForHttp,
    parsePsRows,
    descendantGroups,
    signalGroup,
  } = await import("./instance.mjs"));
});

// Tests set it per case; never let a failed assertion leak it into the next one.
afterEach(() => {
  if (saved.DEMO_HEALTH_TIMEOUT_MS === undefined) delete process.env.DEMO_HEALTH_TIMEOUT_MS;
  else process.env.DEMO_HEALTH_TIMEOUT_MS = saved.DEMO_HEALTH_TIMEOUT_MS;
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true });
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
          // Nor another build/seed step.
          await expect(ctx.run(process.execPath, ["-e", ""], { cwd: ctx.runDir })).rejects.toThrow(
            /stopping/,
          );
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

/**
 * Runs startDemo in its own node process (a real SIGTERM there must not hit the test
 * worker) with a boot that runs one long build/seed-like step through ctx.run. The
 * step forks a grandchild, as turbo does, and both keep recreating a file under the
 * scratch dir, so either one outliving the delete brings the dir back. Neither carries
 * the scratch HOME, so the /proc HOME sweep cannot find them: only explicit tracking can.
 * `taskGroup` puts the grandchild in a process group of its own, as turbo does with
 * each task, so killing the step's group does not reach it.
 */
function bootWithLongStep({ ignoreTerm = "none", taskGroup = false, driverEnv = {} } = {}) {
  // Each process recreates its own marker dir, so ready() can wait for both: a
  // marker only appears once that process has installed its SIGTERM handler.
  const keepTouching = (ignore, marker) => `
    const fs = require("fs"), path = require("path");
    ${ignore ? 'process.on("SIGTERM", () => {});' : ""}
    setInterval(() => fs.mkdirSync(path.join(process.env.DEMO_DIR, "home", "${marker}"), { recursive: true }), 50);`;
  const grandchildCode = keepTouching(ignoreTerm !== "none", "grandchild");
  const step = `
    const { spawn } = require("child_process");
    const grandchild = spawn(process.execPath, ["-e", ${JSON.stringify(grandchildCode)}], { stdio: "ignore", detached: ${taskGroup} });
    console.log("PIDS " + process.pid + " " + grandchild.pid);
    ${keepTouching(ignoreTerm === "both", "step")}`;
  const driver = `
    const { startDemo } = await import(${JSON.stringify(new URL("./instance.mjs", import.meta.url).href)});
    await startDemo({
      quiet: true,
      boot: async (ctx) => {
        console.log("DEMO_DIR " + ctx.demoDir);
        await ctx.run(process.execPath, ["-e", ${JSON.stringify(step)}], {
          env: { PATH: process.env.PATH, DEMO_DIR: ctx.demoDir },
        });
      },
    });`;
  const proc = spawn(process.execPath, ["--input-type=module", "-e", driver], {
    env: { ...process.env, ...driverEnv },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  const exited = new Promise((resolve) => proc.on("exit", (code) => resolve(code)));
  const ready = async () => {
    // Bounded, but generous: three node startups under a loaded host.
    for (let i = 0; i < 600; i++) {
      const dir = /DEMO_DIR (\S+)/.exec(out)?.[1];
      const pids = /PIDS (\d+) (\d+)/.exec(out)?.slice(1).map(Number);
      const markers = ["home/step", "home/grandchild"].map((m) => path.join(dir ?? "", m));
      if (dir && pids && markers.every((m) => existsSync(m))) return { demoDir: dir, pids };
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`long step never started; driver output: ${out}`);
  };
  return { proc, exited, ready };
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("startDemo stop during a build/seed step", () => {
  it("SIGTERM terminates the in-flight step and its subprocesses before removing the scratch dir", async () => {
    const { proc, exited, ready } = bootWithLongStep();
    let pids = [];
    try {
      const started = await ready();
      pids = started.pids;
      expect(pids.every(pidAlive)).toBe(true);
      proc.kill("SIGTERM");
      expect(await exited).toBe(0);
      expect(pids.some(pidAlive)).toBe(false);
      expect(existsSync(started.demoDir)).toBe(false);
      // Stays gone: nothing is left to recreate it.
      await new Promise((r) => setTimeout(r, 300));
      expect(existsSync(started.demoDir)).toBe(false);
    } finally {
      proc.kill("SIGKILL");
      for (const pid of pids) if (pidAlive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 60_000);

  it("a second signal hard-kills a step that ignores SIGTERM, without waiting out the grace period", async () => {
    const { proc, exited, ready } = bootWithLongStep({ ignoreTerm: "both" });
    let pids = [];
    try {
      const started = await ready();
      pids = started.pids;
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      const second = Date.now();
      proc.kill("SIGINT");
      expect(await exited).toBe(130);
      // Well inside killGroup's 5 s grace: the second signal did not wait for it.
      expect(Date.now() - second).toBeLessThan(4_500);
      expect(pids.some(pidAlive)).toBe(false);
      expect(existsSync(started.demoDir)).toBe(false);
    } finally {
      proc.kill("SIGKILL");
      for (const pid of pids) if (pidAlive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 60_000);

  // The step's direct child exits on SIGTERM, but a subprocess in its group ignores
  // it: the group must stay tracked, so the second signal still hard-kills it.
  it("a second signal hard-kills a step subprocess that outlived the step itself", async () => {
    const { proc, exited, ready } = bootWithLongStep({ ignoreTerm: "grandchild" });
    let pids = [];
    try {
      const started = await ready();
      pids = started.pids;
      const [stepPid, grandchildPid] = pids;
      proc.kill("SIGTERM");
      for (let i = 0; i < 100 && pidAlive(stepPid); i++)
        await new Promise((r) => setTimeout(r, 50));
      expect(pidAlive(stepPid)).toBe(false);
      expect(pidAlive(grandchildPid)).toBe(true);
      proc.kill("SIGINT");
      expect(await exited).toBe(130);
      expect(pidAlive(grandchildPid)).toBe(false);
      expect(existsSync(started.demoDir)).toBe(false);
    } finally {
      proc.kill("SIGKILL");
      for (const pid of pids) if (pidAlive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 60_000);
});

// turbo runs each task in a process group of its own. If turbo is SIGKILLed while
// its tasks still run, they would outlive it; neither carries the scratch HOME here,
// so only the process-tree walk before the SIGKILL can find them (#1035).
describe("startDemo stop during a build step whose subprocess has its own group", () => {
  it("the SIGKILL after the grace period also kills the step's descendant groups", async () => {
    const { proc, exited, ready } = bootWithLongStep({ ignoreTerm: "both", taskGroup: true });
    let pids = [];
    try {
      const started = await ready();
      pids = started.pids;
      const [stepPid, taskPid] = pids;
      expect(groupAlive(taskPid)).toBe(true);
      expect(taskPid).not.toBe(stepPid);
      proc.kill("SIGTERM");
      expect(await exited).toBe(0);
      expect(pids.some(pidAlive)).toBe(false);
      expect(existsSync(started.demoDir)).toBe(false);
      await new Promise((r) => setTimeout(r, 300));
      expect(existsSync(started.demoDir)).toBe(false);
    } finally {
      proc.kill("SIGKILL");
      for (const pid of pids) if (pidAlive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 60_000);

  it("a second signal also hard-kills the step's descendant groups", async () => {
    const { proc, exited, ready } = bootWithLongStep({ ignoreTerm: "both", taskGroup: true });
    let pids = [];
    try {
      const started = await ready();
      pids = started.pids;
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      proc.kill("SIGINT");
      expect(await exited).toBe(130);
      expect(pids.some(pidAlive)).toBe(false);
      expect(existsSync(started.demoDir)).toBe(false);
      await new Promise((r) => setTimeout(r, 300));
      expect(existsSync(started.demoDir)).toBe(false);
    } finally {
      proc.kill("SIGKILL");
      for (const pid of pids) if (pidAlive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 60_000);
  // Fails soft: without `ps` the walk finds nothing, and the step's own group is
  // still killed as before.
  it("without a usable ps, still hard-kills the step's own group", async () => {
    const noPs = mkdtempSync(path.join(scratchRoot, "no-ps-"));
    const { proc, exited, ready } = bootWithLongStep({
      ignoreTerm: "both",
      driverEnv: { PATH: noPs },
    });
    let pids = [];
    try {
      const started = await ready();
      pids = started.pids;
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      proc.kill("SIGINT");
      expect(await exited).toBe(130);
      expect(pids.some(pidAlive)).toBe(false);
      expect(existsSync(started.demoDir)).toBe(false);
    } finally {
      proc.kill("SIGKILL");
      for (const pid of pids) if (pidAlive(pid)) process.kill(pid, "SIGKILL");
      rmSync(noPs, { recursive: true, force: true });
    }
  }, 60_000);

  // The other half of the fail-soft contract: without `ps` there is no tree to walk,
  // so a task group of its own is left behind by design (the old behaviour), and
  // only the step's own group is killed.
  it("without a usable ps, leaves a separate task group alone", async () => {
    const noPs = mkdtempSync(path.join(scratchRoot, "no-ps-"));
    const { proc, exited, ready } = bootWithLongStep({
      ignoreTerm: "both",
      taskGroup: true,
      driverEnv: { PATH: noPs },
    });
    let pids = [];
    let demoDir;
    try {
      const started = await ready();
      ({ pids, demoDir } = started);
      const [stepPid, taskPid] = pids;
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      proc.kill("SIGINT");
      expect(await exited).toBe(130);
      expect(pidAlive(stepPid)).toBe(false);
      // The whole task group survives, not just its leader.
      expect(groupAlive(taskPid)).toBe(true);
    } finally {
      proc.kill("SIGKILL");
      for (const pid of pids) if (pidAlive(pid)) process.kill(pid, "SIGKILL");
      for (let i = 0; i < 40 && pids.some(pidAlive); i++)
        await new Promise((r) => setTimeout(r, 50));
      if (demoDir) rmSync(demoDir, { recursive: true, force: true });
      rmSync(noPs, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("signalGroup", () => {
  // Probing with signal 0 is harmless, and kill(-1, 0) would succeed for any user,
  // so a pass means the guard refused before reaching kill().
  it.each([1, 0, -1, -4242, Number.NaN, 1.5, undefined])("refuses pgid %s", (pgid) => {
    expect(signalGroup(pgid, 0)).toBe(false);
  });

  it("signals a real group, and reports one that is gone", () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
    try {
      expect(signalGroup(child.pid, 0)).toBe(true);
    } finally {
      process.kill(-child.pid, "SIGKILL");
    }
    expect(signalGroup(4_194_000, 0)).toBe(false);
  });
});

// Fixture `ps -A -o pid=,ppid=,pgid=` output: ps right-aligns its columns.
const PS_FIXTURE = `
    1     0     1
  500     1   500
  600   500   600
  100   600   100
  101   100   100
  102   101   100
  200   100   200
  201   200   200
  300   100   300
  310   300   310
  311   310   311
  320   300   300
  400   102   102
  700     1   700
  701   700   700
  702   700   702
  800     1     0
  801   102     0
 ps: something went wrong
  abc   100   100
  900   100
  901   100   901   extra
  902  -100   902
 1e3   100   100
  903   102   600
`;

describe("parsePsRows", () => {
  it("parses right-aligned rows and skips malformed lines", () => {
    const rows = parsePsRows(PS_FIXTURE);
    expect(rows).toContainEqual({ pid: 1, ppid: 0, pgid: 1 });
    expect(rows).toContainEqual({ pid: 102, ppid: 101, pgid: 100 });
    for (const pid of [900, 901, 902, 1000])
      expect(rows.some((row) => row.pid === pid)).toBe(false);
    expect(rows.some((row) => Number.isNaN(row.pid))).toBe(false);
    // 19 well-formed rows; the 6 malformed lines are gone.
    expect(rows).toHaveLength(19);
  });

  it("returns nothing for empty or unparsable output", () => {
    expect(parsePsRows("")).toEqual([]);
    expect(parsePsRows("ps: illegal option -- A\nusage: ps ...\n")).toEqual([]);
  });
});

describe("descendantGroups", () => {
  // The demo node (600) runs in its parent's group 600; the step it spawned is
  // turbo (100, own group 100), whose tasks run in groups 200 and 300, and task 300
  // forks a nested group 310 (which forks 311). 400 joined group 102, which has no
  // leader in the tree. 700's family is unrelated; 800/801 sit in pgid 0.
  let rows;
  beforeAll(() => {
    rows = parsePsRows(PS_FIXTURE);
  });
  const sorted = (list) => [...list].sort((a, b) => a - b);

  it("collects every group descending from the root group, nested ones included", () => {
    expect(sorted(descendantGroups(rows, [100], 600))).toEqual([102, 200, 300, 310, 311]);
  });

  it("never returns the root, the caller's own group, init's or pgid 0", () => {
    const groups = descendantGroups(rows, [100], 600);
    // 903 is a descendant (child of 102) in the caller's own group 600; 801 in pgid 0.
    for (const pgid of [0, 1, 100, 600]) expect(groups).not.toContain(pgid);
  });

  it("leaves unrelated process families alone", () => {
    const groups = descendantGroups(rows, [100], 600);
    for (const pgid of [500, 700, 702]) expect(groups).not.toContain(pgid);
    expect(sorted(descendantGroups(rows, [700], 600))).toEqual([702]);
  });

  it("walks several roots at once and dedupes", () => {
    expect(sorted(descendantGroups(rows, [100, 300], 600))).toEqual([102, 200, 310, 311]);
  });

  // Real `ps` output has self-parented entries (pid 0, kernel threads) and, with pid
  // reuse between rows, can even show a parent loop. The walk must still end.
  it("terminates on self-parented entries and parent cycles", () => {
    const cyclic = parsePsRows(`
      0     0     0
      1     0     1
      2     2     0
    100   600   100
    200   100   200
    201   201   201
    300   400   300
    400   300   400
    500   100   500
    501   500   501
    500   501   500
    `);
    // 300 and 400 are each other's parent: a loop, but not under root 100.
    expect(sorted(descendantGroups(cyclic, [100], 600))).toEqual([200, 500, 501]);
    // Rooted inside the loop: both groups once, nothing else, no hang.
    expect(sorted(descendantGroups(cyclic, [300], 600))).toEqual([400]);
    // A root of 0 or 1 is refused outright rather than walking the whole table.
    expect(descendantGroups(cyclic, [0, 1], 600)).toEqual([]);
  });

  it("finds nothing for a root group that is gone, or without rows", () => {
    expect(descendantGroups(rows, [4242], 600)).toEqual([]);
    expect(descendantGroups([], [100], 600)).toEqual([]);
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
