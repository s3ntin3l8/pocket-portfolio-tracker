import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertDemoEnv, assertPortsFree, demoEnv } from "./env.mjs";

const demoDir = mkdtempSync(path.join(tmpdir(), "pocket-demo-test-"));
afterAll(() => rmSync(demoDir, { recursive: true, force: true }));

describe("demoEnv", () => {
  it("inherits only the allowlist from the parent", () => {
    const env = demoEnv(
      demoDir,
      {},
      {
        PATH: "/usr/bin",
        LANG: "C.UTF-8",
        MULLION_SOCKET_PATH: "/run/mullion.sock",
        DATABASE_URL: "postgresql://prod",
        OPENROUTER_API_KEY: "sk-real", // pragma: allowlist secret
        AUTH_SECRET: "real", // pragma: allowlist secret
      },
    );
    expect(env.PATH).toBe("/usr/bin");
    expect(env.MULLION_SOCKET_PATH).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.AUTH_SECRET).toBeUndefined();
    expect(env.HOME.startsWith(demoDir)).toBe(true);
    expect(env.__NEXT_PROCESSED_ENV).toBe("true");
    expect(assertDemoEnv(env, demoDir, { collect: true })).toEqual([]);
  });
});

describe("assertDemoEnv refuses a poisoned environment", () => {
  const base = demoEnv(demoDir, {}, { PATH: "/usr/bin" });
  const refuses = (vars, opts) =>
    expect(
      assertDemoEnv({ ...base, ...vars }, demoDir, { collect: true, ...opts }).length,
    ).toBeGreaterThan(0);

  it("Mullion control-socket variables", () => refuses({ MULLION_SOCKET_PATH: "/x" }));
  it("a non-PGlite database", () => refuses({ DATABASE_URL: "postgresql://user@db.example/prod" }));
  it("a PGlite database outside the demo dir", () =>
    refuses({ DATABASE_URL: "pglite:///home/me/.pglite-dev" }));
  it("real provider keys", () => refuses({ OPENROUTER_API_KEY: "sk-x", DEV_AUTH_TOKEN: "pt_x" })); // pragma: allowlist secret
  it("the encryption key", () => refuses({ DB_ENCRYPTION_KEY: "k" }));
  it("data paths outside the demo dir", () => refuses({ STORAGE_FOLDER_PATH: "/srv/pocket" }));
  it("relative data paths that escape the demo dir", () =>
    refuses({ STORAGE_FOLDER_PATH: "../../srv/pocket" }));
  it("HOME outside the demo dir", () => refuses({ HOME: "/home/me" }));
  it("a working directory holding a .env", () => {
    const cwd = mkdtempSync(path.join(demoDir, "cwd-"));
    writeFileSync(path.join(cwd, ".env"), "DATABASE_URL=postgresql://prod\n");
    refuses({}, { cwd });
  });

  it("a Next app dir with .env files when Next is not told to skip them", () => {
    const cwd = mkdtempSync(path.join(demoDir, "web-"));
    writeFileSync(path.join(cwd, ".env.local"), "AUTH_SECRET=real\n"); // pragma: allowlist secret
    refuses({ __NEXT_PROCESSED_ENV: undefined }, { cwd, nextApp: true });
    // With the flag set, the files are expected on a dev box and only warned about.
    expect(assertDemoEnv(base, demoDir, { cwd, nextApp: true, collect: true })).toEqual([]);
  });

  it("throws unless collecting", () => {
    expect(() => assertDemoEnv({ ...base, MULLION_HOOK_TOKEN: "t" }, demoDir)).toThrow(/refused/);
  });

  it("accepts the generated secrets and a scratch database", () => {
    const env = {
      ...base,
      AUTH_SECRET: "generated", // pragma: allowlist secret
      DATABASE_URL: `pglite://${path.join(demoDir, "db")}`,
      SCREENSHOTS_PAT_FILE: path.join(demoDir, "pat.txt"),
    };
    expect(assertDemoEnv(env, demoDir, { collect: true })).toEqual([]);
  });
});

describe("the installed Next.js", () => {
  // demoEnv relies on @next/env skipping every .env* file when this flag is
  // set. If an upgrade drops it, the web app would load the real .env.local.
  it("still honours __NEXT_PROCESSED_ENV", () => {
    const fromWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
    const fromNext = createRequire(fromWeb.resolve("next/package.json"));
    const source = readFileSync(fromNext.resolve("@next/env"), "utf8");
    expect(source).toContain("__NEXT_PROCESSED_ENV");
  });
});

describe("assertPortsFree", () => {
  it("rejects a port that is already listening", async () => {
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address();
    await expect(assertPortsFree([port])).rejects.toThrow(/already in use/);
    server.close();
  });
});
